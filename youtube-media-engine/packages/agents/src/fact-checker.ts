import { generateStructured, type CostTracker } from '@yme/ai';
import { prisma, type CheckVerdict } from '@yme/database';
import {
  FactCheckReportSchema,
  extractAssertions,
  jobLogger,
  validationError,
  type FactCheckFinding,
  type ScriptSection,
} from '@yme/shared';
import { houseStyle, JSON_ONLY, FACT_CHECK_SYSTEM } from './prompts.js';
import { requireChannel } from './trend-hunter.js';

export interface FactCheckResult {
  verdict: CheckVerdict;
  highRiskCount: number;
  mediumRiskCount: number;
  lowRiskCount: number;
  unsupportedAssertions: number;
  findings: FactCheckFinding[];
}

/**
 * Agent 6 — Fact Checker (spec §13).
 *
 * Two passes that catch different things:
 *   1. Mechanical — regex extraction finds every number, date, quotation and
 *      superlative, then checks whether the section citing it has any claim at
 *      all. A model can overlook a figure; a regex cannot.
 *   2. Model — reads the claims and the script and judges whether each
 *      assertion is supported AS WRITTEN, which is where paraphrase drift and
 *      unsupported causation get caught.
 *
 * The verdict is the stricter of the two. A HIGH-risk finding fails the check
 * outright: spec §13 forbids auto-publishing HIGH risk, and since publishing
 * requires human approval anyway, failing loudly here is what surfaces it.
 */
