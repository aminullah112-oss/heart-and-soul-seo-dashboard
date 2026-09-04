import { slugify } from '@yme/shared';
import type { LlmRequest } from '../types.js';
import { MOCK_SUBJECTS, pickSubject, subjectByKey, type MockSubject } from './subjects.js';

/**
 * One responder per LLM task. Each returns a payload that satisfies the
 * corresponding Zod schema in @yme/shared, so mock runs exercise the real
 * validation path rather than bypassing it.
 */

type Ctx = Record<string, unknown>;

function resolveSubject(ctx: Ctx, seed: string): MockSubject {
  const key = typeof ctx.subjectKey === 'string' ? ctx.subjectKey : undefined;
  if (key) {
    const direct = subjectByKey(key);
    if (direct) return direct;
  }
  const title = typeof ctx.title === 'string' ? ctx.title : undefined;
  if (title) {
    const byTitle = MOCK_SUBJECTS.find((s) => s.title === title || title.includes(s.company));
    if (byTitle) return byTitle;
  }
  return pickSubject(seed);
}

/** Stable pseudo-random in [0,1) from a string — keeps mock scores varied but fixed. */
function rand(seed: string, salt: string): number {
  let h = 2166136261;
  const s = `${seed}:${salt}`;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h / 4294967296;
}

const spread = (seed: string, salt: string, lo: number, hi: number) =>
  Math.round(lo + rand(seed, salt) * (hi - lo));

export function buildMockPayload(req: LlmRequest, seed: string): unknown {
  const ctx = (req.mockContext ?? {}) as Ctx;
  const subject = resolveSubject(ctx, seed);

  switch (req.task) {
    case 'discover-topics':
      return discoverTopics(seed, ctx);
    case 'score-topic':
      return scoreTopic(seed, subject);
    case 'plan-research':
      return planResearch(subject);
    case 'assess-source':
      return assessSource(ctx, seed);
    case 'extract-claims':
      return extractClaims(subject, ctx);
    case 'story-brief':
      return storyBrief(subject, ctx);
    case 'write-script':
    case 'revise-script':
      return writeScript(subject, ctx, req.task === 'revise-script');
    case 'analyze-retention':
      return analyzeRetention(seed, ctx);
    case 'fact-check':
      return factCheck(ctx);
    case 'storyboard':
      return storyboard(subject, ctx);
    case 'generate-titles':
      return generateTitles(subject, seed);
    case 'generate-thumbnails':
      return generateThumbnails(subject, seed);
    case 'generate-description':
      return generateDescription(subject, ctx);
    case 'generate-shorts':
      return generateShorts(subject, ctx);
    case 'qc-review':
      return qcReview(seed);
    case 'extract-entities':
      return extractEntities(subject);
    case 'suggest-followups':
      return suggestFollowups(subject);
    case 'learning-report':
      return learningReport(ctx);
    case 'sponsor-fit':
      return sponsorFit(seed, ctx);
    default: {
      const never: never = req.task;
      throw new Error(`Mock provider has no responder for task "${String(never)}"`);
    }
  }
}

// ── Discovery & scoring ───────────────────────────────────────────────────

function discoverTopics(seed: string, ctx: Ctx) {
  const exclude = new Set((Array.isArray(ctx.excludeTitles) ? ctx.excludeTitles : []) as string[]);
  const limit = typeof ctx.limit === 'number' ? ctx.limit : 6;
  const pool = MOCK_SUBJECTS.filter((s) => !exclude.has(s.title));
  const chosen = (pool.length ? pool : MOCK_SUBJECTS).slice(0, Math.max(1, Math.min(limit, 12)));
  return {
    topics: chosen.map((s) => ({
      title: s.title,
      angle: s.angle,
      pillar: s.pillar,
      discoverySignal: s.signal,
      rationale: `${s.thesis} The story survives a "so what" test because the mechanism is visible in primary sources rather than commentary.`,
      entityNames: s.entities.map((e) => e.name),
    })),
    _mock: true,
    _seed: seed,
  };
}

