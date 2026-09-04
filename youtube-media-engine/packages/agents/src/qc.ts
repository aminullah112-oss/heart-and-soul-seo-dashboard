import { generateStructured, type CostTracker } from '@yme/ai';
import { prisma, type CheckVerdict } from '@yme/database';
import {
  QcReviewSchema,
  computeQcResult,
  findAiTells,
  jobLogger,
  validationError,
  type ScriptSection,
} from '@yme/shared';
import { houseStyle, JSON_ONLY, QC_SYSTEM } from './prompts.js';
import { requireChannel } from './trend-hunter.js';

export interface QcResultSummary {
  finalScore: number;
  passed: boolean;
  blockingReasons: string[];
  warnings: string[];
  checks: {
    factCheck: CheckVerdict;
    copyright: CheckVerdict;
    policy: CheckVerdict;
    aiDisclosure: CheckVerdict;
  };
}

/**
 * Quality control (spec §36).
 *
 * Composition rule that matters: any FAIL gate blocks regardless of the
 * numeric score. A 96/100 video with an uncleared asset does not ship. The
 * numeric threshold is the *second* gate, not the only one.
 */
export async function runQualityControl(opts: {
  videoProjectId: string;
  tracker?: CostTracker;
  jobId?: string;
}): Promise<QcResultSummary> {
  const log = jobLogger({ jobId: opts.jobId, videoId: opts.videoProjectId, stage: 'QC' });

  const project = await prisma.videoProject.findUnique({
    where: { id: opts.videoProjectId },
    include: {
      topic: true,
      scripts: { where: { isCurrent: true }, take: 1 },
      scenes: true,
      assets: true,
      factCheck: true,
      thumbnails: true,
      titleVariants: true,
      duplicateFlags: { where: { resolvedAt: null } },
    },
  });
  if (!project) throw new Error(`VideoProject ${opts.videoProjectId} not found`);
  const script = project.scripts[0];
  if (!script) throw validationError('QC requested before a script existed');
  const channel = await requireChannel(project.channelId);

  const sections = script.sections as unknown as ScriptSection[];
  const fullText = sections.map((s) => s.narration).join('\n\n');

  // ── Deterministic checks, computed before asking a model anything ──────
  const copyright = assessCopyright(project.assets);
  const factCheck: CheckVerdict = project.factCheck?.verdict ?? 'FAIL';
  const aiTells = findAiTells(fullText);
  const chartScenes = project.scenes.filter((s) => s.chartSpec !== null).length;
  const visualQuality = assessVisualQuality({
    sceneCount: project.scenes.length,
    chartCount: chartScenes,
    durationSeconds: script.estimatedSeconds,
    assetsWithoutSource: project.assets.filter((a) => !a.sourceUrl && a.provider === 'mock').length,
  });

  // ── Model review ───────────────────────────────────────────────────────
  const { value } = await generateStructured({
    task: 'qc-review',
    schema: QcReviewSchema,
    system: `${QC_SYSTEM}\n\n${houseStyle(channel)}`,
    prompt: [
      'Review this video before it goes to a human.',
      '',
      `TITLE CANDIDATES: ${project.titleVariants.slice(0, 5).map((t) => t.text).join(' | ')}`,
      `FACT CHECK VERDICT: ${factCheck} (${project.factCheck?.highRiskCount ?? 0} high-risk findings)`,
      `SCENES: ${project.scenes.length}, of which ${chartScenes} are charts`,
      '',
      'SCRIPT:',
      sections.map((s) => `## ${s.heading}\n${s.narration}`).join('\n\n').slice(0, 18_000),
      '',
      'Score scriptQuality, originality, visualQuality and monetizationSafety 0-100.',
      'Originality: does this contain analysis a viewer could not get from reading one article?',
      'Flag policy problems and whether AI disclosure is warranted.',
      '',
      'Return: {"scriptQuality","originality","visualQuality","monetizationSafety","policy","aiDisclosure","notes":[]}',
      JSON_ONLY,
    ].join('\n'),
    maxTokens: 2500,
    temperature: 0.2,
    tracker: opts.tracker,
    ctx: { videoProjectId: project.id, stage: 'QC', jobId: opts.jobId },
    mockContext: { title: project.topic.title },
  });

  // Mechanical evidence overrides the model where it is more reliable: the
  // script-quality number computed from measurable properties, and the visual
  // score derived from actual scene counts.
  const scriptQuality = Math.min(value.scriptQuality, script.qualityScore ?? value.scriptQuality);
  const retention = script.retentionScore ?? 0;

  const result = computeQcResult(
    {
      factCheck: factCheck === 'PASS' ? 'PASS' : 'FAIL',
      copyright: copyright.verdict,
      policy: value.policy,
      aiDisclosure: value.aiDisclosure,
      scriptQuality,
      retention,
      visualQuality: Math.min(value.visualQuality, visualQuality.score),
      monetizationSafety: value.monetizationSafety,
      originality: value.originality,
    },
    channel.minimumQcScore,
  );

  // Unresolved duplicate flags are a blocking condition of their own (§27/§28).
  const blocking = [...result.blockingReasons];
  const warnings = [...result.warnings, ...copyright.warnings, ...visualQuality.warnings];

  for (const flag of project.duplicateFlags) {
    if (flag.verdict === 'DUPLICATE') blocking.push(`Unresolved duplicate flag: ${flag.reason}`);
    else if (flag.verdict === 'CANNIBALIZES') warnings.push(`Cannibalization flag: ${flag.reason}`);
  }
  if (aiTells.length) warnings.push(`Script contains banned filler phrases: ${aiTells.join(', ')}`);
  if (project.thumbnails.length === 0) blocking.push('No thumbnail concepts were generated');
  if (project.titleVariants.length === 0) blocking.push('No usable title candidates were generated');

  const passed = blocking.length === 0;

  await prisma.qcReport.upsert({
    where: { videoProjectId: project.id },
    update: {
      scriptVersion: script.version,
      factCheck,
      copyright: copyright.verdict,
      policy: value.policy,
      aiDisclosure: value.aiDisclosure,
      scriptQuality,
      retention,
      visualQuality: Math.min(value.visualQuality, visualQuality.score),
      monetizationSafety: value.monetizationSafety,
      originality: value.originality,
      finalScore: result.finalScore,
      passed,
      blockingReasons: blocking,
      warnings,
      detail: { modelNotes: value.notes, copyright: copyright.detail, aiTells } as unknown as object,
    },
    create: {
      videoProjectId: project.id,
      scriptVersion: script.version,
      factCheck,
      copyright: copyright.verdict,
      policy: value.policy,
      aiDisclosure: value.aiDisclosure,
      scriptQuality,
      retention,
      visualQuality: Math.min(value.visualQuality, visualQuality.score),
      monetizationSafety: value.monetizationSafety,
      originality: value.originality,
      finalScore: result.finalScore,
      passed,
      blockingReasons: blocking,
      warnings,
      detail: { modelNotes: value.notes, copyright: copyright.detail, aiTells } as unknown as object,
    },
  });

  log.info({ finalScore: result.finalScore, passed, blocking: blocking.length }, 'QC complete');

  return {
    finalScore: result.finalScore,
    passed,
    blockingReasons: blocking,
    warnings,
    checks: { factCheck, copyright: copyright.verdict, policy: value.policy, aiDisclosure: value.aiDisclosure },
  };
}

