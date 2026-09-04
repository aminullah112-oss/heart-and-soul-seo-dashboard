import { prisma, type PipelineStage as DbStage } from '@yme/database';
import { newCostTracker, type CostTracker } from '@yme/ai';
import { EngineError, describeError, jobLogger, policyError } from '@yme/shared';
import {
  assertResearchable,
  buildPackaging,
  buildStoryBrief,
  buildStoryboard,
  detectDuplicates,
  factCheckScript,
  runQualityControl,
  runResearch,
  updateGenome,
  writeScript,
} from '@yme/agents';
import { runVisualsStage } from './visuals.js';
import { runVoiceStage } from './voice.js';
import { renderThumbnails, runRenderStage, runShortsStage } from './render-stage.js';
import { cleanupWorkDir } from './workdir.js';

/**
 * Stage registry and runner.
 *
 * Each stage is independently runnable and independently retryable — this is
 * the concrete answer to spec §37's "if thumbnail generation fails, do not
 * restart research". Stages read their inputs from the database, so a retry
 * picks up whatever completed work already exists rather than recomputing it.
 */

export const PRODUCTION_STAGES = [
  'RESEARCH',
  'STORY',
  'SCRIPT',
  'FACT_CHECK',
  'VISUALS',
  'VOICE',
  'RENDER',
  'PACKAGING',
  'QC',
] as const satisfies readonly DbStage[];

export type ProductionStage = (typeof PRODUCTION_STAGES)[number];

export interface StageContext {
  videoProjectId: string;
  jobId?: string;
  tracker?: CostTracker;
}

export interface StageOutcome {
  stage: ProductionStage;
  summary: Record<string, unknown>;
  /** Set when the stage concluded the project cannot continue. */
  blocked: { reason: string } | null;
  nextStage: DbStage | null;
  costUsd: number;
}

type StageFn = (ctx: StageContext) => Promise<{ summary: Record<string, unknown>; blocked?: string | null }>;

