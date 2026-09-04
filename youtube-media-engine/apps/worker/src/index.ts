import { Worker, type Job } from 'bullmq';
import { env, loadEnv } from '@yme/config';
import { prisma, logSystem, disconnect } from '@yme/database';
import { describeError, logger } from '@yme/shared';
import { assertFfmpegAvailable } from '@yme/video';
import { createConnection, closeQueues, getQueue, QUEUE_NAMES } from './queues.js';
import {
  handleAnalytics,
  handleDiscovery,
  handleLearning,
  handlePublish,
  handlePublishDue,
  handleScoring,
  handleStage,
} from './jobs/handlers.js';
import type { AnalyticsJobData, DiscoveryJobData, LearningJobData, PublishJobData, StageJobData } from './jobs/types.js';

/**
 * Worker host.
 *
 * Concurrency is set per queue from what the work actually costs:
 *   production — IO-bound (LLM and HTTP), so several at once;
 *   render     — CPU-bound; ffmpeg already saturates the cores, and running
 *                two 1080p encodes on a 4-core box makes both slower than
 *                running them in sequence;
 *   publish    — one at a time, always. Concurrent uploads to one channel hit
 *                quota unpredictably and make a duplicate upload possible.
 */
const CONCURRENCY = {
  production: Number(process.env.WORKER_PRODUCTION_CONCURRENCY ?? 4),
  render: Number(process.env.WORKER_RENDER_CONCURRENCY ?? 1),
  publish: 1,
  discovery: 2,
  analytics: 2,
} as const;

async function main() {
  const config = loadEnv();
  logger.info(
    {
      mockMode: config.MOCK_MODE,
      llm: config.MOCK_MODE ? 'mock' : config.LLM_PROVIDER,
      youtube: config.MOCK_MODE ? 'mock' : config.YOUTUBE_PROVIDER,
      automaticPublish: config.AUTOMATIC_PUBLISH,
    },
    'worker starting',
  );

  // Fail fast on a broken render toolchain rather than at 2am inside a job.
  const ffmpeg = await assertFfmpegAvailable();
  logger.info({ ffmpeg: ffmpeg.ffmpeg, libass: ffmpeg.hasLibass }, 'ffmpeg available');
  if (!ffmpeg.hasLibass) {
    logger.warn('ffmpeg has no libass; burned-in captions for Shorts will fail');
  }

  await prisma.$queryRaw`SELECT 1`;
  logger.info('database reachable');

  const workers: Worker[] = [
    new Worker(
      QUEUE_NAMES.production,
      async (job: Job) => wrap(job, () => handleStage(job.data as StageJobData, job.id)),
      { connection: createConnection(), concurrency: CONCURRENCY.production },
    ),
    new Worker(
      QUEUE_NAMES.render,
      async (job: Job) => wrap(job, () => handleStage(job.data as StageJobData, job.id)),
      { connection: createConnection(), concurrency: CONCURRENCY.render, lockDuration: 45 * 60_000 },
    ),
    new Worker(
      QUEUE_NAMES.publish,
      async (job: Job) => wrap(job, () => handlePublish(job.data as PublishJobData, job.id)),
      { connection: createConnection(), concurrency: CONCURRENCY.publish, lockDuration: 30 * 60_000 },
    ),
    new Worker(
      QUEUE_NAMES.discovery,
      async (job: Job) => {
        if (job.name === 'score') return wrap(job, () => handleScoring(job.data as DiscoveryJobData, job.id));
        return wrap(job, () => handleDiscovery(job.data as DiscoveryJobData, job.id));
      },
      { connection: createConnection(), concurrency: CONCURRENCY.discovery },
    ),
    new Worker(
      QUEUE_NAMES.analytics,
      async (job: Job) => {
        if (job.name === 'learning-report') return wrap(job, () => handleLearning(job.data as LearningJobData, job.id));
        if (job.name === 'publish-due') return wrap(job, () => handlePublishDue());
        return wrap(job, () => handleAnalytics(job.data as AnalyticsJobData, job.id));
      },
      { connection: createConnection(), concurrency: CONCURRENCY.analytics },
    ),
  ];

  for (const w of workers) {
    w.on('failed', (job, err) => {
      logger.error({ queue: w.name, jobId: job?.id, attempt: job?.attemptsMade, err: err.message }, 'job failed');
      void logSystem({
        level: 'ERROR',
        source: `worker:${w.name}`,
        message: err.message,
        jobId: job?.id,
        videoProjectId: (job?.data as { videoProjectId?: string } | undefined)?.videoProjectId,
        stage: (job?.data as { stage?: string } | undefined)?.stage,
        metadata: { attempt: job?.attemptsMade },
      });
    });
    w.on('error', (err) => logger.error({ queue: w.name, err: err.message }, 'worker error'));
  }

  await scheduleRepeatables();

  logger.info({ queues: Object.values(QUEUE_NAMES), concurrency: CONCURRENCY }, 'worker ready');

  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'shutting down');
    // Close workers first so in-flight jobs finish rather than being orphaned
    // and re-run from the start by the stalled-job checker.
    await Promise.all(workers.map((w) => w.close()));
    await closeQueues();
    await disconnect();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

