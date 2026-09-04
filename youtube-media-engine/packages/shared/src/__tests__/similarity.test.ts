import { describe, it, expect } from 'vitest';
import { checkDuplicates, compareText, blocksProduction, tokenize, jaccard, shingles } from '../similarity.js';

describe('text similarity', () => {
  it('scores identical text as 1', () => {
    const s = compareText('How NVIDIA makes money', 'How NVIDIA makes money');
    expect(s.combined).toBeCloseTo(1, 5);
  });

  it('scores unrelated text near zero', () => {
    const s = compareText('How Costco makes money from memberships', 'Why Nokia lost the smartphone market');
    expect(s.combined).toBeLessThan(0.15);
  });

  it('weights reused prose above shared vocabulary', () => {
    // Same subject matter, different sentences: topical overlap, no phrasal.
    const sharedVocabulary = compareText(
      'NVIDIA data centre revenue grew because researchers adopted CUDA early',
      'CUDA adoption by researchers is why NVIDIA revenue from data centre grew',
    );
    // Literally reused sentences: high phrasal overlap.
    const reusedProse = compareText(
      'NVIDIA spent fifteen years making its chips the only ones researchers knew how to program',
      'NVIDIA spent fifteen years making its chips the only ones researchers knew how to use',
    );
    expect(reusedProse.phrasal).toBeGreaterThan(sharedVocabulary.phrasal);
    expect(reusedProse.combined).toBeGreaterThan(sharedVocabulary.combined);
  });

  it('ignores stopwords so "the" does not create false similarity', () => {
    expect(tokenize('the and of to in')).toHaveLength(0);
  });

  it('handles empty sets without dividing by zero', () => {
    expect(jaccard(new Set(), new Set())).toBe(1);
    expect(jaccard(new Set(['a']), new Set())).toBe(0);
    expect(shingles([]).size).toBe(0);
  });
});

describe('duplicate detection', () => {
  const existing = [
    { id: '1', title: 'How NVIDIA Makes Money', angle: 'CUDA lock-in explains the margin', entityKeys: ['nvidia', 'cuda'] },
    { id: '2', title: 'Why Nokia Lost', angle: 'A platform decision made too late', entityKeys: ['nokia'] },
  ];

  it('blocks a near-identical proposal', () => {
    const matches = checkDuplicates({
      candidateTitle: 'How NVIDIA Makes Money',
      candidateAngle: 'CUDA lock-in explains the margin',
      candidateEntityKeys: ['nvidia', 'cuda'],
      existing,
    });
    expect(matches[0]?.verdict).toBe('DUPLICATE');
    expect(blocksProduction(matches)).toBe(true);
  });

  it('flags cannibalization without blocking it', () => {
    // Two videos on the same subject with overlapping framing compete for the
    // same search intent. That is an editorial judgement, not a rejection.
    const matches = checkDuplicates({
      candidateTitle: 'How NVIDIA Makes Money From AI',
      candidateAngle: 'CUDA lock-in explains the margin on data centre sales',
      candidateEntityKeys: ['nvidia', 'cuda'],
      existing,
    });
    const nvidia = matches.find((m) => m.id === '1');
    expect(nvidia?.verdict).toBe('CANNIBALIZES');
    expect(blocksProduction(matches)).toBe(false);
  });

  it('under-detects paraphrased overlap, and surfaces it as RELATED rather than silently passing', () => {
    // Documented limitation of lexical matching: after stopword removal these
    // two titles share only "nvidia". The shared-entity boost is enough to
    // surface it for a human, not enough to call it cannibalization — and the
    // threshold is deliberately not tuned until it does.
    const matches = checkDuplicates({
      candidateTitle: 'How NVIDIA Makes Billions From AI',
      candidateAngle: 'Where the data centre revenue actually comes from',
      candidateEntityKeys: ['nvidia'],
      existing,
    });
    const nvidia = matches.find((m) => m.id === '1');
    expect(nvidia?.verdict).toBe('RELATED');
    expect(nvidia?.sharedEntities).toContain('nvidia');
  });

  it('leaves genuinely different topics alone', () => {
    const matches = checkDuplicates({
      candidateTitle: 'Why Rolex Manufactures Scarcity',
      candidateAngle: 'Allocation discipline creates a secondary market that advertises for free',
      candidateEntityKeys: ['rolex'],
      existing,
    });
    expect(blocksProduction(matches)).toBe(false);
    expect(matches.filter((m) => m.verdict === 'CANNIBALIZES')).toHaveLength(0);
  });

  it('escalates to DUPLICATE when the wording is near-identical', () => {
    const matches = checkDuplicates({
      candidateTitle: 'How NVIDIA Makes Money From CUDA Lock-In',
      candidateAngle: 'CUDA lock-in explains the data centre margin',
      candidateEntityKeys: ['nvidia', 'cuda'],
      existing,
    });
    expect(matches.find((m) => m.id === '1')?.verdict).toBe('DUPLICATE');
    expect(blocksProduction(matches)).toBe(true);
  });

  it('surfaces a shared primary subject that bare text similarity would miss', () => {
    const args = {
      candidateTitle: 'The NVIDIA Supply Chain, Explained',
      candidateAngle: 'Who actually captures the value',
      existing,
    };
    const withEntity = checkDuplicates({ ...args, candidateEntityKeys: ['nvidia'] });
    const withoutEntity = checkDuplicates({ ...args, candidateEntityKeys: [] });

    // Same text, so the raw similarity is identical; only the verdict changes,
    // which is what makes the boost inspectable rather than a hidden fudge.
    expect(withEntity.find((m) => m.id === '1')?.verdict).toBe('RELATED');
    expect(withoutEntity.find((m) => m.id === '1')).toBeUndefined();
  });

  it('sorts the most severe verdict first', () => {
    const matches = checkDuplicates({
      candidateTitle: 'How NVIDIA Makes Money',
      candidateAngle: 'CUDA lock-in explains the margin',
      candidateEntityKeys: ['nvidia'],
      existing: [...existing, { id: '3', title: 'How NVIDIA Makes Money', angle: 'CUDA lock-in explains the margin' }],
    });
    expect(matches[0]?.verdict).toBe('DUPLICATE');
  });
});