function scoreTopic(seed: string, s: MockSubject) {
  // Deliberately varied so gate logic (pass/reject) gets exercised in tests.
  return {
    viralPotential: spread(seed, 'viral', 62, 95),
    searchDemand: spread(seed, 'search', 55, 92),
    advertiserValue: spread(seed, 'adv', 70, 97),
    evergreenValue: spread(seed, 'ever', 60, 94),
    storyPotential: spread(seed, 'story', 68, 98),
    timeliness: spread(seed, 'time', 40, 90),
    // High = saturated = bad. Inverted before weighting.
    competition: spread(seed, 'comp', 25, 75),
    researchAvailability: spread(seed, 'res', 58, 96),
    visualPotential: spread(seed, 'vis', 60, 95),
    affiliatePotential: spread(seed, 'aff', 20, 70),
    sponsorshipPotential: spread(seed, 'spon', 45, 88),
    channelRelevance: spread(seed, 'rel', 80, 99),
    reasoning:
      `${s.company}: the mechanism is documented in primary filings, which is what makes the ` +
      'explanation defensible rather than speculative. Competition is moderate — the subject is ' +
      'covered, but mostly as news rather than as a business model breakdown.',
  };
}

function planResearch(s: MockSubject) {
  return {
    question: s.centralQuestion,
    queries: [
      `${s.company} annual report segment revenue`,
      `${s.company} 10-K risk factors`,
      `${s.company} business model analysis`,
      `${s.company} competitors market share`,
      `${s.company} historical revenue by year`,
      `${s.company} pricing strategy`,
    ],
    primarySourceTargets: [
      'Latest annual report or 10-K, segment breakdown',
      'Investor presentation with the current revenue mix',
      'Government or regulator statistics for the industry baseline',
    ],
  };
}

function assessSource(ctx: Ctx, seed: string) {
  const tier = typeof ctx.tier === 'string' ? ctx.tier : 'REPUTABLE_JOURNALISM';
  return {
    tier,
    reliability: spread(seed, 'rel', 60, 96),
    relevance: spread(seed, 'relv', 55, 95),
    reason: 'Publisher and document type are consistent with the tier assigned.',
  };
}

function extractClaims(s: MockSubject, ctx: Ctx) {
  const urls = Array.isArray(ctx.sourceUrls) && ctx.sourceUrls.length
    ? (ctx.sourceUrls as string[])
    : s.sources.map((x) => x.url);
  const primary = urls[0]!;
  const secondary = urls[1] ?? primary;
  const slug = slugify(s.company, 20);

  return {
    claims: [
      {
        key: `${slug}-segment-mix`,
        text: `${s.company}'s reported segment mix shifted materially over the last five fiscal years, per its own filings.`,
        sourceUrls: [primary, secondary],
        confidence: 'HIGH',
        status: 'VERIFIED',
        kind: 'FINANCIAL',
        asOf: '2025-01-31',
        notes: 'MOCK DATA — figures are fabricated for pipeline testing.',
      },
      {
        key: `${slug}-series`,
        text: `${s.seriesTitle}: ${s.series.map((p) => `${p.label} ${p.value}`).join(', ')} (${s.seriesUnit}).`,
        sourceUrls: [primary],
        confidence: 'HIGH',
        status: 'VERIFIED',
        kind: 'QUANTITATIVE',
        asOf: '2025-01-31',
        notes: 'MOCK DATA — fabricated series used to exercise the chart engine.',
      },
      {
        key: `${slug}-mechanism`,
        text: s.thesis,
        sourceUrls: [primary, secondary],
        confidence: 'MEDIUM',
        status: 'VERIFIED',
        kind: 'CAUSAL',
        asOf: null,
        notes: 'Causal reading of the mechanism; stated as interpretation in the script.',
      },
      {
        key: `${slug}-history`,
        text: `${s.company}'s current position developed over more than a decade rather than in a single cycle.`,
        sourceUrls: [secondary],
        confidence: 'MEDIUM',
        status: 'VERIFIED',
        kind: 'HISTORICAL',
        asOf: null,
      },
      {
        key: `${slug}-contested`,
        text: `Analysts disagree about how durable ${s.company}'s advantage is beyond the current cycle.`,
        sourceUrls: [urls[2] ?? secondary],
        confidence: 'LOW',
        status: 'DISPUTED',
        kind: 'DESCRIPTIVE',
        asOf: null,
        notes: 'Disputed on purpose: the script must not present this as settled.',
      },
    ],
    coverageScore: 82,
    gaps: [
      'No independent verification of unit economics below the segment level.',
      'Forward-looking capacity figures are guidance, not results.',
    ],
  };
}

// ── Story & script ────────────────────────────────────────────────────────