async function wrap<T>(job: Job, fn: () => Promise<T>): Promise<T> {
  const started = Date.now();
  logger.info({ queue: job.queueName, name: job.name, jobId: job.id, attempt: job.attemptsMade + 1 }, 'job started');
  try {
    const result = await fn();
    logger.info({ jobId: job.id, ms: Date.now() - started }, 'job complete');
    return result;
  } catch (err) {
    logger.warn({ jobId: job.id, ms: Date.now() - started, err: describeError(err) }, 'job threw');
    throw err;
  }
}

/**
 * Scheduled work (spec §41).
 *
 * Repeatable jobs are keyed so re-registering on every restart replaces rather
 * than duplicates them — without the key, a worker restarted ten times ends up
 * running discovery ten times per interval.
 */
async function scheduleRepeatables(): Promise<void> {
  const channel = await prisma.channel.findFirst({ select: { id: true } });
  if (!channel) {
    logger.warn('no channel configured; scheduled jobs not registered. Run the seed or first-run wizard.');
    return;
  }

  const discovery = getQueue(QUEUE_NAMES.discovery);
  const analytics = getQueue(QUEUE_NAMES.analytics);

  await discovery.add(
    'discover',
    { channelId: channel.id, limit: 6 } satisfies DiscoveryJobData,
    { repeat: { pattern: '0 */6 * * *' }, jobId: 'repeat:discover' },
  );
  await discovery.add(
    'score',
    { channelId: channel.id } satisfies DiscoveryJobData,
    { repeat: { pattern: '30 6 * * *' }, jobId: 'repeat:score' },
  );
  await analytics.add(
    'ingest-analytics',
    { channelId: channel.id } satisfies AnalyticsJobData,
    // 04:00 UTC: YouTube Analytics lags roughly a day, so an earlier run just
    // fetches the same numbers again.
    { repeat: { pattern: '0 4 * * *' }, jobId: 'repeat:analytics' },
  );
  await analytics.add(
    'learning-report',
    { channelId: channel.id, periodDays: 7 } satisfies LearningJobData,
    { repeat: { pattern: '0 7 * * 1' }, jobId: 'repeat:learning' },
  );
  await analytics.add(
    'publish-due',
    {},
    { repeat: { pattern: '*/5 * * * *' }, jobId: 'repeat:publish-due' },
  );

  logger.info('repeatable jobs registered');
}

main().catch(async (err) => {
  logger.fatal({ err: describeError(err) }, 'worker failed to start');
  await disconnect().catch(() => undefined);
  process.exit(1);
});

export { env };
