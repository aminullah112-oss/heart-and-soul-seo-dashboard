import { generateStructured, type CostTracker } from '@yme/ai';
import { prisma, type VisualKind } from '@yme/database';
import {
  StoryboardSchema,
  estimateNarrationSeconds,
  jobLogger,
  validationError,
  type ChartSpec,
  type ScriptSection,
} from '@yme/shared';
import { houseStyle, JSON_ONLY, VISUAL_SYSTEM } from './prompts.js';
import { requireChannel } from './trend-hunter.js';

export interface StoryboardResult {
  storyboardId: string;
  sceneCount: number;
  chartCount: number;
  rejectedCharts: Array<{ sceneId: string; reason: string }>;
  longestSceneSeconds: number;
}

/** A static shot held longer than this reads as a slideshow (spec §18). */
export const MAX_SCENE_SECONDS = 12;

/**
 * Agent 7 — Visual Director (spec §14, §15, §16).
 *
 * The load-bearing rule: a chart whose numbers cannot be traced to a stored
 * claim is DROPPED, not rendered. Spec §16 forbids decorative charts with
 * fabricated numbers, and a model asked for "a chart of their revenue" will
 * happily invent a plausible series. This is enforced against the database,
 * not the prompt.
 */
export async function buildStoryboard(opts: {
  videoProjectId: string;
  tracker?: CostTracker;
  jobId?: string;
}): Promise<StoryboardResult> {
  const log = jobLogger({ jobId: opts.jobId, videoId: opts.videoProjectId, stage: 'VISUALS' });

  const project = await prisma.videoProject.findUnique({
    where: { id: opts.videoProjectId },
    include: {
      topic: true,
      scripts: { where: { isCurrent: true }, take: 1 },
      research: { include: { claims: { include: { sourceLinks: { include: { source: true } } } } } },
    },
  });
  if (!project) throw new Error(`VideoProject ${opts.videoProjectId} not found`);
  const script = project.scripts[0];
  if (!script) throw validationError('Storyboard requested before a script existed');
  const channel = await requireChannel(project.channelId);

  const sections = script.sections as unknown as ScriptSection[];
  const claims = project.research?.claims ?? [];
  const claimsByKey = new Map(claims.map((c) => [c.key, c]));

  const numericClaims = claims.filter((c) => c.kind === 'QUANTITATIVE' || c.kind === 'FINANCIAL');
  const chartableBlock = numericClaims.length
    ? numericClaims.map((c) => `- ${c.key}: ${c.text}`).join('\n')
    : '(no quantitative claims — do not produce any charts for this video)';

  const { value } = await generateStructured({
    task: 'storyboard',
    schema: StoryboardSchema,
    system: `${VISUAL_SYSTEM}\n\n${houseStyle(channel)}`,
    prompt: [
      'Turn this script into a shot plan.',
      '',
      'SCRIPT SECTIONS:',
      sections.map((s) => `## ${s.id} — ${s.heading}\n${s.narration}`).join('\n\n'),
      '',
      'CLAIMS THAT CONTAIN NUMBERS (charts may ONLY use data from these, and must cite the key):',
      chartableBlock,
      '',
      `Break each section into beats of 4-${MAX_SCENE_SECONDS} seconds. Scene ids must be unique.`,
      'visualKind is one of STOCK_VIDEO, STOCK_IMAGE, GENERATED_IMAGE, CHART, SCREENSHOT, TEXT_CARD,',
      'MAP, ARCHIVAL, B_ROLL. For CHART scenes, supply the full chart object with sourceClaimKey.',
      '',
      'Return: {"scenes":[{"id","sectionId","index","narration","visualKind","visualQuery","onScreenText",',
      '"chart":null|{...},"estimatedSeconds"}]}',
      JSON_ONLY,
    ].join('\n'),
    maxTokens: 14_000,
    temperature: 0.6,
    tracker: opts.tracker,
    ctx: { videoProjectId: project.id, stage: 'VISUALS', jobId: opts.jobId },
    mockContext: { title: project.topic.title, sections },
  });

  const knownSections = new Set(sections.map((s) => s.id));
  const rejectedCharts: Array<{ sceneId: string; reason: string }> = [];
  const seenIds = new Set<string>();

  const scenes = value.scenes
    .filter((s) => {
      if (!knownSections.has(s.sectionId)) {
        log.warn({ sceneId: s.id, sectionId: s.sectionId }, 'scene references unknown section; dropped');
        return false;
      }
      if (seenIds.has(s.id)) {
        log.warn({ sceneId: s.id }, 'duplicate scene id; dropped');
        return false;
      }
      seenIds.add(s.id);
      return true;
    })
    .map((s, i) => {
      let chart: ChartSpec | null = s.chart;

      if (chart) {
        const problem = validateChart(chart, claimsByKey);
        if (problem) {
          rejectedCharts.push({ sceneId: s.id, reason: problem });
          chart = null;
        }
      }

      // Timing from the narration itself: a model's own estimate drifts, and
      // the render re-measures against real audio anyway.
      const estimated = Math.max(2.5, estimateNarrationSeconds(s.narration));

      return {
        ...s,
        index: i,
        // A dropped chart leaves the scene without a visual; fall back to a
        // text card rather than rendering an empty frame.
        visualKind: (chart ? 'CHART' : s.visualKind === 'CHART' ? 'TEXT_CARD' : s.visualKind) as VisualKind,
        chart,
        estimatedSeconds: estimated,
      };
    });

  if (scenes.length === 0) throw validationError('Storyboard produced no usable scenes');

  // Split any scene that would hold a single shot past the ceiling.
  //
  // Warning about this was not enough: a model asked for "beats" reliably
  // returns whole paragraphs, which produced a 29-second average shot length
  // and a video that reads as a slideshow — exactly what spec §18 forbids.
  // The fix has to be mechanical, because the constraint is arithmetic.
  const paced = splitLongScenes(scenes, MAX_SCENE_SECONDS);
  if (paced.length > scenes.length) {
    log.info(
      { before: scenes.length, after: paced.length },
      'split over-long scenes to keep shot length under the ceiling',
    );
  }
  scenes.length = 0;
  scenes.push(...paced);

  const storyboard = await prisma.$transaction(async (tx) => {
    const existing = await tx.storyboard.findUnique({ where: { videoProjectId: project.id } });
    if (existing) {
      // Rebuilding replaces scenes wholesale; keeping stale rows would leave
      // orphaned voiceovers pointing at scenes that no longer exist.
      await tx.scene.deleteMany({ where: { storyboardId: existing.id } });
      await tx.storyboard.update({ where: { id: existing.id }, data: { scriptVersion: script.version } });
    }
    const sb =
      existing ??
      (await tx.storyboard.create({
        data: { videoProjectId: project.id, scriptVersion: script.version },
      }));

    let cursor = 0;
    for (const s of scenes) {
      await tx.scene.create({
        data: {
          storyboardId: sb.id,
          videoProjectId: project.id,
          sectionId: s.sectionId,
          index: s.index,
          narration: s.narration,
          visualKind: s.visualKind,
          visualQuery: s.visualQuery,
          onScreenText: s.onScreenText,
          chartSpec: (s.chart ?? undefined) as never,
          estimatedSeconds: s.estimatedSeconds,
          startSeconds: cursor,
        },
      });
      cursor += s.estimatedSeconds;
    }
    return sb;
  });

  const chartCount = scenes.filter((s) => s.chart).length;
  log.info(
    { scenes: scenes.length, charts: chartCount, rejectedCharts: rejectedCharts.length },
    'storyboard built',
  );

  return {
    storyboardId: storyboard.id,
    sceneCount: scenes.length,
    chartCount,
    rejectedCharts,
    longestSceneSeconds: Math.max(...scenes.map((s) => s.estimatedSeconds)),
  };
}

