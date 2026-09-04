import { describe, it, expect } from 'vitest';
import {
  computeOverallScore,
  computeQcResult,
  computeMonetizationPotential,
  evaluateTopicGates,
  normaliseWeights,
  clampScore,
  INVERTED_DIMENSIONS,
  RESEARCH_AVAILABILITY_FLOOR,
  SCORE_DIMENSIONS,
  type DimensionScores,
} from '../scoring.js';

const flat = (v: number): DimensionScores =>
  Object.fromEntries(SCORE_DIMENSIONS.map((d) => [d, v])) as DimensionScores;

describe('topic scoring', () => {
  it('inverts competition so a saturated topic scores lower', () => {
    // This is the classic sign error in scoring code, and the one most likely
    // to be reintroduced by someone "simplifying" the weighting.
    const low = computeOverallScore({ ...flat(50), competition: 10 });
    const high = computeOverallScore({ ...flat(50), competition: 90 });

    expect(INVERTED_DIMENSIONS.has('competition')).toBe(true);
    expect(low.overall).toBeGreaterThan(high.overall);
  });

  it('is not inverted for any other dimension', () => {
    for (const dim of SCORE_DIMENSIONS) {
      if (dim === 'competition') continue;
      const low = computeOverallScore({ ...flat(50), [dim]: 10 });
      const high = computeOverallScore({ ...flat(50), [dim]: 90 });
      expect(high.overall, `${dim} should score higher when the raw value is higher`).toBeGreaterThan(low.overall);
    }
  });

  it('produces 100 when every non-inverted dimension is perfect', () => {
    const result = computeOverallScore({ ...flat(100), competition: 0 });
    expect(result.overall).toBeCloseTo(100, 1);
  });

  it('normalises weights so only their ratios matter, not their magnitudes', () => {
    const unit = Object.fromEntries(SCORE_DIMENSIONS.map((d) => [d, 1]));
    const scaled = Object.fromEntries(SCORE_DIMENSIONS.map((d) => [d, 1000]));
    const a = computeOverallScore(flat(60), unit);
    const b = computeOverallScore(flat(60), scaled);
    expect(a.overall).toBeCloseTo(b.overall, 6);
  });

  it('merges a partial weight override onto the defaults rather than zeroing the rest', () => {
    // Passing one weight must not silently drop the other eleven dimensions.
    const result = computeOverallScore(flat(60), { viralPotential: 0.5 });
    const weighted = Object.values(result.effectiveWeights).filter((w) => w > 0);
    expect(weighted).toHaveLength(SCORE_DIMENSIONS.length);
  });

  it('rejects negative or non-finite weights instead of silently coercing', () => {
    expect(() => normaliseWeights({ viralPotential: -1 })).toThrow(/non-negative/);
    expect(() => normaliseWeights({ viralPotential: Number.NaN })).toThrow(/non-negative/);
  });

  it('clamps out-of-range inputs rather than letting them distort the total', () => {
    expect(clampScore(150)).toBe(100);
    expect(clampScore(-20)).toBe(0);
    expect(clampScore(Number.NaN)).toBe(0);
    expect(computeOverallScore({ ...flat(50), viralPotential: 5000 }).overall).toBeLessThanOrEqual(100);
  });

  it('treats missing dimensions as zero, not as absent', () => {
    const result = computeOverallScore({ viralPotential: 100 });
    expect(result.overall).toBeGreaterThan(0);
    expect(result.overall).toBeLessThan(100);
  });

  it('contributions sum to the overall score', () => {
    const result = computeOverallScore(flat(73));
    const sum = Object.values(result.contributions).reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(result.overall, 1);
  });
});

describe('topic gates', () => {
  it('rejects an otherwise excellent topic that cannot be researched', () => {
    // Spec §3: if a topic cannot be researched adequately, reject it. A great
    // story with no sources is exactly the video that produces a correction.
    const scores = { ...flat(95), researchAvailability: RESEARCH_AVAILABILITY_FLOOR - 1 };
    const { overall } = computeOverallScore(scores);
    const gates = evaluateTopicGates(scores, overall, 75);

    expect(gates.passed).toBe(false);
    expect(gates.reasons.join(' ')).toMatch(/researchAvailability/);
  });

  it('rejects when the overall score is under the configured minimum', () => {
    const scores = flat(40);
    const { overall } = computeOverallScore(scores);
    expect(evaluateTopicGates(scores, overall, 75).passed).toBe(false);
  });

  it('passes a topic that clears both gates', () => {
    const scores = { ...flat(88), competition: 20 };
    const { overall } = computeOverallScore(scores);
    expect(evaluateTopicGates(scores, overall, 75).passed).toBe(true);
  });
});

describe('monetization potential', () => {
  it('is driven mostly by advertiser value', () => {
    const high = computeMonetizationPotential({
      advertiserValue: 100, affiliatePotential: 0, sponsorshipPotential: 0, evergreenValue: 0, searchDemand: 0,
    });
    const low = computeMonetizationPotential({
      advertiserValue: 0, affiliatePotential: 100, sponsorshipPotential: 0, evergreenValue: 0, searchDemand: 0,
    });
    expect(high).toBeGreaterThan(low);
  });
});

describe('QC composition', () => {
  const strong = {
    scriptQuality: 95, retention: 95, visualQuality: 95, monetizationSafety: 95, originality: 95,
  };

  it('blocks a near-perfect video whose fact check failed', () => {
    const result = computeQcResult(
      { ...strong, factCheck: 'FAIL', copyright: 'PASS', policy: 'PASS', aiDisclosure: 'PASS' },
      85,
    );
    expect(result.finalScore).toBeGreaterThan(90);
    expect(result.passed).toBe(false);
    expect(result.blockingReasons.join(' ')).toMatch(/Fact check/);
  });

  it('blocks on a copyright failure regardless of score', () => {
    const result = computeQcResult(
      { ...strong, factCheck: 'PASS', copyright: 'FAIL', policy: 'PASS', aiDisclosure: 'PASS' },
      85,
    );
    expect(result.passed).toBe(false);
  });

  it('warns but does not block on a copyright warning', () => {
    const result = computeQcResult(
      { ...strong, factCheck: 'PASS', copyright: 'WARNING', policy: 'PASS', aiDisclosure: 'PASS' },
      85,
    );
    expect(result.passed).toBe(true);
    expect(result.warnings.join(' ')).toMatch(/Copyright/);
  });

  it('blocks when the composite score is below the threshold even with all gates passing', () => {
    const result = computeQcResult(
      { scriptQuality: 60, retention: 60, visualQuality: 60, monetizationSafety: 60, originality: 60,
        factCheck: 'PASS', copyright: 'PASS', policy: 'PASS', aiDisclosure: 'PASS' },
      85,
    );
    expect(result.passed).toBe(false);
    expect(result.blockingReasons.join(' ')).toMatch(/below the configured minimum/);
  });

  it('passes only when both the gates and the threshold are satisfied', () => {
    const result = computeQcResult(
      { ...strong, factCheck: 'PASS', copyright: 'PASS', policy: 'PASS', aiDisclosure: 'PASS' },
      85,
    );
    expect(result.passed).toBe(true);
    expect(result.blockingReasons).toHaveLength(0);
  });
});