function storyBrief(s: MockSubject, ctx: Ctx) {
  const claimKeys = Array.isArray(ctx.claimKeys) ? (ctx.claimKeys as string[]) : [];
  const slug = slugify(s.company, 20);
  // The arc differs per pillar — a fixed template is a spec violation (§10).
  const arcs: Record<string, Array<{ section: string; purpose: string }>> = {
    BUSINESS_FAILURE: [
      { section: 'The number nobody questioned', purpose: 'Open on the disclosed figure that made the outcome inevitable' },
      { section: 'How it looked from inside', purpose: 'Establish why smart people signed off' },
      { section: 'The mismatch', purpose: 'Name the structural flaw precisely' },
      { section: 'The shock', purpose: 'Show what turned a flaw into a failure' },
      { section: 'What was actually being sold', purpose: 'Reframe the business honestly' },
      { section: 'The lesson that generalises', purpose: 'Give the viewer a reusable test' },
    ],
    AI_BUSINESS: [
      { section: 'The wrong explanation', purpose: 'Dispose of the popular answer in the first 30 seconds' },
      { section: 'The bet nobody rewarded', purpose: 'Backstory: the unglamorous decision that compounded' },
      { section: 'How the lock-in actually works', purpose: 'Mechanism, with the numbers on screen' },
      { section: 'Where the money lands', purpose: 'Follow the revenue through the stack' },
      { section: 'What would break it', purpose: 'Steelman the competition honestly' },
      { section: 'What this predicts', purpose: 'Close the opening loop' },
    ],
    default: [
      { section: 'The thing that does not add up', purpose: 'Hook on a visible contradiction' },
      { section: 'What the business really sells', purpose: 'Reframe with evidence' },
      { section: 'The mechanism', purpose: 'Explain the model with a chart' },
      { section: 'Why competitors cannot copy it', purpose: 'Establish the moat, or admit there is not one' },
      { section: 'The cost of the strategy', purpose: 'Show the tradeoff being paid' },
      { section: 'What it means for everyone else', purpose: 'Generalise and close' },
    ],
  };

  return {
    centralQuestion: s.centralQuestion,
    thesis: s.thesis,
    targetViewer:
      'Someone who follows business news, understands revenue and margin, and is tired of explanations that stop at "they innovated".',
    whyCare:
      'The mechanism here repeats across industries — recognising it changes how you read the next company that looks unbeatable.',
    hook: `${s.company} does something that looks like a mistake until you see where the money actually comes from.`,
    conflict: 'The public explanation and the filed numbers point in different directions.',
    stakes: 'Getting this wrong means misreading an entire category of business.',
    narrativeArc: arcs[s.pillar] ?? arcs.default!,
    keyRevelations: [
      s.signal,
      `The advantage is structural, not a product cycle: ${s.angle}`,
      'The strategy has a cost, and the filings show who pays it.',
    ],
    supportingClaimKeys: claimKeys.length ? claimKeys : [`${slug}-segment-mix`, `${slug}-series`, `${slug}-mechanism`],
    ending:
      'Close by answering the opening question in one sentence, then hand the viewer the test they can apply themselves.',
    cta: 'If you want the next one of these, subscribe — one company teardown a week.',
  };
}