const STAGE_IMPLS: Record<ProductionStage, StageFn> = {
  RESEARCH: async (ctx) => {
    const result = await runResearch({ videoProjectId: ctx.videoProjectId, tracker: ctx.tracker, jobId: ctx.jobId });
    return {
      summary: {
        sources: result.sourcesStored,
        unusableSources: result.sourcesUnusable,
        claims: result.claimsStored,
        coverage: result.coverageScore,
        gaps: result.gaps,
      },
      blocked: result.rejected?.reason ?? null,
    };
  },

  STORY: async (ctx) => {
    // Duplicate detection runs here, before the expensive stages, using the
    // title and angle only. The deep script comparison happens at QC.
    const dupes = await detectDuplicates({ videoProjectId: ctx.videoProjectId, jobId: ctx.jobId });
    if (dupes.blocked) {
      return { summary: { duplicateFlags: dupes.flags }, blocked: dupes.flags.find((f) => f.verdict === 'DUPLICATE')!.reason };
    }
    const brief = await buildStoryBrief({ videoProjectId: ctx.videoProjectId, tracker: ctx.tracker, jobId: ctx.jobId });
    return { summary: { arc: brief.arcSections, cannibalizationFlags: dupes.flags.length } };
  },

  SCRIPT: async (ctx) => {
    const result = await writeScript({ videoProjectId: ctx.videoProjectId, tracker: ctx.tracker, jobId: ctx.jobId });
    return {
      summary: {
        version: result.version,
        words: result.wordCount,
        minutes: Math.round((result.estimatedSeconds / 60) * 10) / 10,
        retention: result.retentionScore,
        quality: result.qualityScore,
        rewrites: result.rewrites,
        aiTells: result.aiTellsFound,
      },
    };
  },

  FACT_CHECK: async (ctx) => {
    const result = await factCheckScript({ videoProjectId: ctx.videoProjectId, tracker: ctx.tracker, jobId: ctx.jobId });
    return {
      summary: {
        verdict: result.verdict,
        high: result.highRiskCount,
        medium: result.mediumRiskCount,
        low: result.lowRiskCount,
      },
      // A failed fact check blocks the project rather than continuing to spend
      // money rendering something that cannot be published.
      blocked:
        result.verdict === 'FAIL'
          ? `Fact check failed with ${result.highRiskCount} high-risk finding(s). Fix the script and re-run from SCRIPT.`
          : null,
    };
  },

  VISUALS: async (ctx) => {
    const storyboard = await buildStoryboard({ videoProjectId: ctx.videoProjectId, tracker: ctx.tracker, jobId: ctx.jobId });
    const visuals = await runVisualsStage({ videoProjectId: ctx.videoProjectId, jobId: ctx.jobId });
    return {
      summary: {
        scenes: storyboard.sceneCount,
        charts: storyboard.chartCount,
        rejectedCharts: storyboard.rejectedCharts,
        placeholders: visuals.placeholders,
        stockAcquired: visuals.stockAcquired,
        imagesGenerated: visuals.imagesGenerated,
      },
    };
  },

  VOICE: async (ctx) => {
    const result = await runVoiceStage({ videoProjectId: ctx.videoProjectId, jobId: ctx.jobId });
    return {
      summary: {
        synthesised: result.scenesSynthesised,
        reused: result.scenesReused,
        minutes: Math.round((result.totalSeconds / 60) * 10) / 10,
        pronunciationWarnings: result.pronunciationWarnings.map((w) => w.term),
      },
    };
  },

  RENDER: async (ctx) => {
    const result = await runRenderStage({ videoProjectId: ctx.videoProjectId, jobId: ctx.jobId });
    return {
      summary: {
        renderId: result.renderId,
        minutes: Math.round((result.durationSeconds / 60) * 10) / 10,
        mb: Math.round((result.bytes / 1e6) * 10) / 10,
        scenes: result.sceneCount,
      },
    };
  },

  PACKAGING: async (ctx) => {
    const result = await buildPackaging({ videoProjectId: ctx.videoProjectId, tracker: ctx.tracker, jobId: ctx.jobId });
    // Rasterise the thumbnail concepts now that they exist. This has to happen
    // in PACKAGING, not RENDER: RENDER runs first and there are no concepts to
    // draw at that point.
    const thumbnailsRendered = await renderThumbnails(ctx.videoProjectId);
    return {
      summary: {
        titles: result.titleCount,
        thumbnails: result.thumbnailCount,
        thumbnailsRendered,
        shorts: result.shortCount,
        topTitle: result.topTitle,
        rejectedTitles: result.rejectedTitles,
      },
    };
  },

  QC: async (ctx) => {
    // The deep duplicate pass compares full narration, which only exists now.
    const dupes = await detectDuplicates({ videoProjectId: ctx.videoProjectId, jobId: ctx.jobId, deep: true });
    const qc = await runQualityControl({ videoProjectId: ctx.videoProjectId, tracker: ctx.tracker, jobId: ctx.jobId });
    await updateGenome({ videoProjectId: ctx.videoProjectId, tracker: ctx.tracker, jobId: ctx.jobId });
    await runShortsStage({ videoProjectId: ctx.videoProjectId, jobId: ctx.jobId });

    return {
      summary: {
        finalScore: qc.finalScore,
        passed: qc.passed,
        checks: qc.checks,
        warnings: qc.warnings,
        duplicateFlags: dupes.flags.length,
      },
      blocked: qc.passed ? null : `QC failed: ${qc.blockingReasons.join('; ')}`,
    };
  },
};

