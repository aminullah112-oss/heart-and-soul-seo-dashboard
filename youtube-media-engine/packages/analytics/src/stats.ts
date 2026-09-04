/**
 * The statistics behind "did this actually work?" (spec §31).
 *
 * This module exists because the default behaviour of every analytics feature
 * is to declare a winner. Two thumbnails, 4.1% versus 3.8% CTR, and something
 * announces a 7.9% improvement. With 900 impressions each that difference is
 * indistinguishable from a coin flip, and acting on it trains the channel on
 * noise.
 *
 * So the API is built to return "not enough data" as a first-class result.
 */

export interface ProportionSample {
  successes: number;
  trials: number;
}

export interface ComparisonResult {
  conclusive: boolean;
  winner: 'A' | 'B' | null;
  /** Relative difference, e.g. 0.079 for a 7.9% lift. Null when inconclusive. */
  relativeLift: number | null;
  pValue: number;
  /** 95% CI on the absolute difference in rates (B - A). */
  confidenceInterval: [number, number];
  reason: string;
  requiredTrialsPerArm: number | null;
}

/**
 * Minimum impressions per arm before a comparison is even attempted.
 *
 * Derived from the usual power calculation: detecting a 10% relative change on
 * a ~4% base rate at 80% power and alpha 0.05 needs roughly 25k impressions
 * per arm. Most channels never reach that on a single video, which is the
 * honest answer: per-video thumbnail A/B testing is underpowered for anything
 * but large effects, and only obvious wins are detectable.
 */
export const MIN_TRIALS_PER_ARM = 1000;
export const ALPHA = 0.05;

/** Two-proportion z-test with a pooled standard error. */
export function compareProportions(a: ProportionSample, b: ProportionSample): ComparisonResult {
  const insufficient = a.trials < MIN_TRIALS_PER_ARM || b.trials < MIN_TRIALS_PER_ARM;
  const pA = a.trials > 0 ? a.successes / a.trials : 0;
  const pB = b.trials > 0 ? b.successes / b.trials : 0;

  if (insufficient) {
    return {
      conclusive: false,
      winner: null,
      relativeLift: null,
      pValue: 1,
      confidenceInterval: [0, 0],
      reason:
        `Not enough data: ${a.trials} and ${b.trials} trials, minimum ${MIN_TRIALS_PER_ARM} per arm. ` +
        'Any apparent difference at this sample size is inside normal variance.',
      requiredTrialsPerArm: requiredSampleSize(Math.max(pA, pB, 0.01), 0.1),
    };
  }

  const pooled = (a.successes + b.successes) / (a.trials + b.trials);
  const se = Math.sqrt(pooled * (1 - pooled) * (1 / a.trials + 1 / b.trials));

  if (se === 0) {
    return {
      conclusive: false,
      winner: null,
      relativeLift: null,
      pValue: 1,
      confidenceInterval: [0, 0],
      reason: 'Both arms produced identical rates; nothing to distinguish.',
      requiredTrialsPerArm: null,
    };
  }

  const z = (pB - pA) / se;
  const pValue = 2 * (1 - normalCdf(Math.abs(z)));

  // The CI uses unpooled SE — pooled is right for the test statistic under the
  // null, unpooled is right for estimating the actual difference.
  const seUnpooled = Math.sqrt((pA * (1 - pA)) / a.trials + (pB * (1 - pB)) / b.trials);
  const margin = 1.96 * seUnpooled;
  const diff = pB - pA;

  if (pValue >= ALPHA) {
    return {
      conclusive: false,
      winner: null,
      relativeLift: null,
      pValue,
      confidenceInterval: [diff - margin, diff + margin],
      reason:
        `Difference is not statistically significant (p=${pValue.toFixed(3)}). The 95% interval ` +
        `[${(diff - margin).toFixed(4)}, ${(diff + margin).toFixed(4)}] includes zero.`,
      requiredTrialsPerArm: requiredSampleSize(Math.max(pA, 0.01), 0.1),
    };
  }

  return {
    conclusive: true,
    winner: pB > pA ? 'B' : 'A',
    relativeLift: pA > 0 ? (pB - pA) / pA : null,
    pValue,
    confidenceInterval: [diff - margin, diff + margin],
    reason: `Significant at p=${pValue.toFixed(4)} with ${a.trials} and ${b.trials} trials.`,
    requiredTrialsPerArm: null,
  };
}

