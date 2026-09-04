/**
 * Pronunciation handling (spec §17).
 *
 * Two jobs: flag terms a TTS engine is likely to mangle so a human can add a
 * dictionary entry, and apply the dictionary before synthesis. Applying is a
 * whole-token replacement — substring replacement turns "ARR" inside
 * "ARRAY" into nonsense, which is exactly the class of bug that only shows up
 * after you have paid for the audio.
 */

export interface PronunciationRule {
  written: string;
  spoken: string;
}

export interface PronunciationIssue {
  term: string;
  reason: string;
  suggestion: string;
}

/** Terms that TTS engines routinely get wrong, beyond the operator dictionary. */
const RISKY_PATTERNS: Array<{ re: RegExp; reason: string; suggest: (t: string) => string }> = [
  {
    re: /^[A-Z]{2,6}$/,
    reason: 'All-caps acronym — engines vary between spelling it out and reading it as a word',
    suggest: (t) => t.split('').join('-'),
  },
  {
    re: /^[A-Z][a-z]+[A-Z][A-Za-z]*$/,
    reason: 'Internal capital (camel case) — often read as one mangled word',
    suggest: (t) => t.replace(/([a-z])([A-Z])/g, '$1 $2'),
  },
  {
    re: /^\$?\d+(\.\d+)?[BMKT]$/i,
    reason: 'Abbreviated magnitude — may be read as a letter rather than a scale word',
    suggest: (t) => t.replace(/B$/i, ' billion').replace(/M$/i, ' million').replace(/K$/i, ' thousand').replace(/T$/i, ' trillion'),
  },
  {
    re: /^\d{4}s$/,
    reason: 'Decade form — inconsistent handling of the plural',
    suggest: (t) => `${t.slice(0, 4)}s`,
  },
  {
    re: /^Q[1-4]$/,
    reason: 'Fiscal quarter shorthand',
    suggest: (t) => `Q ${t[1]}`,
  },
  {
    re: /^\d+-[A-Z]$/,
    reason: 'Filing shorthand such as 10-K',
    suggest: (t) => t.replace('-', ' '),
  },
];

/** Words that look risky but are read correctly by every engine worth using. */
const SAFE_ACRONYMS = new Set(['AI', 'US', 'UK', 'EU', 'CEO', 'CFO', 'IPO', 'PC', 'TV', 'IT']);

export function detectPronunciationIssues(text: string, known: PronunciationRule[]): PronunciationIssue[] {
  const knownSet = new Set(known.map((k) => k.written.toLowerCase()));
  const seen = new Set<string>();
  const issues: PronunciationIssue[] = [];

  const tokens = text.match(/[A-Za-z0-9$.-]+/g) ?? [];
  for (const raw of tokens) {
    const token = raw.replace(/^[.$-]+|[.-]+$/g, '');
    if (!token || token.length < 2) continue;
    const lower = token.toLowerCase();
    if (knownSet.has(lower) || seen.has(lower) || SAFE_ACRONYMS.has(token)) continue;

    for (const rule of RISKY_PATTERNS) {
      if (rule.re.test(token)) {
        seen.add(lower);
        issues.push({ term: token, reason: rule.reason, suggestion: rule.suggest(token) });
        break;
      }
    }
  }
  return issues;
}

/**
 * Applies the dictionary with whole-token matching, longest-first so a
 * multi-word entry ("10-K") is not pre-empted by a shorter one.
 */
export function applyPronunciation(text: string, rules: PronunciationRule[]): string {
  if (!rules.length) return text;
  const sorted = [...rules].sort((a, b) => b.written.length - a.written.length);
  let out = text;
  for (const rule of sorted) {
    const escaped = rule.written.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // Boundaries are explicit rather than \b: \b does not behave usefully
    // around "$" or "-", which appear in most of these terms.
    const re = new RegExp(`(^|[^A-Za-z0-9])${escaped}(?![A-Za-z0-9])`, 'g');
    out = out.replace(re, (_m, pre: string) => `${pre}${rule.spoken}`);
  }
  return out;
}
