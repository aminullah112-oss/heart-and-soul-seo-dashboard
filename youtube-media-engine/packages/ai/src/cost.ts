import { pricing } from '@yme/config';
import { budgetError } from '@yme/shared';
import { recordCost } from '@yme/database';
import type { LlmUsage } from './types.js';
import type { PipelineStage } from '@yme/shared';

export function priceLlmCall(model: string, usage: LlmUsage): number {
  const table = pricing.llm as Record<string, { inputPerMTok: number; outputPerMTok: number }>;
  const rate = table[model] ?? table.default!;
  const input = (usage.inputTokens / 1_000_000) * rate.inputPerMTok;
  const output = (usage.outputTokens / 1_000_000) * rate.outputPerMTok;
  return input + output;
}

/**
 * Per-run spend guard (spec §38). Enforced BEFORE each call, not after, so a
 * runaway retry loop cannot spend past the ceiling and then report it.
 */
export class CostTracker {
  private spent = 0;
  private readonly entries: Array<{ task: string; usd: number }> = [];

  constructor(
    private readonly limitUsd: number,
    private readonly ctx: { videoProjectId?: string | null; stage: PipelineStage | 'DISCOVERY' },
  ) {}

  get totalUsd(): number {
    return Math.round(this.spent * 1e6) / 1e6;
  }

  get remainingUsd(): number {
    return Math.max(0, this.limitUsd - this.spent);
  }

  /** Throws a terminal BUDGET error if the projected cost breaches the cap. */
  assertHeadroom(estimatedUsd: number, task: string): void {
    if (this.spent + estimatedUsd > this.limitUsd) {
      throw budgetError(
        `Cost ceiling reached before "${task}": spent $${this.spent.toFixed(4)} of ` +
          `$${this.limitUsd.toFixed(2)}. Raise LLM_MAX_COST_PER_VIDEO_USD or simplify the pipeline.`,
        { task, spent: this.spent, limit: this.limitUsd },
      );
    }
  }

  async charge(opts: {
    task: string;
    provider: string;
    model: string;
    usage: LlmUsage;
  }): Promise<number> {
    const usd = priceLlmCall(opts.model, opts.usage);
    this.spent += usd;
    this.entries.push({ task: opts.task, usd });

    await recordCost({
      videoProjectId: this.ctx.videoProjectId ?? null,
      category: 'LLM',
      provider: opts.provider,
      stage: this.ctx.stage,
      usd,
      units: opts.usage.inputTokens + opts.usage.outputTokens,
      unitLabel: 'tokens',
      model: opts.model,
      detail: {
        inputTokens: opts.usage.inputTokens,
        outputTokens: opts.usage.outputTokens,
        task: opts.task,
      },
    });

    return usd;
  }

  breakdown(): Array<{ task: string; usd: number }> {
    const byTask = new Map<string, number>();
    for (const e of this.entries) byTask.set(e.task, (byTask.get(e.task) ?? 0) + e.usd);
    return [...byTask.entries()]
      .map(([task, usd]) => ({ task, usd: Math.round(usd * 1e6) / 1e6 }))
      .sort((a, b) => b.usd - a.usd);
  }
}