function writeScript(s: MockSubject, ctx: Ctx, isRevision: boolean) {
  const slug = slugify(s.company, 20);
  const arc = (Array.isArray(ctx.narrativeArc) ? ctx.narrativeArc : []) as Array<{ section: string; purpose: string }>;
  const targetWords = typeof ctx.targetWords === 'number' ? ctx.targetWords : 1650;

  const sectionDefs = arc.length
    ? arc
    : [
        { section: 'Hook', purpose: 'open' },
        { section: 'The mechanism', purpose: 'explain' },
        { section: 'The money', purpose: 'quantify' },
        { section: 'The competition', purpose: 'steelman' },
        { section: 'The lesson', purpose: 'close' },
      ];

  const bodies = [
    `${s.company} looks like it is doing something irrational. ${s.signal} That is the part worth explaining, and the explanation is not the one you have probably heard. Most coverage stops at the surface, which is why the same wrong answer keeps circulating.`,
    `Here is the mechanism. ${s.thesis} None of that is a secret — it is in the filings. What makes it work is that it compounds quietly, over years, in a line item nobody was watching. Each individual decision looks modest. Together they add up to a position competitors cannot buy their way out of in a single cycle.`,
    `Now the money. ${s.seriesTitle} moved like this: ${s.series.map((p) => `${p.label}, ${p.value}`).join('; ')} — measured in ${s.seriesUnit}. Put those on the same axis and the strategy stops looking like luck. The shape of that curve is the whole argument, and it is drawn from the company's own reporting rather than an estimate.`,
    // Deliberately frames the DISPUTED claim as contested. A script that
    // asserted this flatly would — correctly — fail the fact check, which is
    // what the fact-checker test exercises.
    `The obvious objection is that a competitor can simply copy this. Analysts disagree about how durable the advantage really is, and that disagreement is worth taking seriously rather than waving away. ${s.angle} Some argue the switching cost erodes as tooling matures; others contest that, pointing to how long the incumbent has had to entrench. The honest answer is that the advantage holds only as long as the switching cost does, and that is a testable condition rather than a permanent one.`,
    `So what generalises? Look for the business where the visible product and the profitable product are different things. Once you see that split, ${s.company} stops being a puzzle — and so does the next company that looks unbeatable for no obvious reason. The test is simple: ask which line item would hurt most if it went to zero, and whether that is the thing the company is known for.`,
    `One more thing worth sitting with. Every structural advantage was once a decision that looked unremarkable, taken by people who could not see the compounding from where they stood. That is the uncomfortable part of this story: the moment it was cheap to copy passed quietly, and nobody announced it.`,
  ];

  const chosen = sectionDefs.slice(0, 6);
  // Pad each section toward the target length so the mock exercises real
  // durations, caption counts and render timing rather than a 90-second stub.
  const perSection = Math.max(60, Math.round(targetWords / chosen.length));

  const sections = chosen.map((d, i) => {
    let narration = bodies[i % bodies.length]!;
    let guard = 0;
    while (countWordsApprox(narration) < perSection && guard < 8) {
      narration += ' ' + elaboration(s, d.section, guard);
      guard++;
    }
    return {
      id: `s${i + 1}`,
      heading: d.section,
      narration,
      claimKeys:
        i === 2 ? [`${slug}-series`, `${slug}-segment-mix`] : i === 1 ? [`${slug}-mechanism`] : i === 3 ? [`${slug}-contested`] : [],
      openLoop:
        i === 0
          ? `Why does ${s.company} leave the obvious move on the table?`
          : i === chosen.length - 1
            ? null
            : 'What does that cost them?',
    };
  });

  return { workingTitle: isRevision ? `${s.title} (rev)` : s.title, sections };
}

const countWordsApprox = (t: string) => t.trim().split(/\s+/).filter(Boolean).length;

/** Filler that stays on-topic, so padded sections still read as prose. */
function elaboration(s: MockSubject, section: string, i: number): string {
  const lines = [
    `Consider what that means in practice for anyone competing with ${s.company} on price alone.`,
    `This is the part where most explanations stop, and stopping there is what produces the wrong conclusion about ${section.toLowerCase()}.`,
    `It is worth being precise about the timing, because the order in which these decisions happened is what made them compound.`,
    `None of this required a breakthrough. It required a willingness to accept a worse-looking number for several years running.`,
    `The counter-example is instructive: firms that optimised the visible metric instead ended up with the better quarter and the weaker position.`,
    `That gap between reported performance and structural position is exactly where the interesting business questions live.`,
    `Read the filings and the pattern is legible; read the press coverage and it usually is not.`,
    `Which raises the question this video has been circling from the start.`,
  ];
  return lines[i % lines.length]!;
}

