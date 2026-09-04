import { describe, it, expect } from 'vitest';
import { countWords, extractAssertions, findAiTells, estimateNarrationSeconds, targetWordCount, splitSentences, wrapForCaption } from '../text.js';

describe('word counting', () => {
  it('treats formatted figures as single words', () => {
    // "$3.2bn" is one spoken unit; counting it as three inflates the duration
    // estimate and desynchronises planned scene timing.
    expect(countWords('Revenue hit $3.2bn last year')).toBe(5);
    expect(countWords('AI-first companies grew 40%')).toBe(4);
  });

  it('handles empty and whitespace input', () => {
    expect(countWords('')).toBe(0);
    expect(countWords('   \n  ')).toBe(0);
  });
});

describe('duration estimation', () => {
  it('round-trips against the target word count', () => {
    const words = targetWordCount(12);
    const text = Array.from({ length: words }, () => 'word').join(' ');
    expect(estimateNarrationSeconds(text) / 60).toBeCloseTo(12, 1);
  });

  it('refuses a non-positive speaking rate rather than dividing by zero', () => {
    expect(() => estimateNarrationSeconds('hello', 0)).toThrow();
  });
});

describe('assertion extraction', () => {
  it('finds money, percentages and magnitudes', () => {
    const found = extractAssertions('Revenue was $47.5 billion, up 122% year on year, a 3.4x increase.');
    const numbers = found.filter((a) => a.kind === 'NUMBER');
    expect(numbers.length).toBeGreaterThanOrEqual(3);
  });

  it('flags a quotation only when it is attributed', () => {
    // An unattributed quoted span is usually scare quotes or a title. Flagging
    // those produced five false HIGH findings on a single script, which is how
    // an operator learns to ignore the fact checker.
    const scare = extractAssertions('They call this a "duration mismatch" internally.');
    expect(scare.filter((a) => a.kind === 'QUOTE')).toHaveLength(0);

    const attributed = extractAssertions('The founder said "we are a state of consciousness company" on stage.');
    expect(attributed.filter((a) => a.kind === 'QUOTE')).toHaveLength(1);
  });

  it('flags priority and superlative claims', () => {
    const found = extractAssertions('It was the first company to do this at scale.');
    expect(found.some((a) => a.kind === 'SUPERLATIVE')).toBe(true);
  });

  it('returns assertions in document order', () => {
    const found = extractAssertions('In 2019 revenue was $4bn. By 2024 it was $47bn.');
    const offsets = found.map((a) => a.offset);
    expect([...offsets].sort((a, b) => a - b)).toEqual(offsets);
  });
});

describe('AI tells', () => {
  it('catches the phrases the style guide bans', () => {
    const tells = findAiTells('In conclusion, this is a game changer.');
    expect(tells).toContain('in conclusion');
    expect(tells).toContain('game changer');
  });

  it('is quiet on clean prose', () => {
    expect(findAiTells('Costco runs its merchandise business close to break-even on purpose.')).toEqual([]);
  });
});

describe('sentence splitting and caption wrapping', () => {
  it('does not split on decimal points or abbreviations mid-figure', () => {
    const sentences = splitSentences('Revenue rose to $3.2 billion. That is the whole story.');
    expect(sentences).toHaveLength(2);
  });

  it('wraps to the requested line width on word boundaries', () => {
    const lines = wrapForCaption('the quick brown fox jumps over the lazy dog again and again', 20, 2);
    for (const line of lines) expect(line.length).toBeLessThanOrEqual(20);
    expect(lines.join(' ')).toContain('quick brown fox');
  });
});
