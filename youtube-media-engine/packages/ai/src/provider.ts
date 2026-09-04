import { env } from '@yme/config';
import type { LlmProvider, ModelTier } from './types.js';
import { AnthropicProvider } from './anthropic.js';
import { MockLlmProvider } from './mock/index.js';

let cached: LlmProvider | null = null;

export function getLlmProvider(): LlmProvider {
  if (cached) return cached;
  // MOCK_MODE wins over LLM_PROVIDER on purpose: one switch has to be enough
  // to guarantee no spend, regardless of what the other variables say.
  cached = env.MOCK_MODE || env.LLM_PROVIDER === 'mock' ? new MockLlmProvider() : new AnthropicProvider();
  return cached;
}

/** Test seam — resets the memoised provider. */
export function resetLlmProvider(): void {
  cached = null;
}

export function modelForTier(tier: ModelTier): string {
  switch (tier) {
    case 'reasoning':
      return env.LLM_MODEL_REASONING;
    case 'drafting':
      return env.LLM_MODEL_DRAFTING;
    case 'cheap':
      return env.LLM_MODEL_CHEAP;
  }
}
