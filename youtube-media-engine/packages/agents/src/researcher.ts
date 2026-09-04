import { generateStructured, type CostTracker } from '@yme/ai';
import { prisma, type SourceTier } from '@yme/database';
import {
  ClaimExtractionSchema,
  ResearchPlanSchema,
  SOURCE_TIER_WEIGHT,
  jobLogger,
  policyError,
} from '@yme/shared';
import { fetchPage, reliabilityFor, search, tierForUrl, independentDomains } from '@yme/research';
import { houseStyle, JSON_ONLY, RESEARCHER_SYSTEM } from './prompts.js';
import { requireChannel } from './trend-hunter.js';

export interface ResearchResult {
  researchProjectId: string;
  sourcesStored: number;
  sourcesUnusable: number;
  claimsStored: number;
  coverageScore: number;
  gaps: string[];
  /** Set when research concluded the topic cannot be made accurately. */
  rejected: { reason: string } | null;
}

/**
 * Agent 3 — Researcher (spec §8, §9).
 *
 * The important behaviour here is the refusal. Spec §3 requires that a topic
 * which cannot be researched adequately is rejected, and this is the only
 * place with enough information to make that call. Coverage below the floor
 * blocks production rather than producing a video padded with hedging.
 */
export const COVERAGE_FLOOR = 55;
/** A claim needs corroboration from at least this many distinct domains to be HIGH. */
export const INDEPENDENT_DOMAIN_FLOOR = 2;

