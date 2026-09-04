import { Queue, QueueEvents, type JobsOptions } from 'bullmq';
import IORedis from 'ioredis';
import { env } from '@yme/config';

/**
 * Queue topology.
 *
 * One queue per concern rather than one queue with a job-type field, because
 * they need genuinely different concurrency: render is CPU-bound and must not
 * run more than a couple at a time on one box, while research is IO-bound and
 * can run many. A single queue would force the slowest setting on everything.
 */
export const QUEUE_NAMES = {
  production: 'yme:production',
  render: 'yme:render',
  publish: 'yme:publish',
  discovery: 'yme:discovery',
  analytics: 'yme:analytics',
} as const;

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];

/**
 * BullMQ requires maxRetriesPerRequest:null on the connection it blocks on.
 * Without it, ioredis aborts blocking commands after 20 retries and workers
 * silently stop consuming.
 */
export function createConnection(): IORedis {
  return new IORedis(env.REDIS_URL, { maxRetriesPerRequest: null, enableReadyCheck: false });
}

let shared: IORedis | null = null;
export function sharedConnection(): IORedis {
  if (!shared) shared = createConnection();
  return shared;
}

export const DEFAULT_JOB_OPTIONS: JobsOptions = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 5_000 },
  // Completed jobs are kept briefly for the dashboard; the durable record is
  // the AutomationJob row in Postgres, so Redis does not need to be an archive.
  removeOnComplete: { age: 3600, count: 500 },
  removeOnFail: { age: 7 * 24 * 3600, count: 1000 },
};

/** Renders are long and expensive; a failed one gets fewer, slower retries. */
export const RENDER_JOB_OPTIONS: JobsOptions = {
  ...DEFAULT_JOB_OPTIONS,
  attempts: 2,
  backoff: { type: 'exponential', delay: 30_000 },
};

/**
 * Publishing never retries automatically. A partially completed upload can
 * leave a duplicate video on the channel, and "it uploaded twice" is a worse
 * failure than "it needs a human to press the button again".
 */
export const PUBLISH_JOB_OPTIONS: JobsOptions = {
  attempts: 1,
  removeOnComplete: { age: 7 * 24 * 3600 },
  removeOnFail: { age: 30 * 24 * 3600 },
};

const queues = new Map<string, Queue>();

export function getQueue(name: QueueName): Queue {
  const existing = queues.get(name);
  if (existing) return existing;
  const q = new Queue(name, { connection: sharedConnection(), defaultJobOptions: DEFAULT_JOB_OPTIONS });
  queues.set(name, q);
  return q;
}

export async function closeQueues(): Promise<void> {
  await Promise.all([...queues.values()].map((q) => q.close()));
  queues.clear();
  if (shared) {
    await shared.quit();
    shared = null;
  }
}

export function queueEvents(name: QueueName): QueueEvents {
  return new QueueEvents(name, { connection: createConnection() });
}
