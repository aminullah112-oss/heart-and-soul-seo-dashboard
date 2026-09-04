/**
 * Unit costs used by the cost ledger (spec §38).
 *
 * These are OPERATOR-CONFIGURABLE ESTIMATES, not live prices. Providers change
 * pricing without notice, so treat every number here as "what the operator
 * believes it costs" and update it from the provider's own pricing page. The
 * ledger records the rate that was in effect at the time of the call, so a
 * later edit never rewrites historical cost records.
 */

export interface ModelPricing {
  /** USD per 1M input tokens. */
  inputPerMTok: number;
  /** USD per 1M output tokens. */
  outputPerMTok: number;
}

export const pricing = {
  llm: {
    // Update these from https://claude.com/pricing before trusting cost reports.
    'claude-opus-5': { inputPerMTok: 5, outputPerMTok: 25 },
    'claude-sonnet-5': { inputPerMTok: 3, outputPerMTok: 15 },
    'claude-haiku-4-5-20251001': { inputPerMTok: 1, outputPerMTok: 5 },
    default: { inputPerMTok: 3, outputPerMTok: 15 },
  } satisfies Record<string, ModelPricing>,

  /** USD per 1000 characters of synthesised speech. */
  tts: {
    elevenlabs: 0.18,
    openai: 0.015,
    mock: 0,
    default: 0.1,
  } as Record<string, number>,

  /** USD per generated image. */
  image: {
    openai: 0.04,
    mock: 0,
    default: 0.04,
  } as Record<string, number>,

  /** USD per web search request. */
  search: {
    brave: 0.005,
    tavily: 0.008,
    mock: 0,
    default: 0.005,
  } as Record<string, number>,

  /** USD per stock asset download (most are free-tier; kept for accounting). */
  stock: {
    pexels: 0,
    mock: 0,
    default: 0,
  } as Record<string, number>,

  /** USD per minute of rendered output — your own compute, estimated. */
  renderPerOutputMinute: 0.02,
} as const;