type PlannedScene = {
  id: string;
  sectionId: string;
  index: number;
  narration: string;
  visualKind: VisualKind;
  visualQuery: string;
  onScreenText: string | null;
  chart: ChartSpec | null;
  estimatedSeconds: number;
};

/**
 * Splits scenes whose narration would hold one shot too long.
 *
 * Splits on sentence boundaries so narration and picture stay in step — a
 * mid-sentence cut with the audio running across it is worse than a long shot.
 * A chart scene is never split: the chart is the shot, and cutting away from
 * a chart mid-explanation defeats the point of drawing it.
 */
export function splitLongScenes(scenes: PlannedScene[], maxSeconds: number): PlannedScene[] {
  const out: PlannedScene[] = [];

  for (const scene of scenes) {
    if (scene.estimatedSeconds <= maxSeconds || scene.chart) {
      out.push(scene);
      continue;
    }

    const pieces = Math.min(6, Math.ceil(scene.estimatedSeconds / maxSeconds));
    const sentences = scene.narration
      .split(/(?<=[.!?])\s+/)
      .map((x) => x.trim())
      .filter(Boolean);

    if (sentences.length < 2) {
      // Nothing to split on; a single very long sentence stays whole.
      out.push(scene);
      continue;
    }

    const perPiece = Math.ceil(sentences.length / pieces);
    const chunks: string[] = [];
    for (let i = 0; i < sentences.length; i += perPiece) {
      chunks.push(sentences.slice(i, i + perPiece).join(' '));
    }

    for (const [ci, chunk] of chunks.entries()) {
      out.push({
        ...scene,
        id: ci === 0 ? scene.id : `${scene.id}-${ci}`,
        narration: chunk,
        // Only the first piece keeps the section's on-screen title; repeating
        // it on every shot looks like a bug.
        onScreenText: ci === 0 ? scene.onScreenText : null,
        // Vary the visual so consecutive pieces are not the same still.
        visualQuery: ci === 0 ? scene.visualQuery : `${scene.visualQuery}, alternate angle ${ci + 1}`,
        estimatedSeconds: estimateNarrationSeconds(chunk),
        index: 0,
      });
    }
  }

  return out.map((s, i) => ({ ...s, index: i }));
}

/**
 * A chart is publishable only if its data traces to a stored claim. Returns a
 * reason string when it does not.
 */
export function validateChart(
  chart: ChartSpec,
  claimsByKey: Map<string, { key: string; kind: string; status: string }>,
): string | null {
  const claim = claimsByKey.get(chart.sourceClaimKey);
  if (!claim) {
    return `chart cites claim "${chart.sourceClaimKey}", which does not exist — its numbers cannot be traced to a source`;
  }
  if (claim.status === 'REJECTED') {
    return `chart cites claim "${chart.sourceClaimKey}", which was rejected during research`;
  }
  if (claim.kind !== 'QUANTITATIVE' && claim.kind !== 'FINANCIAL') {
    return `chart cites claim "${chart.sourceClaimKey}", which is ${claim.kind} and carries no data series`;
  }
  const points = chart.series.reduce((n, s) => n + s.points.length, 0);
  if (points < 2) return 'chart has fewer than two data points';
  if (chart.series.some((s) => s.points.some((p) => !Number.isFinite(p.value)))) {
    return 'chart contains a non-finite value';
  }
  return null;
}
