/**
 * Duplicate + cannibalization detection (spec §27, §28).
 *
 * Deliberately lexical, not embedding-based. Two reasons: it costs nothing per
 * check, and it is inspectable — when the dashboard says "82% similar to video
 * X" the operator can see which shingles matched. Embeddings are the right
 * upgrade once the catalogue is large enough that paraphrase collisions matter;
 * see docs/ARCHITECTURE.md.
 */

const STOPWORDS = new Set([
  'a','an','and','the','of','to','in','on','for','is','are','was','were','be','been','it','its','that','this',
  'with','as','at','by','from','how','why','what','who','when','which','into','about','over','after','before',
  'their','they','you','your','we','our','has','have','had','not','but','or','if','than','then','so','can','could',
  'will','would','make','makes','made','really','actually','just','more','most','very',
]);

export function tokenize(text: string): string[] {
  const m = text.toLowerCase().match(/[a-z0-9$%.'-]+/g);
  if (!m) return [];
  return m.map((t) => t.replace(/^[.'-]+|[.'-]+$/g, '')).filter((t) => t.length > 1 && !STOPWORDS.has(t));
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  for (const t of small) if (large.has(t)) inter++;
  return inter / (a.size + b.size - inter);
}

export function shingles(tokens: string[], n = 3): Set<string> {
  const out = new Set<string>();
  if (tokens.length < n) {
    if (tokens.length) out.add(tokens.join(' '));
    return out;
  }
  for (let i = 0; i <= tokens.length - n; i++) out.add(tokens.slice(i, i + n).join(' '));
  return out;
}

export interface SimilarityBreakdown {
  /** 0..1 over unigrams — "is this about the same subject?" */
  topical: number;
  /** 0..1 over 3-grams — "is this the same prose?" */
  phrasal: number;
  /** Weighted headline number, 0..1. */
  combined: number;
}

export function compareText(a: string, b: string): SimilarityBreakdown {
  const ta = tokenize(a);
  const tb = tokenize(b);
  const topical = jaccard(new Set(ta), new Set(tb));
  const phrasal = jaccard(shingles(ta), shingles(tb));
  // Phrasal overlap is the stronger signal of actual reuse, so it dominates.
  const combined = topical * 0.4 + phrasal * 0.6;
  return { topical, phrasal, combined };
}

export type DuplicateVerdict = 'DISTINCT' | 'RELATED' | 'CANNIBALIZES' | 'DUPLICATE';

export interface DuplicateCheckInput {
  candidateTitle: string;
  candidateAngle: string;
  existing: Array<{ id: string; title: string; angle?: string | null; entityKeys?: string[] }>;
  candidateEntityKeys?: string[];
}

export interface DuplicateMatch {
  id: string;
  title: string;
  verdict: DuplicateVerdict;
  similarity: SimilarityBreakdown;
  sharedEntities: string[];
  reason: string;
}

export const DUPLICATE_THRESHOLD = 0.62;
export const CANNIBALIZATION_THRESHOLD = 0.42;
export const RELATED_THRESHOLD = 0.25;

export function checkDuplicates(input: DuplicateCheckInput): DuplicateMatch[] {
  const candidate = `${input.candidateTitle}. ${input.candidateAngle}`;
  const candEntities = new Set((input.candidateEntityKeys ?? []).map((e) => e.toLowerCase()));

  const matches: DuplicateMatch[] = [];
  for (const e of input.existing) {
    const other = `${e.title}. ${e.angle ?? ''}`;
    const similarity = compareText(candidate, other);
    const sharedEntities = (e.entityKeys ?? []).map((x) => x.toLowerCase()).filter((x) => candEntities.has(x));

    // Sharing the primary subject (e.g. both are NVIDIA videos) lifts an
    // otherwise-moderate similarity, because two videos about the same company
    // compete for the same search intent even when worded differently.
    //
    // KNOWN LIMITATION: this is lexical, so "How NVIDIA Makes Money" and "How
    // NVIDIA Makes Billions From AI" share almost no content words after
    // stopword removal and surface as RELATED rather than CANNIBALIZES. The
    // boost is deliberately not inflated to force that verdict — a threshold
    // tuned until one example passes is not detection, it is overfitting.
    // Catching paraphrased overlap needs embeddings; see docs/ARCHITECTURE.md.
    const entityBoost = sharedEntities.length > 0 ? 0.2 : 0;
    const effective = Math.min(1, similarity.combined + entityBoost);

    let verdict: DuplicateVerdict = 'DISTINCT';
    let reason = 'No meaningful overlap with existing catalogue';
    if (effective >= DUPLICATE_THRESHOLD) {
      verdict = 'DUPLICATE';
      reason = `Near-identical to "${e.title}" (${pct(effective)} combined overlap)`;
    } else if (effective >= CANNIBALIZATION_THRESHOLD) {
      verdict = 'CANNIBALIZES';
      reason =
        `Competes with "${e.title}" for the same audience and search intent (${pct(effective)} overlap` +
        (sharedEntities.length ? `, shares: ${sharedEntities.join(', ')}` : '') +
        ') — consider merging or sharpening the angle';
    } else if (effective >= RELATED_THRESHOLD) {
      verdict = 'RELATED';
      reason = `Related to "${e.title}" (${pct(effective)} overlap) — good internal-link candidate`;
    } else if (sharedEntities.length > 0) {
      // Rule, not a tuned threshold: two videos about the same company are at
      // minimum related, however differently they are worded. RELATED is
      // informational and never blocks, so surfacing it costs nothing and
      // missing it hides the internal-link and cannibalization context a human
      // needs.
      verdict = 'RELATED';
      reason =
        `Shares subject with "${e.title}" (${sharedEntities.join(', ')}) though the wording differs ` +
        `(${pct(effective)} text overlap) — check they are not competing for the same search intent`;
    }

    if (verdict !== 'DISTINCT') {
      matches.push({ id: e.id, title: e.title, verdict, similarity, sharedEntities, reason });
    }
  }

  const order: Record<DuplicateVerdict, number> = { DUPLICATE: 0, CANNIBALIZES: 1, RELATED: 2, DISTINCT: 3 };
  return matches.sort((a, b) => order[a.verdict] - order[b.verdict] || b.similarity.combined - a.similarity.combined);
}

export function blocksProduction(matches: DuplicateMatch[]): boolean {
  return matches.some((m) => m.verdict === 'DUPLICATE');
}

const pct = (v: number) => `${Math.round(v * 100)}%`;
