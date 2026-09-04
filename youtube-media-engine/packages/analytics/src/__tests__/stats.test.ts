import { describe, it, expect } from 'vitest';
import {
  compareProportions,
  requiredSampleSize,
  findDropOffs,
  retentionAt,
  median,
  MIN_TRIALS_PER_ARM,
} from '../stats.js';

describe('A/B comparison', () => {
  it('refuses to call a winner on a small sample', () => {
    // 4.1% vs 3.8% on ~900 impressions is the exact case that gets reported as
    // a "7.9% improvement" by tools that skip the significance test.
    const result = compareProportions({ successes: 37, trials: 900 }, { successes: 34, trials: 900 });
    expect(result.conclusive).toBe(false);
    expect(result.winner).toBeNull();
    expect(result.reason).toMatch(/Not enough data/);
    expect(result.requiredTrialsPerArm).toBeGreaterThan(MIN_TRIALS_PER_ARM);
  });

  it('refuses to call a winner on a large but insignificant difference', () => {
    const result = compareProportions({ successes: 400, trials: 10_000 }, { successes: 415, trials: 10_000 });
    expect(result.conclusive).toBe(false);
    expect(result.pValue).toBeGreaterThan(0.05);
    // The interval must include zero when the result is inconclusive.
    expect(result.confidenceInterval[0]).toBeLessThan(0);
    expect(result.confidenceInterval[1]).toBeGreaterThan(0);
  });

  it('detects a genuinely large effect at adequate sample size', () => {
    const result = compareProportions({ successes: 300, trials: 10_000 }, { successes: 500, trials: 10_000 });
    expect(result.conclusive).toBe(true);
    expect(result.winner).toBe('B');
    expect(result.pValue).toBeLessThan(0.05);
    expect(result.relativeLift).toBeCloseTo(0.667, 2);
  });

  it('reports A as the winner when A is better', () => {
    const result = compareProportions({ successes: 500, trials: 10_000 }, { successes: 300, trials: 10_000 });
    expect(result.winner).toBe('A');
  });

  it('handles identical arms without dividing by zero', () => {
    const result = compareProportions({ successes: 400, trials: 10_000 }, { successes: 400, trials: 10_000 });
    expect(result.conclusive).toBe(false);
    expect(Number.isFinite(result.pValue)).toBe(true);
  });

  it('handles zero-trial arms', () => {
    const result = compareProportions({ successes: 0, trials: 0 }, { successes: 0, trials: 0 });
    expect(result.conclusive).toBe(false);
  });
});

describe('required sample size', () => {
  it('needs more data to detect a smaller effect', () => {
    expect(requiredSampleSize(0.04, 0.05)).toBeGreaterThan(requiredSampleSize(0.04, 0.2));
  });

  it('produces a realistic figure for a typical YouTube CTR', () => {
    // ~25k impressions per arm to detect a 10% relative change on a 4% base
    // rate. Worth knowing before promising per-video thumbnail testing.
    const n = requiredSampleSize(0.04, 0.1);
    expect(n).toBeGreaterThan(10_000);
    expect(n).toBeLessThan(60_000);
  });
});

describe('retention analysis', () => {
  const curve = [
    { ratio: 0, audienceWatchRatio: 1 },
    { ratio: 0.1, audienceWatchRatio: 0.72 },
    { ratio: 0.2, audienceWatchRatio: 0.68 },
    { ratio: 0.3, audienceWatchRatio: 0.4 }, // cliff
    { ratio: 0.5, audienceWatchRatio: 0.38 },
    { ratio: 1, audienceWatchRatio: 0.3 },
  ];

  it('ranks by relative loss, not absolute drop', () => {
    // 0.68 -> 0.40 loses 0.28 absolute and 41% relative; 1.0 -> 0.72 loses 0.28
    // absolute and only 28% relative. The mid-video cliff must rank first.
    const drops = findDropOffs(curve, 600);
    expect(drops[0]?.ratio).toBe(0.3);
  });

  it('converts positions to approximate seconds', () => {
    const drops = findDropOffs(curve, 600);
    expect(drops[0]?.approximateSeconds).toBe(180);
  });

  it('interpolates retention at an arbitrary timestamp', () => {
    const at30s = retentionAt(curve, 30, 600); // ratio 0.05, between 0 and 0.1
    expect(at30s).toBeGreaterThan(0.72);
    expect(at30s).toBeLessThan(1);
  });

  it('returns null rather than a fake number when there is no data', () => {
    expect(retentionAt([], 30, 600)).toBeNull();
    expect(retentionAt(curve, 30, 0)).toBeNull();
  });

  it('clamps requests beyond the curve to its endpoints', () => {
    expect(retentionAt(curve, 6000, 600)).toBe(0.3);
  });
});

describe('median', () => {
  it('is robust to the skew that ruins a mean view count', () => {
    // One video with 2M views should not move the centre.
    expect(median([100, 120, 140, 2_000_000])).toBe(130);
  });

  it('returns null for an empty set', () => {
    expect(median([])).toBeNull();
  });

  it('ignores non-finite values', () => {
    expect(median([1, 2, 3, Number.NaN])).toBe(2);
  });
});
