import { DEFAULT_SCORING_WEIGHTS, type ScoringWeightKey } from '@yme/config';

/**
 * Topic opportunity scoring (spec §7).
 *
 * Honest framing: these are RUBRIC scores, not predictions. An LLM rating
 * "viral potential: 92" has no predictive validity until it is calibrated
 * against this channel's own published results. The learning loop
 * (packages/analytics) exists to replace these priors with observed CTR and
 * retention. Until ~20 videos have shipped, treat the number as a consistent
 * way to rank candidates against each other — not as a forecast.
 */

export const SCORE_DIMENSIONS = [
  'viralPotential',
  'searchDemand',
  'advertiserValue',
  'evergreenValue',
  'storyPotential',
  'timeliness',
  'competition',
  'researchAvailability',
  'visualPotential',
  'affiliatePotential',
  'sponsorshipPotential',
  'channelRelevance',
] as const satisfies readonly ScoringWeightKey[];

export type ScoreDimension = (typeof SCORE_DIMENSIONS)[number];
export type DimensionScores = Record<ScoreDimension, number>;
export type ScoringWeights = Record<ScoreDimension, number>;

/**
 * Dimensions where a HIGH raw value is BAD. `competition: 90` means the topic
 * is saturated, which should pull the overall score down, so it is inverted
 * (100 - v) before weighting. Getting this backwards is the classic scoring
 * bug, so it is explicit and tested.
 */
export const INVERTED_DIMENSIONS: ReadonlySet<ScoreDimension> = new Set(['competition']);

export function clampScore(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.min(100, Math.max(0, v));
}

export function normaliseWeights(weights: Partial<ScoringWeights> = {}): ScoringWeights {
  const merged = { ...DEFAULT_SCORING_WEIGHTS, ...weights } as ScoringWeights;
  let total = 0;
  for (const d of SCORE_DIMENSIONS) {
    const w = merged[d];
    if (!Number.isFinite(w) || w < 0) {
      throw new Error(`Scoring weight for "${d}" must be a non-negative finite number, got ${String(w)}`);
    }
    total += w;
  }
  if (total <= 0) throw new Error('Scoring weights sum to zero; at least one dimension must be weighted');

  const out = {} as ScoringWeights;
  for (const d of SCORE_DIMENSIONS) out[d] = merged[d] / total;
  return out;
}

export interface OverallScoreResult {
  overall: number;
  /** Per-dimension contribution to the overall score, for dashboard explainability. */
  contributions: Record<ScoreDimension, number>;
  effectiveWeights: ScoringWeights;
}

export function computeOverallScore(
  scores: Partial<DimensionScores>,
  weights: Partial<ScoringWeights> = {},
): OverallScoreResult {
  const w = normaliseWeights(weights);
  const contributions = {} as Record<ScoreDimension, number>;
  let overall = 0;

  for (const d of SCORE_DIMENSIONS) {
    const raw = clampScore(scores[d] ?? 0);
    const effective = INVERTED_DIMENSIONS.has(d) ? 100 - raw : raw;
    const contribution = effective * w[d];
    contributions[d] = contribution;
    overall += contribution;
  }

  return { overall: Math.round(overall * 10) / 10, contributions, effectiveWeights: w };
}

/**
 * Research availability is a hard gate, not just a weighted input (spec §3:
 * "If a topic cannot be researched adequately, reject it"). A topic can score
 * 95 on story and still be unpublishable because nothing verifiable exists.
 */
export const RESEARCH_AVAILABILITY_FLOOR = 45;

export interface GateResult {
  passed: boolean;
  reasons: string[];
}

export function evaluateTopicGates(
  scores: Partial<DimensionScores>,
  overall: number,
  minimumOverall: number,
): GateResult {
  const reasons: string[] = [];
  const research = clampScore(scores.researchAvailability ?? 0);

  if (research < RESEARCH_AVAILABILITY_FLOOR) {
    reasons.push(
      `researchAvailability ${research} is below the hard floor of ${RESEARCH_AVAILABILITY_FLOOR} — ` +
        'not enough verifiable source material to make an accurate video',
    );
  }
  if (overall < minimumOverall) {
    reasons.push(`overall score ${overall} is below the configured minimum of ${minimumOverall}`);
  }

  return { passed: reasons.length === 0, reasons };
}

/**
 * Monetization potential (spec §32). Deliberately separate from the topic
 * score: a topic can be great content and poor monetization, and conflating
 * the two pushes the channel toward finance-bait.
 */
export interface MonetizationInputs {
  advertiserValue: number;
  affiliatePotential: number;
  sponsorshipPotential: number;
  evergreenValue: number;
  searchDemand: number;
}

export function computeMonetizationPotential(i: MonetizationInputs): number {
  const v =
    clampScore(i.advertiserValue) * 0.35 +
    clampScore(i.sponsorshipPotential) * 0.2 +
    clampScore(i.affiliatePotential) * 0.15 +
    clampScore(i.evergreenValue) * 0.2 +
    clampScore(i.searchDemand) * 0.1;
  return Math.round(v * 10) / 10;
}

/**
 * QC composite (spec §36). Any FAIL gate makes the video ineligible
 * regardless of the numeric score — a 98/100 script with a failed fact check
 * does not ship.
 */
export interface QcInputs {
  factCheck: 'PASS' | 'FAIL';
  copyright: 'PASS' | 'WARNING' | 'FAIL';
  policy: 'PASS' | 'WARNING' | 'FAIL';
  aiDisclosure: 'PASS' | 'WARNING';
  scriptQuality: number;
  retention: number;
  visualQuality: number;
  monetizationSafety: number;
  originality: number;
}

export interface QcResult {
  finalScore: number;
  passed: boolean;
  blockingReasons: string[];
  warnings: string[];
}

export function computeQcResult(i: QcInputs, minimumScore: number): QcResult {
  const finalScore =
    Math.round(
      (clampScore(i.scriptQuality) * 0.25 +
        clampScore(i.retention) * 0.25 +
        clampScore(i.originality) * 0.2 +
        clampScore(i.visualQuality) * 0.15 +
        clampScore(i.monetizationSafety) * 0.15) *
        10,
    ) / 10;

  const blockingReasons: string[] = [];
  const warnings: string[] = [];

  if (i.factCheck === 'FAIL') blockingReasons.push('Fact check failed — unverified or contradicted claims present');
  if (i.copyright === 'FAIL') blockingReasons.push('Copyright check failed — an asset cannot be cleared for use');
  if (i.policy === 'FAIL') blockingReasons.push('Policy check failed — content would risk a strike or demonetization');
  if (i.copyright === 'WARNING') warnings.push('Copyright check raised a warning — review asset licences');
  if (i.policy === 'WARNING') warnings.push('Policy check raised a warning — review sensitive claims');
  if (i.aiDisclosure === 'WARNING') warnings.push('AI disclosure may be required for this video');
  if (finalScore < minimumScore)
    blockingReasons.push(`QC score ${finalScore} is below the configured minimum of ${minimumScore}`);

  return { finalScore, passed: blockingReasons.length === 0, blockingReasons, warnings };
}
