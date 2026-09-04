import { generateStructured, type CostTracker } from '@yme/ai';
import { prisma, type Channel, type Pillar } from '@yme/database';
import { CONTENT_PILLARS } from '@yme/config';
import { TopicCandidateListSchema, checkDuplicates, jobLogger, type TopicCandidate } from '@yme/shared';
import { search } from '@yme/research';
import { houseStyle, JSON_ONLY, TREND_HUNTER_SYSTEM } from './prompts.js';

export interface DiscoveryResult {
  created: number;
  skippedAsDuplicate: Array<{ title: string; reason: string }>;
  candidates: TopicCandidate[];
}

/**
 * Agent 1 — Trend Hunter (spec §6).
 *
 * Two inputs, deliberately: live search results give it something current to
 * react to, and the existing catalogue tells it what has already been said.
 * Without the second input it re-proposes the same six companies every run.
 */
export async function discoverTopics(opts: {
  channelId: string;
  limit?: number;
  tracker?: CostTracker;
  jobId?: string;
  /** Seed queries; defaults to a pillar sweep. */
  queries?: string[];
}): Promise<DiscoveryResult> {
  const log = jobLogger({ jobId: opts.jobId, stage: 'DISCOVERY' });
  const channel = await requireChannel(opts.channelId);
  const limit = opts.limit ?? 6;

  const existing = await prisma.topic.findMany({
    where: { channelId: channel.id },
    select: { id: true, title: true, angle: true },
    orderBy: { createdAt: 'desc' },
    take: 200,
  });

  const queries = opts.queries ?? defaultQueries();
  const signals: string[] = [];
  for (const q of queries) {
    try {
      const results = await search(q, { limit: 5, stage: 'DISCOVERY' });
      for (const r of results) {
        signals.push(`- [${r.publisher ?? hostOf(r.url)}] ${r.title} — ${r.snippet.slice(0, 220)}`);
      }
    } catch (err) {
      // A dead search provider must not stop discovery; the model can still
      // work from the catalogue and pillar definitions.
      log.warn({ query: q, err: String(err) }, 'discovery search failed, continuing');
    }
  }

  const pillarBlock = CONTENT_PILLARS.map(
    (p) => `${p.key} — ${p.label}: ${p.brief}\n  e.g. ${p.examples.join(' / ')}`,
  ).join('\n');

  const prompt = [
    `Propose ${limit} video opportunities for this channel.`,
    '',
    'CONTENT PILLARS',
    pillarBlock,
    '',
    'ALREADY COVERED OR QUEUED (do not repeat these subjects or angles):',
    existing.length ? existing.slice(0, 60).map((t) => `- ${t.title}`).join('\n') : '(nothing yet)',
    '',
    'RECENT SIGNALS FROM WEB SEARCH (may be noisy; use only what supports a real mechanism):',
    signals.length ? signals.slice(0, 40).join('\n') : '(search returned nothing usable)',
    '',
    'For each opportunity give: title, angle, pillar, discoverySignal (the mechanism — not "it is',
    'trending"), rationale, entityNames.',
    '',
    'Return: {"topics":[{"title","angle","pillar","discoverySignal","rationale","entityNames":[]}]}',
    JSON_ONLY,
  ].join('\n');

  const { value } = await generateStructured({
    task: 'discover-topics',
    schema: TopicCandidateListSchema,
    system: `${TREND_HUNTER_SYSTEM}\n\n${houseStyle(channel)}`,
    prompt,
    maxTokens: 4000,
    temperature: 0.9, // higher than the rest of the pipeline: this stage wants range
    tracker: opts.tracker,
    ctx: { stage: 'DISCOVERY', jobId: opts.jobId },
    mockContext: { limit, excludeTitles: existing.map((e) => e.title) },
  });

  const skipped: Array<{ title: string; reason: string }> = [];
  let created = 0;

  for (const candidate of value.topics) {
    const matches = checkDuplicates({
      candidateTitle: candidate.title,
      candidateAngle: candidate.angle,
      candidateEntityKeys: candidate.entityNames,
      existing: existing.map((e) => ({ id: e.id, title: e.title, angle: e.angle })),
    });
    const blocking = matches.find((m) => m.verdict === 'DUPLICATE');
    if (blocking) {
      skipped.push({ title: candidate.title, reason: blocking.reason });
      continue;
    }

    await prisma.topic.create({
      data: {
        channelId: channel.id,
        title: candidate.title,
        angle: candidate.angle,
        pillar: candidate.pillar as Pillar,
        discoverySignal: candidate.discoverySignal,
        rationale: candidate.rationale,
        status: 'DISCOVERED',
      },
    });
    created++;
    existing.push({ id: 'pending', title: candidate.title, angle: candidate.angle });
  }

  log.info({ created, skipped: skipped.length }, 'topic discovery complete');
  return { created, skippedAsDuplicate: skipped, candidates: value.topics };
}

function defaultQueries(): string[] {
  return [
    'company business model explained revenue segments',
    'AI infrastructure spending data centre capex',
    'SaaS pricing model change AI agents',
    'company failure post mortem strategy',
    'annual report segment revenue shift',
  ];
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return 'unknown';
  }
}

export async function requireChannel(channelId: string): Promise<Channel> {
  const channel = await prisma.channel.findUnique({ where: { id: channelId } });
  if (!channel) throw new Error(`Channel ${channelId} not found — run the seed or the first-run wizard`);
  return channel;
}
