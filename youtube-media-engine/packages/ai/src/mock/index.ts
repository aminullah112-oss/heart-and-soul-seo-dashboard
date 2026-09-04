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
    // Seeded from the project identity, NOT from the task name: every stage
    // of one video must resolve to the same mock company, or the claims and
    // the script describe different businesses and every cross-stage
    // reference silently fails to match.
    const ctx = (req.mockContext ?? {}) as Record<string, unknown>;
    const identity =
      (typeof ctx.subjectKey === 'string' && ctx.subjectKey) ||
      (typeof ctx.title === 'string' && ctx.title) ||
      JSON.stringify(ctx);
    const seed = stableId(identity);
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
