import { prisma } from '@yme/database';
import { describeError, jobLogger } from '@yme/shared';
import { newCostTracker } from '@yme/ai';
import { discoverTopics, scorePendingTopics } from '@yme/agents';
import { ingestAllPublished, buildLearningReport } from '@yme/analytics';
import { runPublish, runStage, isProductionStage, type ProductionStage } from '@yme/pipeline';
import { getQueue, QUEUE_NAMES, RENDER_JOB_OPTIONS, PUBLISH_JOB_OPTIONS } from '../queues.js';
import type { AnalyticsJobData, DiscoveryJobData, LearningJobData, PublishJobData, StageJobData } from './types.js';

/**
 * Job handlers.
 *
 * Chaining is explicit: a stage job enqueues the NEXT stage on success rather
 * than running the whole pipeline in one job. That is what makes a failure at
 * RENDER cost one RENDER retry instead of re-running research — the earlier
 * stages already completed as separate, finished jobs.
 */

export async function handleStage(data: StageJobData, bullJobId?: string): Promise<Record<string, unknown>> {
  if (!isProductionStage(data.stage)) throw new Error(`Unknown production stage: ${data.stage}`);

  const outcome = await runStage(data.stage as ProductionStage, {
    videoProjectId: data.videoProjectId,
    jobId: bullJobId,
  });

  if (data.chain && !outcome.blocked && outcome.nextStage && isProductionStage(outcome.nextStage)) {
    await enqueueStage({
      videoProjectId: data.videoProjectId,
      stage: outcome.nextStage as ProductionStage,
      chain: true,
    });
  }

  return { stage: outcome.stage, blocked: outcome.blocked, cost: outcome.costUsd, ...outcome.summary };
}

export async function enqueueStage(data: StageJobData): Promise<string> {
  // Render goes to its own queue so a long encode does not occupy the slot a
  // cheap research job needs.
  const isRender = data.stage === 'RENDER';
  const queue = getQueue(isRender ? QUEUE_NAMES.render : QUEUE_NAMES.production);
  const job = await queue.add('stage', data, {
    ...(isRender ? RENDER_JOB_OPTIONS : {}),
    // Deduplicates re-enqueues of the same stage for the same project while
    // one is already pending.
    jobId: `${data.videoProjectId}:${data.stage}`,
  });
  return job.id ?? '';
}

export async function handlePublish(data: PublishJobData, bullJobId?: string): Promise<Record<string, unknown>> {
  const result = await runPublish({ publishingJobId: data.publishingJobId, jobId: bullJobId });
  return { youtubeId: result.youtubeId, visibility: result.visibility, mock: result.mock };
}

export async function enqueuePublish(publishingJobId: string, delayMs = 0): Promise<void> {
  await getQueue(QUEUE_NAMES.publish).add(
    'publish',
    { publishingJobId } satisfies PublishJobData,
    { ...PUBLISH_JOB_OPTIONS, delay: delayMs, jobId: `publish:${publishingJobId}` },
  );
}

export async function handleDiscovery(data: DiscoveryJobData, bullJobId?: string): Promise<Record<string, unknown>> {
  const tracker = newCostTracker({ stage: 'DISCOVERY', limitUsd: 5 });
  const result = await discoverTopics({
    channelId: data.channelId,
    limit: data.limit,
    tracker,
    jobId: bullJobId,
  });
  return { created: result.created, skipped: result.skippedAsDuplicate.length, cost: tracker.totalUsd };
}

export async function handleScoring(data: DiscoveryJobData, bullJobId?: string): Promise<Record<string, unknown>> {
  const tracker = newCostTracker({ stage: 'DISCOVERY', limitUsd: 5 });
  const results = await scorePendingTopics({ channelId: data.channelId, tracker, jobId: bullJobId });
  return {
    scored: results.length,
    passed: results.filter((r) => r.passed).length,
    cost: tracker.totalUsd,
  };
}

export async function handleAnalytics(data: AnalyticsJobData, bullJobId?: string): Promise<Record<string, unknown>> {
  const count = await ingestAllPublished({ channelId: data.channelId, jobId: bullJobId });
  return { videosUpdated: count };
}

export async function handleLearning(data: LearningJobData, bullJobId?: string): Promise<Record<string, unknown>> {
  const days = data.periodDays ?? 7;
  const periodEnd = new Date();
  const periodStart = new Date(periodEnd.getTime() - days * 86_400_000);
  const tracker = newCostTracker({ stage: 'PUBLISHED', limitUsd: 3 });

  const result = await buildLearningReport({
    channelId: data.channelId,
    periodStart,
    periodEnd,
    tracker,
    jobId: bullJobId,
  });
  return {
    videosAnalysed: result.videosAnalysed,
    findings: result.findings,
    provisional: result.provisional,
    underpowered: result.underpowered,
  };
}

/**
 * Sweeps for approved publishing jobs whose scheduled time has arrived.
 *
 * Polled rather than delay-queued so a scheduled publish survives a Redis
 * flush: the source of truth is the PublishingJob row, and losing the queue
 * loses nothing but a timer.
 */
export async function handlePublishDue(): Promise<Record<string, unknown>> {
  const log = jobLogger({ stage: 'SCHEDULED' });
  const due = await prisma.publishingJob.findMany({
    where: {
      status: 'SCHEDULED',
      approvedById: { not: null },
      OR: [{ scheduledFor: null }, { scheduledFor: { lte: new Date() } }],
    },
    select: { id: true },
    take: 10,
  });

  let enqueued = 0;
  for (const job of due) {
    try {
      await enqueuePublish(job.id);
      enqueued++;
    } catch (err) {
      log.warn({ publishingJobId: job.id, err: describeError(err) }, 'failed to enqueue due publish');
    }
  }
  return { due: due.length, enqueued };
}
