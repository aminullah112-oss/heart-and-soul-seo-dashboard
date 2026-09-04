import { generateStructured, type CostTracker } from '@yme/ai';
import { prisma } from '@yme/database';
import {
  RetentionAnalysisSchema,
  ScriptSchema,
  countWords,
  estimateNarrationSeconds,
  findAiTells,
  jobLogger,
  targetWordCount,
  validationError,
  type RetentionAnalysis,
  type ScriptSection,
} from '@yme/shared';
import { houseStyle, JSON_ONLY, SCRIPT_SYSTEM } from './prompts.js';
import { requireChannel } from './trend-hunter.js';

export interface ScriptResult {
  scriptId: string;
  version: number;
  wordCount: number;
  estimatedSeconds: number;
  retentionScore: number;
  qualityScore: number;
  rewrites: number;
  aiTellsFound: string[];
}

/** Retention floor below which the script is rewritten rather than shipped (spec §12). */
export const RETENTION_FLOOR = 72;
export const MAX_REWRITES = 2;

/**
 * Agents 5 + 6 — Scriptwriter and Retention Engine (spec §11, §12).
 *
 * They are one function because the rewrite loop is the point: generating a
 * script and separately reporting that it is weak, with nothing acting on
 * that, is what most of these systems do. Here a sub-floor retention score
 * triggers a targeted rewrite that receives the specific findings.
 */
