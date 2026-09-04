import Anthropic from '@anthropic-ai/sdk';
import { env } from '@yme/config';
import { EngineError, providerError } from '@yme/shared';
import type { LlmProvider, LlmRequest, LlmResponse } from './types.js';

/**
 * Anthropic-backed provider. Error mapping matters here: a 429 is retryable
 * and a 401 is not, and BullMQ needs that distinction to avoid burning four
 * attempts on a bad key.
 */
export class AnthropicProvider implements LlmProvider {
  readonly name = 'anthropic';
  private client: Anthropic;

  constructor(apiKey?: string) {
    const key = apiKey ?? env.ANTHROPIC_API_KEY;
    if (!key) throw new EngineError('CONFIG', 'ANTHROPIC_API_KEY is not set');
    this.client = new Anthropic({ apiKey: key, maxRetries: 0 });
  }

  async complete(req: LlmRequest): Promise<LlmResponse> {
    const messages: Anthropic.MessageParam[] = req.messages.map((m) => ({
      role: m.role,
      content: m.content,
    }));
    if (req.prefill) messages.push({ role: 'assistant', content: req.prefill });

    try {
      const res = await this.client.messages.create({
        model: req.model,
        max_tokens: req.maxTokens,
        temperature: req.temperature,
        system: req.system,
        messages,
        ...(req.stopSequences?.length ? { stop_sequences: req.stopSequences } : {}),
      });

      const text = res.content
        .filter((b): b is Anthropic.TextBlock => b.type === 'text')
        .map((b) => b.text)
        .join('');

      return {
        // The prefill is not echoed back by the API, so it is re-attached here
        // to keep the caller's parser working on a complete document.
        text: (req.prefill ?? '') + text,
        model: res.model,
        usage: {
          inputTokens: res.usage.input_tokens,
          outputTokens: res.usage.output_tokens,
          cacheReadTokens: res.usage.cache_read_input_tokens ?? undefined,
        },
        stopReason: res.stop_reason,
      };
    } catch (err) {
      throw mapAnthropicError(err);
    }
  }
}

function mapAnthropicError(err: unknown): EngineError {
  if (err instanceof Anthropic.APIError) {
    const status = err.status ?? 0;
    if (status === 401 || status === 403)
      return new EngineError('CONFIG', `Anthropic rejected the API key (${status})`, {
        retryable: false,
        cause: err,
      });
    if (status === 400)
      return new EngineError('VALIDATION', `Anthropic rejected the request: ${err.message}`, {
        retryable: false,
        cause: err,
      });
    if (status === 429)
      return new EngineError('RATE_LIMIT', 'Anthropic rate limit hit', { retryable: true, cause: err });
    if (status >= 500)
      return new EngineError('PROVIDER', `Anthropic server error (${status})`, { retryable: true, cause: err });
    return providerError(`Anthropic error (${status}): ${err.message}`, { cause: err });
  }
  if (err instanceof Error && /timeout|ETIMEDOUT|ECONNRESET|socket hang up/i.test(err.message))
    return new EngineError('TIMEOUT', `Anthropic request failed: ${err.message}`, { retryable: true, cause: err });
  return providerError(err instanceof Error ? err.message : String(err), { cause: err });
}