/** Trials per arm to detect `relativeEffect` on `baseRate` at 80% power, alpha 0.05. */
export function requiredSampleSize(baseRate: number, relativeEffect: number): number {
  const p1 = Math.min(0.99, Math.max(0.001, baseRate));
  const p2 = Math.min(0.99, p1 * (1 + relativeEffect));
  const pBar = (p1 + p2) / 2;
  const zAlpha = 1.96;
  const zBeta = 0.84;
  const numerator = (zAlpha * Math.sqrt(2 * pBar * (1 - pBar)) + zBeta * Math.sqrt(p1 * (1 - p1) + p2 * (1 - p2))) ** 2;
  return Math.ceil(numerator / (p2 - p1) ** 2);
}

/** Abramowitz & Stegun 26.2.17 — accurate to ~7.5e-8, plenty here. */
function normalCdf(x: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989422804014327 * Math.exp((-x * x) / 2);
  const p = d * t * (0.319381530 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return x > 0 ? 1 - p : p;
}

// ── Retention curve analysis ───────────────────────────────────────────────

export interface RetentionPoint {
  ratio: number;
  audienceWatchRatio: number;
}

export interface DropOff {
  ratio: number;
  /** Fraction of the remaining audience lost in this interval. */
  severity: number;
  approximateSeconds: number;
}

/**
 * Finds where viewers actually leave.
 *
 * Absolute drops are misleading: losing 8 points from 90% is routine, losing
 * 8 points from 30% is a quarter of what is left. Severity is therefore the
 * RELATIVE loss, which is what makes a mid-video cliff visible at all.
 */
export function findDropOffs(curve: RetentionPoint[], durationSeconds: number, threshold = 0.06): DropOff[] {
  const sorted = [...curve].sort((a, b) => a.ratio - b.ratio);
  const out: DropOff[] = [];

  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1]!;
    const cur = sorted[i]!;
    if (prev.audienceWatchRatio <= 0) continue;
    const relativeLoss = (prev.audienceWatchRatio - cur.audienceWatchRatio) / prev.audienceWatchRatio;
    if (relativeLoss >= threshold) {
      out.push({
        ratio: cur.ratio,
        severity: Math.round(relativeLoss * 1000) / 1000,
        approximateSeconds: Math.round(cur.ratio * durationSeconds),
      });
    }
  }

  return out.sort((a, b) => b.severity - a.severity);
}

/** Retention at the 30-second mark — the number that predicts the rest. */
export function retentionAt(curve: RetentionPoint[], seconds: number, durationSeconds: number): number | null {
  if (durationSeconds <= 0 || curve.length === 0) return null;
  const target = seconds / durationSeconds;
  const sorted = [...curve].sort((a, b) => a.ratio - b.ratio);

  if (target <= sorted[0]!.ratio) return sorted[0]!.audienceWatchRatio;
  const last = sorted.at(-1)!;
  if (target >= last.ratio) return last.audienceWatchRatio;

  for (let i = 1; i < sorted.length; i++) {
    const a = sorted[i - 1]!;
    const b = sorted[i]!;
    if (target <= b.ratio) {
      const span = b.ratio - a.ratio;
      const t = span === 0 ? 0 : (target - a.ratio) / span;
      return a.audienceWatchRatio + t * (b.audienceWatchRatio - a.audienceWatchRatio);
    }
  }
  return last.audienceWatchRatio;
}

/** Median, used instead of mean throughout: view counts are heavily skewed. */
export function median(values: number[]): number | null {
  const nums = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (nums.length === 0) return null;
  const mid = Math.floor(nums.length / 2);
  return nums.length % 2 === 0 ? (nums[mid - 1]! + nums[mid]!) / 2 : nums[mid]!;
}