export async function factCheckScript(opts: {
  videoProjectId: string;
  tracker?: CostTracker;
  jobId?: string;
}): Promise<FactCheckResult> {
  const log = jobLogger({ jobId: opts.jobId, videoId: opts.videoProjectId, stage: 'FACT_CHECK' });

  const project = await prisma.videoProject.findUnique({
    where: { id: opts.videoProjectId },
    include: {
      scripts: { where: { isCurrent: true }, take: 1 },
      research: { include: { claims: { include: { sourceLinks: { include: { source: true } } } } } },
    },
  });
  if (!project) throw new Error(`VideoProject ${opts.videoProjectId} not found`);
  const script = project.scripts[0];
  if (!script) throw validationError('Fact check requested before a script existed');
  if (!project.research) throw validationError('Fact check requested before research completed');
  const channel = await requireChannel(project.channelId);

  const sections = script.sections as unknown as ScriptSection[];
  const claims = project.research.claims;
  const claimsByKey = new Map(claims.map((c) => [c.key, c]));

  // ── Pass 1: mechanical ─────────────────────────────────────────────────
  const mechanical: FactCheckFinding[] = [];
  for (const section of sections) {
    const assertions = extractAssertions(section.narration);
    const sectionClaims = (section.claimKeys ?? []).map((k) => claimsByKey.get(k)).filter(Boolean);
    const hasQuantitativeSupport = sectionClaims.some(
      (c) => c && (c.kind === 'QUANTITATIVE' || c.kind === 'FINANCIAL'),
    );

    for (const a of assertions) {
      // Years inside prose are usually narrative scaffolding, not claims.
      const isBareYear = a.kind === 'DATE' && /^(19|20)\d{2}$/.test(a.text);

      if (a.kind === 'NUMBER' && !hasQuantitativeSupport) {
        mechanical.push({
          assertion: a.text,
          sectionId: section.id,
          risk: 'HIGH',
          supportingClaimKey: null,
          issue: `Section "${section.id}" states a figure but cites no quantitative or financial claim.`,
          suggestedFix: 'Attach the claim that supports this number, or remove the figure.',
        });
      } else if (a.kind === 'QUOTE' && sectionClaims.every((c) => c?.kind !== 'QUOTE')) {
        mechanical.push({
          assertion: a.text.slice(0, 120),
          sectionId: section.id,
          risk: 'HIGH',
          supportingClaimKey: null,
          issue: 'Direct quotation with no QUOTE claim behind it. Invented quotations are the worst failure mode.',
          suggestedFix: 'Source the quotation or paraphrase it as attributed reporting.',
        });
      } else if (a.kind === 'SUPERLATIVE' && sectionClaims.length === 0) {
        mechanical.push({
          assertion: a.text,
          sectionId: section.id,
          risk: 'MEDIUM',
          supportingClaimKey: null,
          issue: 'Priority or superlative claim with no supporting claim.',
          suggestedFix: 'Soften, or cite the source that establishes it.',
        });
      } else if (!isBareYear && a.kind === 'DATE' && sectionClaims.length === 0) {
        mechanical.push({
          assertion: a.text,
          sectionId: section.id,
          risk: 'LOW',
          supportingClaimKey: null,
          issue: 'Date stated in a section with no supporting claims.',
          suggestedFix: null,
        });
      }
    }

    // Using a DISPUTED claim without framing it as contested.
    for (const c of sectionClaims) {
      if (c?.status === 'DISPUTED' && !/dispute|contest|disagree|argue|debate|some |others /i.test(section.narration)) {
        mechanical.push({
          assertion: c.text.slice(0, 140),
          sectionId: section.id,
          risk: 'HIGH',
          supportingClaimKey: c.key,
          issue: 'A DISPUTED claim is presented without signalling that it is contested.',
          suggestedFix: 'State who disagrees and why, or drop the claim.',
        });
      }
    }
  }

  // ── Pass 2: model ──────────────────────────────────────────────────────
  const claimBlock = claims
    .map((c) => {
      const srcs = c.sourceLinks.map((l) => `${l.source.publisher} (${l.source.tier})`).join(', ');
      return `- ${c.key} [${c.confidence}/${c.status}] ${c.text}${c.asOf ? ` (as of ${c.asOf.toISOString().slice(0, 10)})` : ''}\n    sources: ${srcs || 'none'}`;
    })
    .join('\n');

  const { value } = await generateStructured({
    task: 'fact-check',
    schema: FactCheckReportSchema,
    system: `${FACT_CHECK_SYSTEM}\n\n${houseStyle(channel)}`,
    prompt: [
      'Fact check this script against the claims below. Check every number, date, quotation, company',
      'claim, financial claim, historical claim and causal claim.',
      '',
      'CLAIMS:',
      claimBlock,
      '',
      'SCRIPT:',
      sections.map((s) => `## ${s.id} — ${s.heading}\n${s.narration}\n(cites: ${(s.claimKeys ?? []).join(', ') || 'nothing'})`).join('\n\n'),
      '',
      'Return: {"verdict":"PASS"|"FAIL","findings":[{"assertion","sectionId","risk","supportingClaimKey",',
      '"issue","suggestedFix"}],"unsupportedAssertions":0,"highRiskCount":0}',
      JSON_ONLY,
    ].join('\n'),
    maxTokens: 6000,
    temperature: 0.15, // near-deterministic: this is a check, not a draft
    tracker: opts.tracker,
    ctx: { videoProjectId: project.id, stage: 'FACT_CHECK', jobId: opts.jobId },
    mockContext: { sectionIds: sections.map((s) => s.id) },
  });

  // ── Merge, dedupe, decide ──────────────────────────────────────────────
  const merged = dedupeFindings([...mechanical, ...value.findings]);
  const highRiskCount = merged.filter((f) => f.risk === 'HIGH').length;
  const mediumRiskCount = merged.filter((f) => f.risk === 'MEDIUM').length;
  const lowRiskCount = merged.filter((f) => f.risk === 'LOW').length;
  const unsupported = merged.filter((f) => f.supportingClaimKey === null).length;

  // Stricter of the two passes wins. The model saying PASS does not override a
  // mechanically detected unsupported figure.
  const verdict: CheckVerdict = highRiskCount > 0 || value.verdict === 'FAIL' ? 'FAIL' : 'PASS';

  await prisma.factCheckReport.upsert({
    where: { videoProjectId: project.id },
    update: {
      scriptVersion: script.version,
      verdict,
      findings: merged as unknown as object,
      highRiskCount,
      mediumRiskCount,
      lowRiskCount,
      unsupportedAssertions: unsupported,
    },
    create: {
      videoProjectId: project.id,
      scriptVersion: script.version,
      verdict,
      findings: merged as unknown as object,
      highRiskCount,
      mediumRiskCount,
      lowRiskCount,
      unsupportedAssertions: unsupported,
    },
  });

  log.info({ verdict, highRiskCount, mediumRiskCount, total: merged.length }, 'fact check complete');
  return { verdict, highRiskCount, mediumRiskCount, lowRiskCount, unsupportedAssertions: unsupported, findings: merged };
}

/** Both passes flag the same sentence often; keep the higher risk rating. */
function dedupeFindings(findings: FactCheckFinding[]): FactCheckFinding[] {
  const rank = { HIGH: 3, MEDIUM: 2, LOW: 1 } as const;
  const byKey = new Map<string, FactCheckFinding>();
  for (const f of findings) {
    const key = `${f.sectionId}::${f.assertion.trim().toLowerCase().slice(0, 80)}`;
    const existing = byKey.get(key);
    if (!existing || rank[f.risk] > rank[existing.risk]) byKey.set(key, f);
  }
  return [...byKey.values()].sort((a, b) => rank[b.risk] - rank[a.risk]);
}