function analyzeRetention(seed: string, ctx: Ctx) {
  const forcePass = ctx.forcePass === true;
  const base = forcePass ? 82 : 68;
  const sectionIds = (Array.isArray(ctx.sectionIds) ? ctx.sectionIds : ['s1', 's4']) as string[];
  const scores = {
    hookStrength: forcePass ? 88 : spread(seed, 'hook', 55, 92),
    first30Seconds: forcePass ? 85 : spread(seed, 'f30', 52, 90),
    curiosityGaps: spread(seed, 'gap', base - 10, base + 18),
    pacing: spread(seed, 'pace', base - 8, base + 15),
    informationDensity: spread(seed, 'dens', base - 5, base + 16),
    patternInterrupts: spread(seed, 'pat', base - 15, base + 12),
    narrativeTension: spread(seed, 'tens', base - 6, base + 17),
    payoffFrequency: spread(seed, 'pay', base - 9, base + 14),
  };
  const overall = Math.round(
    (scores.hookStrength * 0.2 +
      scores.first30Seconds * 0.2 +
      scores.curiosityGaps * 0.12 +
      scores.pacing * 0.12 +
      scores.informationDensity * 0.1 +
      scores.patternInterrupts * 0.08 +
      scores.narrativeTension * 0.1 +
      scores.payoffFrequency * 0.08) *
      10,
  ) / 10;

  return {
    ...scores,
    overall,
    weakestSections: sectionIds.slice(-2).map((id) => ({
      sectionId: id,
      problem: 'Explains before it gives the viewer a reason to care.',
      fix: 'Lead with the consequence, then the mechanism.',
    })),
    cutCandidates: overall < 75 ? [{ sectionId: sectionIds.at(-1) ?? 's5', reason: 'Restates the previous section without adding a new fact.' }] : [],
  };
}

function factCheck(ctx: Ctx) {
  const injectHighRisk = ctx.injectHighRisk === true;
  const findings = injectHighRisk
    ? [
        {
          assertion: 'the first company ever to do this',
          sectionId: 's2',
          risk: 'HIGH',
          supportingClaimKey: null,
          issue: 'Superlative with no supporting claim. Priority claims are the fastest route to a correction.',
          suggestedFix: 'Soften to "one of the first" or cite a source that establishes priority.',
        },
      ]
    : [
        {
          assertion: 'analysts disagree about durability',
          sectionId: 's4',
          risk: 'LOW',
          supportingClaimKey: null,
          issue: 'Attributed to a DISPUTED claim; acceptable because the script presents it as contested.',
          suggestedFix: null,
        },
      ];

  return {
    verdict: injectHighRisk ? 'FAIL' : 'PASS',
    findings,
    unsupportedAssertions: injectHighRisk ? 1 : 0,
    highRiskCount: injectHighRisk ? 1 : 0,
  };
}

// ── Visuals ───────────────────────────────────────────────────────────────

function storyboard(s: MockSubject, ctx: Ctx) {
  const sections = (Array.isArray(ctx.sections) ? ctx.sections : []) as Array<{
    id: string;
    heading: string;
    narration: string;
  }>;
  const slug = slugify(s.company, 20);
  const src = sections.length
    ? sections
    : [{ id: 's1', heading: 'Hook', narration: `${s.company} looks irrational until you see the money.` }];

  const scenes: unknown[] = [];
  let index = 0;

  for (const section of src) {
    // Split each section's narration into beats so a static shot never
    // outstays its welcome. The visual director splits further if needed.
    const beats = splitIntoBeats(section.narration, 4);
    // The chart belongs on the beat that actually states the series, not on
    // whichever beat happens to be last.
    const chartBeatIndex = beats.findIndex((b) => s.series.some((pt) => b.includes(String(pt.value))));
    beats.forEach((beat, bi) => {
      const isChartBeat = bi === chartBeatIndex;
      scenes.push({
        id: `${section.id}-${bi}`,
        sectionId: section.id,
        index: index++,
        narration: beat,
        visualKind: isChartBeat ? 'CHART' : bi === 0 ? 'STOCK_VIDEO' : 'GENERATED_IMAGE',
        visualQuery: isChartBeat
          ? `${s.seriesTitle} chart`
          : bi === 0
            ? `${s.company} headquarters corporate building establishing shot`
            : `editorial illustration, ${s.company}, ${section.heading.toLowerCase()}, muted palette`,
        onScreenText: bi === 0 ? section.heading : null,
        chart: isChartBeat
          ? {
              type: 'bar',
              title: s.seriesTitle,
              subtitle: s.company,
              unit: s.seriesUnit,
              series: [{ name: s.company, points: s.series }],
              sourceClaimKey: `${slug}-series`,
              sourceNote: `Source: ${s.sources[0]?.publisher ?? 'company filings'}`,
            }
          : null,
        estimatedSeconds: Math.max(3, Math.round((beat.split(/\s+/).length / 150) * 60 * 10) / 10),
      });
    });
  }

  return { scenes };
}