export async function writeScript(opts: {
  videoProjectId: string;
  tracker?: CostTracker;
  jobId?: string;
}): Promise<ScriptResult> {
  const log = jobLogger({ jobId: opts.jobId, videoId: opts.videoProjectId, stage: 'SCRIPT' });

  const project = await prisma.videoProject.findUnique({
    where: { id: opts.videoProjectId },
    include: {
      topic: true,
      storyBrief: true,
      research: { include: { claims: true } },
    },
  });
  if (!project) throw new Error(`VideoProject ${opts.videoProjectId} not found`);
  if (!project.storyBrief) throw validationError('Script requested before the story brief was built');
  if (!project.research) throw validationError('Script requested before research completed');
  const channel = await requireChannel(project.channelId);

  const usableClaims = project.research.claims.filter((c) => c.status !== 'REJECTED');
  const claimBlock = usableClaims
    .map((c) => `- ${c.key} [${c.confidence}/${c.status}] ${c.text}${c.asOf ? ` (as of ${c.asOf.toISOString().slice(0, 10)})` : ''}`)
    .join('\n');

  const arc = (project.storyBrief.narrativeArc as Array<{ section: string; purpose: string }>) ?? [];
  const targetWords = targetWordCount(project.targetMinutes);

  const basePrompt = [
    'Write the narration for this video.',
    '',
    `CENTRAL QUESTION: ${project.storyBrief.centralQuestion}`,
    `THESIS: ${project.storyBrief.thesis}`,
    `HOOK DIRECTION: ${project.storyBrief.hook}`,
    `CONFLICT: ${project.storyBrief.conflict}`,
    `STAKES: ${project.storyBrief.stakes}`,
    `ENDING: ${project.storyBrief.ending}`,
    `CTA: ${project.storyBrief.cta}`,
    '',
    'NARRATIVE ARC (follow this structure):',
    arc.map((s, i) => `${i + 1}. ${s.section} — ${s.purpose}`).join('\n'),
    '',
    'CLAIMS YOU MAY ASSERT (nothing else):',
    claimBlock,
    '',
    `TARGET: about ${targetWords} words (${project.targetMinutes} minutes at ~150 wpm). Being 10% over or under is fine.`,
    '',
    'For each section give: id, heading, narration, claimKeys (the claims that section relies on),',
    'openLoop (the question it leaves open, or null for the final section).',
    '',
    'Return: {"workingTitle","sections":[{"id","heading","narration","claimKeys":[],"openLoop"}]}',
    JSON_ONLY,
  ].join('\n');

  const system = `${SCRIPT_SYSTEM}\n\n${houseStyle(channel)}`;
  const mockContext = {
    title: project.topic.title,
    narrativeArc: arc,
    claimKeys: usableClaims.map((c) => c.key),
  };

  let draft = await generateStructured({
    task: 'write-script',
    schema: ScriptSchema,
    system,
    prompt: basePrompt,
    maxTokens: 12_000,
    temperature: 0.85,
    tracker: opts.tracker,
    ctx: { videoProjectId: project.id, stage: 'SCRIPT', jobId: opts.jobId },
    mockContext,
  });

  let analysis = await analyzeRetention({
    sections: draft.value.sections,
    hook: project.storyBrief.hook,
    channelId: channel.id,
    tracker: opts.tracker,
    videoProjectId: project.id,
    jobId: opts.jobId,
  });

  let rewrites = 0;
  while (analysis.overall < RETENTION_FLOOR && rewrites < MAX_REWRITES) {
    rewrites++;
    log.warn({ retention: analysis.overall, attempt: rewrites }, 'retention below floor, rewriting');

    const fixes = [
      ...analysis.weakestSections.map((w) => `- ${w.sectionId}: ${w.problem} → ${w.fix}`),
      ...analysis.cutCandidates.map((c) => `- ${c.sectionId}: CUT — ${c.reason}`),
    ].join('\n');

    draft = await generateStructured({
      task: 'revise-script',
      schema: ScriptSchema,
      system,
      prompt: [
        'This draft scored below the retention floor. Rewrite it, fixing these specific problems.',
        '',
        `RETENTION SCORE: ${analysis.overall} (floor is ${RETENTION_FLOOR})`,
        `HOOK STRENGTH: ${analysis.hookStrength}  FIRST 30s: ${analysis.first30Seconds}`,
        '',
        'PROBLEMS TO FIX:',
        fixes || '- The opening does not give the viewer a reason to keep watching.',
        '',
        'CURRENT DRAFT:',
        JSON.stringify(draft.value, null, 2).slice(0, 20_000),
        '',
        'Keep the same claims and the same structure unless a section is marked CUT.',
        'Return the full corrected script in the same shape.',
        JSON_ONLY,
      ].join('\n'),
      maxTokens: 12_000,
      temperature: 0.8,
      tracker: opts.tracker,
      ctx: { videoProjectId: project.id, stage: 'SCRIPT', jobId: opts.jobId },
      mockContext: { ...mockContext, revision: rewrites },
    });

    analysis = await analyzeRetention({
      sections: draft.value.sections,
      hook: project.storyBrief.hook,
      channelId: channel.id,
      tracker: opts.tracker,
      videoProjectId: project.id,
      jobId: opts.jobId,
      // The mock deterministically improves on revision so the loop terminates
      // offline instead of burning MAX_REWRITES every run.
      forcePass: true,
    });
  }

  // Claim keys are reconciled against the database rather than trusted.
  const knownKeys = new Set(usableClaims.map((c) => c.key));
  const sections: ScriptSection[] = draft.value.sections.map((s) => ({
    ...s,
    claimKeys: s.claimKeys.filter((k) => knownKeys.has(k)),
  }));

  const fullText = sections.map((s) => s.narration).join('\n\n');
  const wordCount = countWords(fullText);
  const estimatedSeconds = estimateNarrationSeconds(fullText);
  const aiTells = findAiTells(fullText);
  const qualityScore = scoreScriptQuality({ sections, wordCount, targetWords, aiTells });

  const previous = await prisma.script.findFirst({
    where: { videoProjectId: project.id },
    orderBy: { version: 'desc' },
    select: { version: true },
  });
  const version = (previous?.version ?? 0) + 1;

  const [, script] = await prisma.$transaction([
    prisma.script.updateMany({ where: { videoProjectId: project.id }, data: { isCurrent: false } }),
    prisma.script.create({
      data: {
        videoProjectId: project.id,
        version,
        workingTitle: draft.value.workingTitle,
        sections: sections as unknown as object,
        wordCount,
        estimatedSeconds,
        retentionScore: analysis.overall,
        retentionAnalysis: analysis as unknown as object,
        qualityScore,
        isCurrent: true,
        revisionReason: rewrites > 0 ? `Rewritten ${rewrites}x to clear the retention floor` : null,
      },
    }),
  ]);

  if (aiTells.length) log.warn({ aiTells }, 'script contains banned filler phrases');
  log.info({ version, wordCount, retention: analysis.overall, rewrites }, 'script written');

  return {
    scriptId: script.id,
    version,
    wordCount,
    estimatedSeconds,
    retentionScore: analysis.overall,
    qualityScore,
    rewrites,
    aiTellsFound: aiTells,
  };
}

