import { EngineError, isRetryable } from './errors.js';
import { sleep } from './time.js';

export interface RetryOptions {
  attempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  /** Overrides the default retryable classification. */
  shouldRetry?: (err: unknown, attempt: number) => boolean;
  onRetry?: (err: unknown, attempt: number, delayMs: number) => void;
  signal?: AbortSignal;
}

/**
 * Exponential backoff with full jitter. Jitter matters: without it, five
 * workers that hit the same 429 all retry in lockstep and hit it again.
 */
export async function withRetry<T>(fn: (attempt: number) => Promise<T>, opts: RetryOptions = {}): Promise<T> {
  const attempts = opts.attempts ?? 4;
  const base = opts.baseDelayMs ?? 500;
  const max = opts.maxDelayMs ?? 30_000;
  let lastErr: unknown;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    if (opts.signal?.aborted) throw new EngineError('TIMEOUT', 'Aborted before attempt');
    try {
      return await fn(attempt);
    } catch (err) {
      lastErr = err;
      const retry = opts.shouldRetry ? opts.shouldRetry(err, attempt) : isRetryable(err);
      if (!retry || attempt === attempts) throw err;
      const ceiling = Math.min(max, base * 2 ** (attempt - 1));
      const delay = Math.round(Math.random() * ceiling);
      opts.onRetry?.(err, attempt, delay);
      await sleep(delay);
    }
  }
  throw lastErr;
}

export async function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      p,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new EngineError('TIMEOUT', `${label} timed out after ${ms}ms`)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