/** Copyright verdict from the asset registry (spec §15). */
export function assessCopyright(
  assets: Array<{ kind: string; copyrightRisk: string; licence: string | null; clearedAt: Date | null; provider: string }>,
): { verdict: CheckVerdict; warnings: string[]; detail: Record<string, number> } {
  const external = assets.filter((a) => a.kind !== 'CHART_PNG' && a.kind !== 'AUDIO_VOICE' && a.kind !== 'SUBTITLE');
  const high = external.filter((a) => a.copyrightRisk === 'HIGH');
  const unknown = external.filter((a) => a.copyrightRisk === 'UNKNOWN');
  const unlicensed = external.filter((a) => !a.licence && a.provider !== 'mock' && a.provider !== 'internal');

  const warnings: string[] = [];
  let verdict: CheckVerdict = 'PASS';

  if (high.length) {
    verdict = 'FAIL';
  } else if (unknown.length || unlicensed.length) {
    verdict = 'WARNING';
    if (unknown.length) warnings.push(`${unknown.length} asset(s) have an unassessed copyright risk`);
    if (unlicensed.length) warnings.push(`${unlicensed.length} asset(s) have no recorded licence`);
  }

  return {
    verdict,
    warnings,
    detail: { total: external.length, high: high.length, unknown: unknown.length, unlicensed: unlicensed.length },
  };
}

/**
 * Visual quality from measurable structure. Spec §18 says "do not create a
 * static slideshow", and shot rate is the measurable form of that.
 */
export function assessVisualQuality(input: {
  sceneCount: number;
  chartCount: number;
  durationSeconds: number;
  assetsWithoutSource: number;
}): { score: number; warnings: string[] } {
  const warnings: string[] = [];
  let score = 100;

  const secondsPerScene = input.sceneCount > 0 ? input.durationSeconds / input.sceneCount : Infinity;
  if (secondsPerScene > 14) {
    score -= 30;
    warnings.push(`Average shot length is ${secondsPerScene.toFixed(1)}s — this will read as a slideshow`);
  } else if (secondsPerScene > 10) {
    score -= 12;
    warnings.push(`Average shot length is ${secondsPerScene.toFixed(1)}s — consider more cuts`);
  }

  const chartsPerTenMinutes = (input.chartCount / Math.max(1, input.durationSeconds)) * 600;
  if (chartsPerTenMinutes < 1) {
    score -= 10;
    warnings.push('No data visualisation — business explainers lose clarity without at least one chart');
  }

  if (input.assetsWithoutSource > 0) {
    score -= Math.min(25, input.assetsWithoutSource * 3);
    warnings.push(`${input.assetsWithoutSource} placeholder asset(s) present — real media has not been sourced`);
  }

  return { score: Math.max(0, Math.min(100, Math.round(score))), warnings };
}
