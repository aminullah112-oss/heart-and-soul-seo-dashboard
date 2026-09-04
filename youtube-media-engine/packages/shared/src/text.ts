/** Word count that does not treat "$3.2bn" or "AI-first" as multiple words. */
export function countWords(text: string): number {
  const m = text.trim().match(/[\p{L}\p{N}][\p{L}\p{N}'’.$%-]*/gu);
  return m ? m.length : 0;
}

/**
 * Narration duration estimate. 150 wpm is the usual conversational
 * documentary pace; the real duration comes from ffprobe on the rendered
 * audio, and this is only used for planning before TTS has run.
 */
export const DEFAULT_WORDS_PER_MINUTE = 150;

export function estimateNarrationSeconds(text: string, wpm = DEFAULT_WORDS_PER_MINUTE): number {
  if (wpm <= 0) throw new Error('wpm must be positive');
  return (countWords(text) / wpm) * 60;
}

export function targetWordCount(minutes: number, wpm = DEFAULT_WORDS_PER_MINUTE): number {
  return Math.round(minutes * wpm);
}

/** Splits narration into sentence-ish units for per-scene TTS and captions. */
export function splitSentences(text: string): string[] {
  return text
    .replace(/\s+/g, ' ')
    .trim()
    .split(/(?<=[.!?])\s+(?=[A-Z"'“‘(])/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Caption lines: at most `maxChars`, broken on word boundaries. */
export function wrapForCaption(text: string, maxChars = 42, maxLines = 2): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = '';
  for (const w of words) {
    const candidate = current ? `${current} ${w}` : w;
    if (candidate.length > maxChars && current) {
      lines.push(current);
      current = w;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  if (lines.length <= maxLines) return lines;
  // Too long for one cue — the caller re-splits into multiple cues.
  return lines;
}

const AI_TELLS = [
  'in today’s world',
  "in today's world",
  'in the ever-evolving',
  'it is important to note',
  "it's important to note",
  'delve into',
  'a game changer',
  'game-changing',
  'revolutionize',
  'revolutionized the way',
  'unlock the power',
  'harness the power',
  'in conclusion',
  'buckle up',
  'let’s dive in',
  "let's dive in",
  'the landscape of',
  'navigating the complexities',
  'testament to',
  'at the end of the day',
  'when it comes to',
];

/** Spec §11: "avoid obvious AI phrasing". Returns the offending phrases found. */
export function findAiTells(text: string): string[] {
  const lower = text.toLowerCase();
  return AI_TELLS.filter((p) => lower.includes(p));
}

const HEDGES = ['perhaps', 'arguably', 'it could be argued', 'some say', 'many believe', 'reportedly'];

export function countHedges(text: string): number {
  const lower = text.toLowerCase();
  return HEDGES.reduce((acc, h) => acc + (lower.split(h).length - 1), 0);
}

/** Extracts numeric/date/quote spans that the fact checker must verify. */
export interface ExtractedAssertion {
  text: string;
  kind: 'NUMBER' | 'DATE' | 'QUOTE' | 'SUPERLATIVE';
  offset: number;
}

export function extractAssertions(text: string): ExtractedAssertion[] {
  const out: ExtractedAssertion[] = [];
  const push = (re: RegExp, kind: ExtractedAssertion['kind']) => {
    for (const m of text.matchAll(re)) {
      if (m.index === undefined) continue;
      out.push({ text: m[0].trim(), kind, offset: m.index });
    }
  };

  // Money, percentages, multiples, plain large numbers.
  push(/[$€£]\s?\d[\d,.]*\s?(?:trillion|billion|million|bn|m|k)?/gi, 'NUMBER');
  push(/\b\d[\d,.]*\s?(?:percent|%)/gi, 'NUMBER');
  push(/\b\d[\d,.]*\s?(?:trillion|billion|million)\b/gi, 'NUMBER');
  push(/\b\d+(?:\.\d+)?x\b/gi, 'NUMBER');
  // Years and explicit dates.
  push(/\b(?:19|20)\d{2}\b/g, 'DATE');
  // Quoted speech of at least a few words.
  push(/[“"][^”"]{12,}[”"]/g, 'QUOTE');
  // Unfalsifiable-sounding superlatives that need a source or softening.
  push(/\b(?:the (?:first|largest|biggest|most valuable|only|fastest[- ]growing))\b/gi, 'SUPERLATIVE');

  return out.sort((a, b) => a.offset - b.offset);
}
