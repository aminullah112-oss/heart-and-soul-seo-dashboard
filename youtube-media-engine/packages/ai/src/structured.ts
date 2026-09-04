import type { z } from 'zod';
import { env } from '@yme/config';
import { EngineError, jobLogger, withRetry, withTimeout, type PipelineStage } from '@yme/shared';
import { getLlmProvider, modelForTier } from './provider.js';
import { extractJson } from './json.js';
import { CostTracker, priceLlmCall } from './cost.js';
import { TASK_TIER, type LlmMessage, type LlmTask, type ModelTier } from './types.js';

export interface StructuredRequest<T> {
  task: LlmTask;
  schema: z.ZodType<T>;
  system: string;
  prompt: string;
  /** Overrides the task's default model tier. */
  tier?: ModelTier;
  maxTokens?: number;
  temperature?: number;
  /** Extra turns, e.g. a prior draft being revised. */
  history?: LlmMessage[];
  /** Ignored by real providers; keeps MOCK_MODE output coherent. */
  mockContext?: Record<string, unknown>;
  tracker?: CostTracker;
  ctx?: { videoProjectId?: string | null; stage?: PipelineStage | 'DISCOVERY'; jobId?: string };
  /** Attempts at the transport level (429s, 5xx). */
  transportAttempts?: number;
  /** Attempts at the schema level, where the error is fed back to the model. */
  repairAttempts?: number;
  timeoutMs?: number;
}

export interface StructuredResult<T> {
  value: T;
  model: string;
  usd: number;
  inputTokens: number;
  outputTokens: number;
  repairs: number;
}

/**
 * The single entry point for every LLM call in the system.
 *
 * Two distinct retry loops, because they fail for different reasons:
 *   transport — 429/5xx/timeouts, retried blind with backoff;
 *   repair    — the reply parsed but did not satisfy the schema, retried with
 *               the validation error handed back to the model.
 * Collapsing them into one loop means a schema bug burns rate limit, and a
 * rate limit burns repair attempts.
 */
export async function generateStructured<T>(req: StructuredRequest<T>): Promise<StructuredResult<T>> {
  const provider = getLlmProvider();
  const tier = req.tier ?? TASK_TIER[req.task];
  const model = modelForTier(tier);
  const maxTokens = req.maxTokens ?? 4096;
  const temperature = req.temperature ?? 0.7;
  const repairBudget = req.repairAttempts ?? 2;
  const timeoutMs = req.timeoutMs ?? 180_000;

  const log = jobLogger({
    jobId: req.ctx?.jobId,
    videoId: req.ctx?.videoProjectId ?? undefined,
    stage: req.ctx?.stage,
  });

  const messages: LlmMessage[] = [...(req.history ?? []), { role: 'user', content: req.prompt }];

  let repairs = 0;
  let totalUsd = 0;
  let totalIn = 0;
  let totalOut = 0;
  let lastModel = model;

  for (;;) {
    // Budget is checked before spending, using a conservative estimate of the
    // call about to be made.
    if (req.tracker) {
      const estimate = priceLlmCall(model, {
        inputTokens: Math.ceil((req.system.length + messages.reduce((a, m) => a + m.content.length, 0)) / 4),
        outputTokens: maxTokens,
      });
      req.tracker.assertHeadroom(estimate, req.task);
    }

    const res = await withRetry(
      (attempt) =>
        withTimeout(
          provider.complete({
            task: req.task,
            system: req.system,
            messages,
            model,
            maxTokens,
            temperature,
            mockContext: req.mockContext,
          }),
          timeoutMs,
          `llm:${req.task} (attempt ${attempt})`,
        ),
      {
        attempts: req.transportAttempts ?? 4,
        baseDelayMs: 1000,
        maxDelayMs: 30_000,
        onRetry: (err, attempt, delay) =>
          log.warn({ task: req.task, attempt, delay, err: String(err) }, 'llm transport retry'),
      },
    );

    lastModel = res.model;
    totalIn += res.usage.inputTokens;
    totalOut += res.usage.outputTokens;
    totalUsd += req.tracker
      ? await req.tracker.charge({ task: req.task, provider: provider.name, model, usage: res.usage })
      : priceLlmCall(model, res.usage);

    if (res.stopReason === 'max_tokens') {
      // A truncated document will fail JSON parsing anyway; failing here gives
      // a message the operator can act on.
      throw new EngineError(
        'PROVIDER',
        `Task "${req.task}" hit the ${maxTokens}-token output limit and was truncated. ` +
          'Raise maxTokens for this task or split the work.',
        { retryable: false },
      );
    }

    let parsed: unknown;
    let failure: string | null = null;
    try {
      parsed = extractJson(res.text);
      const result = req.schema.safeParse(parsed);
      if (result.success) {
        log.debug({ task: req.task, model: lastModel, usd: totalUsd, repairs }, 'llm call complete');
        return {
          value: result.data,
          model: lastModel,
          usd: totalUsd,
          inputTokens: totalIn,
          outputTokens: totalOut,
          repairs,
        };
      }
      failure = result.error.issues
        .slice(0, 12)
        .map((i) => `- ${i.path.join('.') || '(root)'}: ${i.message}`)
        .join('\n');
    } catch (err) {
      failure = err instanceof Error ? err.message : String(err);
    }

    if (repairs >= repairBudget) {
      throw new EngineError(
        'VALIDATION',
        `Task "${req.task}" returned output that does not satisfy its schema after ` +
          `${repairs} repair attempt(s):\n${failure}`,
        { retryable: false, details: { task: req.task, preview: res.text.slice(0, 600) } },
      );
    }

    repairs++;
    log.warn({ task: req.task, repairs, failure }, 'llm schema repair');
    messages.push({ role: 'assistant', content: res.text.slice(0, 4000) });
    messages.push({
      role: 'user',
      content:
        'That reply did not satisfy the required schema. Fix these problems and return the corrected ' +
        `JSON document only, with no commentary and no code fences:\n${failure}`,
    });
  }
}

export function newCostTracker(ctx: {
  videoProjectId?: string | null;
  stage: PipelineStage | 'DISCOVERY';
  limitUsd?: number;
}): CostTracker {
  return new CostTracker(ctx.limitUsd ?? env.LLM_MAX_COST_PER_VIDEO_USD, {
    videoProjectId: ctx.videoProjectId,
    stage: ctx.stage,
  });
}