function splitIntoBeats(text: string, max: number): string[] {
  const sentences = text
    .replace(/\s+/g, ' ')
    .trim()
    .split(/(?<=[.!?])\s+/)
    .filter(Boolean);
  if (sentences.length <= max) return sentences.length ? sentences : [text];
  const perBeat = Math.ceil(sentences.length / max);
  const out: string[] = [];
  for (let i = 0; i < sentences.length; i += perBeat) out.push(sentences.slice(i, i + perBeat).join(' '));
  return out;
}

// ── Packaging ─────────────────────────────────────────────────────────────

function generateTitles(s: MockSubject, seed: string) {
  const stems = [
    s.title,
    `Why ${s.company} Makes Money Where Nobody Is Looking`,
    `The ${s.company} Business Model, Explained Properly`,
    `${s.company}: The Part Everyone Gets Wrong`,
    `How ${s.company} Actually Makes Its Money`,
    `${s.company} Is Not the Business You Think It Is`,
    `The Strategy Behind ${s.company}, In Its Own Filings`,
    `What ${s.company} Is Really Selling`,
    `${s.company}'s Advantage Has an Expiry Date`,
    `Inside the Numbers That Explain ${s.company}`,
  ];
  return {
    titles: stems.map((text, i) => ({
      text: text.slice(0, 100),
      curiosity: spread(seed, `cur${i}`, 55, 94),
      clarity: spread(seed, `cla${i}`, 60, 96),
      searchIntent: spread(seed, `si${i}`, 45, 92),
      emotionalImpact: spread(seed, `ei${i}`, 40, 88),
      uniqueness: spread(seed, `un${i}`, 50, 93),
      credibility: spread(seed, `cr${i}`, 70, 97),
      overclaims: false,
      rationale: 'States a specific, checkable claim rather than a vague promise of revelation.',
    })),
  };
}

function generateThumbnails(s: MockSubject, seed: string) {
  const concepts = [
    { concept: `${s.company} logo against a single rising bar`, headline: 'THE REAL PRODUCT', emotionalHook: 'Recognition plus contradiction' },
    { concept: 'Two objects side by side, one crossed out', headline: 'NOT WHAT YOU THINK', emotionalHook: 'Corrected assumption' },
    { concept: 'A single large number with a small caption', headline: `${s.series.at(-1)?.value ?? ''}B`, emotionalHook: 'Scale' },
    { concept: 'Split frame: public story vs filing', headline: 'PUBLIC vs FILED', emotionalHook: 'Hidden truth' },
    { concept: 'Close crop of the product with a price tag redacted', headline: 'WHO PAYS?', emotionalHook: 'Curiosity gap' },
    { concept: 'Clean line chart with one inflection circled', headline: 'THIS MOMENT', emotionalHook: 'Turning point' },
  ];
  return {
    concepts: concepts.map((c, i) => ({
      ...c,
      visualDirection:
        'High contrast, one focal object, text under six words, legible at 168x94px. No arrows, no shocked face.',
      rubricScore: spread(seed, `th${i}`, 58, 93),
      mobileLegible: true,
      misleadingRisk: 'NONE',
    })),
  };
}

function generateDescription(s: MockSubject, ctx: Ctx) {
  const chapters = (Array.isArray(ctx.chapters) ? ctx.chapters : []) as Array<{ seconds: number; label: string }>;
  const refs = s.sources.slice(0, 4).map((x) => ({ label: `${x.publisher} — ${x.title}`, url: x.url }));
  return {
    body:
      `${s.thesis}\n\n` +
      `In this video we work through ${s.company}'s model using its own reported figures, then test whether the ` +
      `advantage is structural or cyclical.\n\nSources are linked below. Figures are stated as of the dates given ` +
      `on screen.\n\nThis video is analysis, not investment advice.`,
    chapters: chapters.length
      ? chapters
      : [
          { seconds: 0, label: 'The contradiction' },
          { seconds: 95, label: 'The mechanism' },
          { seconds: 260, label: 'The money' },
          { seconds: 430, label: 'What would break it' },
          { seconds: 560, label: 'What it means' },
        ],
    tags: [s.company.toLowerCase(), 'business model', 'business breakdown', 'economics', 'ai business', 'company analysis'],
    references: refs,
    disclosure: null,
  };
}