async function analyzeRetention(opts: {
  sections: ScriptSection[];
  hook: string;
  channelId: string;
  videoProjectId: string;
  tracker?: CostTracker;
  jobId?: string;
  forcePass?: boolean;
}): Promise<RetentionAnalysis> {
  const channel = await requireChannel(opts.channelId);
  const { value } = await generateStructured({
    task: 'analyze-retention',
    schema: RetentionAnalysisSchema,
    system: [
      'You analyse scripts for viewer retention. You are looking for the exact moment a viewer',
      'decides to leave, and the sentence that caused it.',
      '',
      'Be specific. "Improve the pacing" is not a finding; "section 3 explains the mechanism for 90',
      'seconds before saying why it matters" is.',
      '',
      houseStyle(channel),
    ].join('\n'),
    prompt: [
      'Analyse this script for retention.',
      '',
      'SCRIPT:',
      opts.sections.map((s) => `## ${s.id} — ${s.heading}\n${s.narration}`).join('\n\n'),
      '',
      'Score each dimension 0-100 and give an overall.',
      'Identify the weakest sections with a concrete problem and a concrete fix, and any sections',
      'that should be cut entirely.',
      '',
      'Return: {"hookStrength","first30Seconds","curiosityGaps","pacing","informationDensity",',
      '"patternInterrupts","narrativeTension","payoffFrequency","overall",',
      '"weakestSections":[{"sectionId","problem","fix"}],"cutCandidates":[{"sectionId","reason"}]}',
      JSON_ONLY,
    ].join('\n'),
    maxTokens: 2500,
    temperature: 0.3,
    tracker: opts.tracker,
    ctx: { videoProjectId: opts.videoProjectId, stage: 'SCRIPT', jobId: opts.jobId },
    mockContext: { sectionIds: opts.sections.map((s) => s.id), forcePass: opts.forcePass === true },
  });
  return value;
}

/**
 * Mechanical script quality. Computed in code rather than asked of a model,
 * because these properties are objectively measurable and a model asked to
 * grade its own writing grades generously.
 */
export function scoreScriptQuality(input: {
  sections: ScriptSection[];
  wordCount: number;
  targetWords: number;
  aiTells: string[];
}): number {
  let score = 100;

  // Length discipline: the target exists because 8-15 minutes is the format.
  const drift = Math.abs(input.wordCount - input.targetWords) / input.targetWords;
  if (drift > 0.35) score -= 25;
  else if (drift > 0.2) score -= 12;
  else if (drift > 0.1) score -= 4;

  // Each banned phrase is a visible tell that the script was not edited.
  score -= Math.min(20, input.aiTells.length * 5);

  // Open loops that never close.
  const openers = input.sections.filter((s) => s.openLoop).length;
  if (openers === 0 && input.sections.length > 3) score -= 10;

  // Sections with no claims are opinion; a few are fine, mostly is not.
  const unsupported = input.sections.filter((s) => s.claimKeys.length === 0).length;
  if (unsupported / input.sections.length > 0.6) score -= 15;

  // Repeated openings read as templated.
  const openings = input.sections.map((s) => s.narration.trim().split(/\s+/).slice(0, 3).join(' ').toLowerCase());
  const distinct = new Set(openings).size;
  if (distinct < openings.length) score -= (openings.length - distinct) * 4;

  // Very short sections usually mean the model padded the structure.
  const thin = input.sections.filter((s) => countWords(s.narration) < 40).length;
  score -= thin * 3;

  return Math.max(0, Math.min(100, Math.round(score)));
}
