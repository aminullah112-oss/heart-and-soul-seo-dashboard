import { stableId } from '@yme/shared';
import type { LlmProvider, LlmRequest, LlmResponse } from '../types.js';
import { buildMockPayload } from './responders.js';

/**
 * Deterministic offline LLM. Same request in, same bytes out — so a failing
 * integration test fails the same way twice, and a render can be compared
 * across runs.
 *
 * Token counts are estimated at ~4 chars/token purely so the cost ledger has
 * realistic-shaped numbers to aggregate; MOCK pricing is zero, so no spend is
 * ever implied.
 */
export class MockLlmProvider implements LlmProvider {
  readonly name = 'mock';

  async complete(req: LlmRequest): Promise<LlmResponse> {
    const seed = stableId(req.task, JSON.stringify(req.mockContext ?? {}));
    const payload = buildMockPayload(req, seed);
    const text = JSON.stringify(payload, null, 2);

    const promptChars = req.system.length + req.messages.reduce((a, m) => a + m.content.length, 0);
    return {
      text: req.prefill ? req.prefill + text.replace(/^\s*\{/, '') : text,
      model: `mock:${req.model}`,
      usage: {
        inputTokens: Math.ceil(promptChars / 4),
        outputTokens: Math.ceil(text.length / 4),
      },
      stopReason: 'end_turn',
    };
  }
}