function generateShorts(s: MockSubject, ctx: Ctx) {
  const sections = (Array.isArray(ctx.sections) ? ctx.sections : []) as Array<{ id: string; narration: string }>;
  const first = sections[0]?.id ?? 's1';
  const second = sections[2]?.id ?? sections[1]?.id ?? 's2';
  return {
    shorts: [
      {
        hook: `${s.company} sells the thing you think is the product at almost no margin.`,
        narration: `${s.company} sells the thing you think is the product at almost no margin. The profit is somewhere else entirely — and it is in the filings. ${s.angle} Full breakdown on the channel.`,
        sourceSectionId: first,
        startSeconds: 0,
        endSeconds: 38,
        onScreenText: ['The product isn’t the business', s.seriesUnit, 'Full breakdown →'],
        ctaToLongForm: 'Watch the full teardown',
      },
      {
        hook: 'One number explains the whole strategy.',
        narration: `${s.seriesTitle}: ${s.series.map((p) => `${p.label} ${p.value}`).join(', ')}. Put those on one axis and the strategy stops looking accidental.`,
        sourceSectionId: second,
        startSeconds: 240,
        endSeconds: 288,
        onScreenText: [s.seriesTitle, `${s.series.at(-1)?.value ?? ''}`, 'Why it matters →'],
        ctaToLongForm: 'The full explanation is in the main video',
      },
    ],
  };
}

// ── QC & learning ─────────────────────────────────────────────────────────

function qcReview(seed: string) {
  return {
    scriptQuality: spread(seed, 'sq', 78, 95),
    originality: spread(seed, 'or', 74, 94),
    visualQuality: spread(seed, 'vq', 70, 92),
    monetizationSafety: spread(seed, 'ms', 82, 99),
    policy: 'PASS',
    aiDisclosure: 'PASS',
    notes: [
      'No investment advice or price targets present.',
      'Every on-screen figure is attributed to a claim with a source.',
      'Synthetic narration is used; YouTube altered-content disclosure is not required for voice-only synthesis of original writing, but confirm current policy before publishing.',
    ],
  };
}

function extractEntities(s: MockSubject) {
  const primary = s.entities[0]!;
  return {
    entities: s.entities.map((e) => ({ name: e.name, kind: e.kind, summary: `${e.name} — referenced in the ${s.company} story.` })),
    relationships: s.entities.slice(1).map((e, i) => ({
      from: primary.name,
      to: e.name,
      relation: i === 0 ? 'DEPENDS_ON' : i === 1 ? 'COMPETES_WITH' : 'OPERATES_IN',
      strength: Math.round((0.5 + i * 0.1) * 100) / 100,
    })),
  };
}

function suggestFollowups(s: MockSubject) {
  return {
    followups: s.entities.slice(1, 4).map((e) => ({
      title: `What ${e.name} Actually Contributes to ${s.company}`,
      angle: `Follow the dependency in the other direction: what happens to ${s.company} if ${e.name} changes terms?`,
      whyNow: 'The relationship is already established in the published video, so the audience is primed for it.',
    })),
  };
}

function learningReport(ctx: Ctx) {
  const n = typeof ctx.videosAnalysed === 'number' ? ctx.videosAnalysed : 0;
  // Under-powered by design at low n — the report must refuse to assert.
  const confident = n >= 20;
  return {
    summary: confident
      ? `Across ${n} published videos, packaging explains more variance in views than topic choice does.`
      : `Only ${n} videos have published analytics. That is not enough to separate signal from noise, so every ` +
        'pattern below is provisional and none should change production yet.',
    findings: confident
      ? [
          {
            pattern: 'Videos opening with a disclosed number outperform those opening with a question.',
            evidence: 'Higher median 30-second retention in the number-opening group.',
            sampleSize: n,
            recommendation: 'Default the hook to a concrete figure; keep the question as the second beat.',
          },
        ]
      : [],
    provisional: [
      {
        pattern: 'Company teardowns appear to hold retention better than industry overviews.',
        sampleSize: n,
        whyUnderpowered: 'Fewer than 8 videos per group; the difference is inside normal variance for this sample.',
      },
    ],
  };
}

function sponsorFit(seed: string, ctx: Ctx) {
  const company = typeof ctx.company === 'string' ? ctx.company : 'the sponsor';
  return {
    fitScore: spread(seed, 'fit', 40, 92),
    rationale: `${company}'s buyer overlaps with an audience that already thinks in unit economics.`,
    audienceMatch: 'Operators and analysts rather than consumers — a narrow but high-value overlap.',
    risks: ['Category conflicts with any future video that critiques the same product class.'],
  };
}