export async function runResearch(opts: {
  videoProjectId: string;
  tracker?: CostTracker;
  jobId?: string;
  maxSources?: number;
}): Promise<ResearchResult> {
  const log = jobLogger({ jobId: opts.jobId, videoId: opts.videoProjectId, stage: 'RESEARCH' });
  const maxSources = opts.maxSources ?? 14;

  const project = await prisma.videoProject.findUnique({
    where: { id: opts.videoProjectId },
    include: { topic: true },
  });
  if (!project) throw new Error(`VideoProject ${opts.videoProjectId} not found`);
  const channel = await requireChannel(project.channelId);

  // ── 1. Plan ────────────────────────────────────────────────────────────
  const plan = await generateStructured({
    task: 'plan-research',
    schema: ResearchPlanSchema,
    system: `${RESEARCHER_SYSTEM}\n\n${houseStyle(channel)}`,
    prompt: [
      'Plan the research for this video.',
      '',
      `TITLE: ${project.topic.title}`,
      `ANGLE: ${project.topic.angle}`,
      `SIGNAL: ${project.topic.discoverySignal ?? '(none)'}`,
      '',
      'Give the single question the video must answer, the search queries that would find primary',
      'evidence for it, and what kind of document would settle it.',
      '',
      'Return: {"question","queries":[],"primarySourceTargets":[]}',
      JSON_ONLY,
    ].join('\n'),
    maxTokens: 1200,
    temperature: 0.4,
    tracker: opts.tracker,
    ctx: { videoProjectId: project.id, stage: 'RESEARCH', jobId: opts.jobId },
    mockContext: { title: project.topic.title },
  });

  const research = await prisma.researchProject.upsert({
    where: { videoProjectId: project.id },
    update: { question: plan.value.question, searchQueries: plan.value.queries },
    create: {
      videoProjectId: project.id,
      question: plan.value.question,
      searchQueries: plan.value.queries,
    },
  });

  // ── 2. Gather ──────────────────────────────────────────────────────────
  const seen = new Set<string>();
  const stored: Array<{ id: string; url: string; tier: SourceTier; excerpt: string; title: string }> = [];
  let unusable = 0;

  for (const query of plan.value.queries) {
    if (stored.length >= maxSources) break;

    let results: Awaited<ReturnType<typeof search>>;
    try {
      results = await search(query, { limit: 6, videoProjectId: project.id, stage: 'RESEARCH' });
    } catch (err) {
      log.warn({ query, err: String(err) }, 'search failed for query');
      continue;
    }

    for (const r of results) {
      if (stored.length >= maxSources) break;
      const normalised = normaliseUrl(r.url);
      if (!normalised || seen.has(normalised)) continue;
      seen.add(normalised);

      const page = await fetchPage(r.url);
      const tier = tierForUrl(r.url) ?? 'OTHER';

      if (!page.ok) {
        unusable++;
        // Kept in the audit trail with the reason, not silently discarded —
        // "we looked and could not use it" is evidence about coverage.
        await prisma.source.upsert({
          where: { researchProjectId_url: { researchProjectId: research.id, url: r.url } },
          update: { unavailableReason: page.unavailableReason },
          create: {
            researchProjectId: research.id,
            url: r.url,
            title: r.title || page.title || r.url,
            publisher: r.publisher ?? hostOf(r.url),
            tier,
            publishedAt: parseDate(r.publishedAt ?? page.publishedAt),
            excerpt: r.snippet.slice(0, 2000) || '(no excerpt available)',
            reliability: 0,
            unavailableReason: page.unavailableReason,
          },
        });
        continue;
      }

      const reliability = reliabilityFor(tier, {
        hasDate: Boolean(r.publishedAt ?? page.publishedAt),
        isHttps: r.url.startsWith('https://'),
        bodyLength: page.text.length,
      });

      const row = await prisma.source.upsert({
        where: { researchProjectId_url: { researchProjectId: research.id, url: r.url } },
        update: { reliability, tier, unavailableReason: null },
        create: {
          researchProjectId: research.id,
          url: r.url,
          title: page.title || r.title || r.url,
          publisher: r.publisher ?? hostOf(r.url),
          tier,
          publishedAt: parseDate(r.publishedAt ?? page.publishedAt),
          excerpt: page.text.slice(0, 3500),
          reliability,
        },
      });

      stored.push({ id: row.id, url: r.url, tier, excerpt: page.text.slice(0, 3500), title: row.title });
    }
  }

  log.info({ sources: stored.length, unusable }, 'sources gathered');

  if (stored.length === 0) {
    await markRejected(project.id, research.id, 'No usable sources could be retrieved for this topic.');
    return {
      researchProjectId: research.id,
      sourcesStored: 0,
      sourcesUnusable: unusable,
      claimsStored: 0,
      coverageScore: 0,
      gaps: ['No sources retrieved'],
      rejected: { reason: 'No usable sources could be retrieved for this topic.' },
    };
  }

  // ── 3. Extract claims ──────────────────────────────────────────────────
  const sourceBlock = stored
    .map(
      (s, i) =>
        `[${i + 1}] ${s.title}\nURL: ${s.url}\nTIER: ${s.tier}\nEXCERPT:\n${s.excerpt.slice(0, 2200)}\n`,
    )
    .join('\n---\n');

  const extraction = await generateStructured({
    task: 'extract-claims',
    schema: ClaimExtractionSchema,
    system: `${RESEARCHER_SYSTEM}\n\n${houseStyle(channel)}`,
    prompt: [
      `QUESTION: ${plan.value.question}`,
      `VIDEO ANGLE: ${project.topic.angle}`,
      '',
      'SOURCES (you may cite ONLY these URLs):',
      sourceBlock,
      '',
      'Extract the claims this video would need. Give each a stable snake-case key.',
      'Score coverage 0-100: how much of the question these sources actually answer.',
      'List what is missing.',
      '',
      'Return: {"claims":[{"key","text","sourceUrls":[],"confidence","status","kind","asOf","notes"}],',
      '"coverageScore":0,"gaps":[]}',
      JSON_ONLY,
    ].join('\n'),
    maxTokens: 8000,
    temperature: 0.3,
    tracker: opts.tracker,
    ctx: { videoProjectId: project.id, stage: 'RESEARCH', jobId: opts.jobId },
    mockContext: { title: project.topic.title, sourceUrls: stored.map((s) => s.url) },
  });

  // ── 4. Persist claims, enforcing citation integrity in code ────────────
  const urlToSource = new Map(stored.map((s) => [normaliseUrl(s.url) ?? s.url, s]));
  let claimsStored = 0;
  const rejectedClaims: string[] = [];

  for (const claim of extraction.value.claims) {
    const resolved = claim.sourceUrls
      .map((u) => urlToSource.get(normaliseUrl(u) ?? u))
      .filter((s): s is NonNullable<typeof s> => Boolean(s));

    // A claim citing a URL that was never retrieved is a hallucinated citation.
    // Dropping it is the whole point of storing sources separately.
    if (resolved.length === 0) {
      rejectedClaims.push(claim.key);
      continue;
    }

    const bestTier = resolved.reduce<number>((max, s) => Math.max(max, SOURCE_TIER_WEIGHT[s.tier]), 0);
    const domains = independentDomains(resolved.map((s) => s.url));

    // Confidence is capped by evidence quality regardless of what the model
    // asserted: journalism alone cannot make a figure HIGH confidence, and
    // neither can three pages of the same outlet.
    let confidence = claim.confidence;
    if (confidence === 'HIGH' && (bestTier < SOURCE_TIER_WEIGHT.FINANCIAL_REPORT || domains < INDEPENDENT_DOMAIN_FLOOR)) {
      confidence = bestTier >= SOURCE_TIER_WEIGHT.FINANCIAL_REPORT ? 'HIGH' : 'MEDIUM';
      if (domains < INDEPENDENT_DOMAIN_FLOOR && bestTier < SOURCE_TIER_WEIGHT.PRIMARY_COMPANY) confidence = 'MEDIUM';
    }

    const row = await prisma.claim.upsert({
      where: { researchProjectId_key: { researchProjectId: research.id, key: claim.key } },
      update: { text: claim.text, confidence, status: claim.status, kind: claim.kind, notes: claim.notes ?? null },
      create: {
        researchProjectId: research.id,
        key: claim.key,
        text: claim.text,
        kind: claim.kind,
        confidence,
        status: claim.status,
        asOf: parseDate(claim.asOf ?? null),
        notes: claim.notes ?? null,
      },
    });

    for (const s of resolved) {
      await prisma.claimSource.upsert({
        where: { claimId_sourceId: { claimId: row.id, sourceId: s.id } },
        update: {},
        create: { claimId: row.id, sourceId: s.id },
      });
    }
    claimsStored++;
  }

  if (rejectedClaims.length) {
    log.warn({ rejectedClaims }, 'dropped claims citing URLs that were never retrieved');
  }

  const coverage = extraction.value.coverageScore;
  await prisma.researchProject.update({
    where: { id: research.id },
    data: {
      coverageScore: coverage,
      summary: `${claimsStored} claims from ${stored.length} sources. Gaps: ${extraction.value.gaps.join('; ') || 'none reported'}`,
      completedAt: new Date(),
    },
  });

  if (coverage < COVERAGE_FLOOR || claimsStored === 0) {
    const reason =
      claimsStored === 0
        ? 'No claim survived citation checking — every extracted claim cited a source that was not retrieved.'
        : `Research coverage ${coverage} is below the floor of ${COVERAGE_FLOOR}. Gaps: ${extraction.value.gaps.join('; ')}`;
    await markRejected(project.id, research.id, reason);
    return {
      researchProjectId: research.id,
      sourcesStored: stored.length,
      sourcesUnusable: unusable,
      claimsStored,
      coverageScore: coverage,
      gaps: extraction.value.gaps,
      rejected: { reason },
    };
  }

  log.info({ claimsStored, coverage }, 'research complete');
  return {
    researchProjectId: research.id,
    sourcesStored: stored.length,
    sourcesUnusable: unusable,
    claimsStored,
    coverageScore: coverage,
    gaps: extraction.value.gaps,
    rejected: null,
  };
}

async function markRejected(videoProjectId: string, researchProjectId: string, reason: string): Promise<void> {
  await prisma.videoProject.update({
    where: { id: videoProjectId },
    data: { status: 'BLOCKED', blockedReason: reason },
  });
  await prisma.researchProject.update({ where: { id: researchProjectId }, data: { summary: reason } });
}

/** Throws when a project is not researchable — used by the pipeline as a gate. */
export function assertResearchable(result: ResearchResult): void {
  if (result.rejected) throw policyError(result.rejected.reason, { coverageScore: result.coverageScore });
}

function normaliseUrl(url: string): string | null {
  try {
    const u = new URL(url);
    u.hash = '';
    // Strip tracking parameters so the same document is not stored twice.
    for (const p of [...u.searchParams.keys()]) {
      if (/^(utm_|fbclid|gclid|ref|source)/i.test(p)) u.searchParams.delete(p);
    }
    return `${u.protocol}//${u.hostname.replace(/^www\./, '')}${u.pathname.replace(/\/$/, '')}${u.search}`;
  } catch {
    return null;
  }
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return 'unknown';
  }
}

function parseDate(v: string | null | undefined): Date | null {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}