export async function runStage(stage: ProductionStage, ctx: StageContext): Promise<StageOutcome> {
  const log = jobLogger({ jobId: ctx.jobId, videoId: ctx.videoProjectId, stage });
  const tracker = ctx.tracker ?? newCostTracker({ videoProjectId: ctx.videoProjectId, stage });
  tracker.setStage(stage);

  const project = await prisma.videoProject.findUnique({
    where: { id: ctx.videoProjectId },
    select: { id: true, status: true, blockedReason: true },
  });
  if (!project) throw new Error(`VideoProject ${ctx.videoProjectId} not found`);
  if (project.status === 'ABANDONED') {
    throw policyError(`Project is ABANDONED; refusing to run ${stage}`);
  }

  const started = Date.now();
  const jobRow = await prisma.automationJob.create({
    data: {
      videoProjectId: ctx.videoProjectId,
      queue: 'production',
      jobName: stage.toLowerCase(),
      bullJobId: ctx.jobId ?? null,
      stage,
      status: 'RUNNING',
      startedAt: new Date(),
    },
  });

  try {
    await prisma.videoProject.update({
      where: { id: ctx.videoProjectId },
      // Clearing blockedReason on entry means a manual retry of a blocked
      // stage starts clean instead of showing a stale reason next to a
      // running job.
      data: { stage, status: 'ACTIVE', blockedReason: null },
    });

    const before = tracker.totalUsd;
    const { summary, blocked } = await STAGE_IMPLS[stage]({ ...ctx, tracker });
    // Cost of THIS stage, not the running total for the whole pipeline.
    const costUsd = Math.round((tracker.totalUsd - before) * 1e6) / 1e6;

    if (blocked) {
      await prisma.$transaction([
        prisma.videoProject.update({
          where: { id: ctx.videoProjectId },
          data: { status: 'BLOCKED', blockedReason: blocked },
        }),
        prisma.automationJob.update({
          where: { id: jobRow.id },
          data: {
            status: 'COMPLETED',
            result: { ...summary, blocked } as unknown as object,
            finishedAt: new Date(),
            durationMs: Date.now() - started,
          },
        }),
      ]);
      log.warn({ blocked }, 'stage completed but blocked the project');
      return { stage, summary, blocked: { reason: blocked }, nextStage: null, costUsd };
    }

    const next = nextStageAfter(stage);
    await prisma.$transaction([
      prisma.automationJob.update({
        where: { id: jobRow.id },
        data: {
          status: 'COMPLETED',
          result: summary as unknown as object,
          finishedAt: new Date(),
          durationMs: Date.now() - started,
        },
      }),
      prisma.videoProject.update({
        where: { id: ctx.videoProjectId },
        data: { stage: next ?? 'APPROVAL' },
      }),
    ]);

    // Intermediates for finished stages are large and no longer needed; the
    // durable artefacts are already in storage.
    if (stage === 'RENDER' || stage === 'QC') {
      await cleanupWorkDir(ctx.videoProjectId, stage === 'RENDER' ? 'visuals' : 'render').catch(() => undefined);
    }

    log.info({ summary, costUsd }, 'stage complete');
    return { stage, summary, blocked: null, nextStage: next ?? 'APPROVAL', costUsd };
  } catch (err) {
    const kind = err instanceof EngineError ? err.kind : 'INTERNAL';
    const retryable = err instanceof EngineError ? err.retryable : false;

    await prisma.$transaction([
      prisma.automationJob.update({
        where: { id: jobRow.id },
        data: {
          status: 'FAILED',
          error: describeError(err).slice(0, 4000),
          errorKind: kind,
          retryable,
          finishedAt: new Date(),
          durationMs: Date.now() - started,
        },
      }),
      prisma.videoProject.update({
        where: { id: ctx.videoProjectId },
        data: {
          status: 'FAILED',
          // The stage is left as-is so a retry re-enters exactly here rather
          // than restarting the pipeline.
          blockedReason: `${stage} failed: ${describeError(err)}`.slice(0, 2000),
        },
      }),
    ]);

    log.error({ err: describeError(err), kind, retryable }, 'stage failed');
    throw err;
  }
}

export function nextStageAfter(stage: ProductionStage): DbStage | null {
  const idx = PRODUCTION_STAGES.indexOf(stage);
  if (idx < 0) return null;
  const next = PRODUCTION_STAGES[idx + 1];
  // After QC the project waits for a human; there is no automatic next stage.
  return next ?? 'APPROVAL';
}

export function isProductionStage(s: string): s is ProductionStage {
  return (PRODUCTION_STAGES as readonly string[]).includes(s);
}

/** Runs the full production pipeline in order, stopping at the first block. */
export async function runProductionPipeline(opts: {
  videoProjectId: string;
  from?: ProductionStage;
  jobId?: string;
  onStage?: (outcome: StageOutcome) => void | Promise<void>;
}): Promise<{ outcomes: StageOutcome[]; blocked: StageOutcome | null; totalCostUsd: number }> {
  const startIdx = opts.from ? PRODUCTION_STAGES.indexOf(opts.from) : 0;
  const tracker = newCostTracker({ videoProjectId: opts.videoProjectId, stage: 'RESEARCH' });
  const outcomes: StageOutcome[] = [];

  for (const stage of PRODUCTION_STAGES.slice(Math.max(0, startIdx))) {
    const outcome = await runStage(stage, { videoProjectId: opts.videoProjectId, jobId: opts.jobId, tracker });
    outcomes.push(outcome);
    await opts.onStage?.(outcome);
    if (outcome.blocked) {
      return { outcomes, blocked: outcome, totalCostUsd: tracker.totalUsd };
    }
  }

  return { outcomes, blocked: null, totalCostUsd: tracker.totalUsd };
}

export { assertResearchable };
