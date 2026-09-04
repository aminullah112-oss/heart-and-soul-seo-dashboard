import { SOURCE_TIER_WEIGHT, type SourceTier } from '@yme/shared';

/**
 * Domain → source tier. This is the cheapest, most reliable part of source
 * quality assessment: an SEC domain is a regulatory filing no matter what an
 * LLM thinks about the page text. Only unrecognised domains fall through to a
 * model call, which keeps research cost down and the tiering consistent.
 */
const DOMAIN_TIERS: Array<[RegExp, SourceTier]> = [
  [/(^|\.)sec\.gov$/i, 'REGULATORY_FILING'],
  [/(^|\.)europa\.eu$/i, 'REGULATORY_FILING'],
  [/(^|\.)sedar\.com$/i, 'REGULATORY_FILING'],
  [/(^|\.)gov(\.[a-z]{2})?$/i, 'GOVERNMENT'],
  [/(^|\.)bls\.gov$/i, 'GOVERNMENT'],
  [/(^|\.)census\.gov$/i, 'GOVERNMENT'],
  [/(^|\.)eia\.gov$/i, 'GOVERNMENT'],
  [/(^|\.)federalreserve\.gov$/i, 'GOVERNMENT'],
  [/(^|\.)ecb\.europa\.eu$/i, 'GOVERNMENT'],
  [/(^|\.)imf\.org$/i, 'GOVERNMENT'],
  [/(^|\.)worldbank\.org$/i, 'GOVERNMENT'],
  [/(^|\.)oecd\.org$/i, 'GOVERNMENT'],
  [/(^|\.)arxiv\.org$/i, 'ACADEMIC'],
  [/(^|\.)nber\.org$/i, 'ACADEMIC'],
  [/(^|\.)nature\.com$/i, 'ACADEMIC'],
  [/(^|\.)science\.org$/i, 'ACADEMIC'],
  [/(^|\.)ssrn\.com$/i, 'ACADEMIC'],
  [/(^|\.)reuters\.com$/i, 'REPUTABLE_JOURNALISM'],
  [/(^|\.)apnews\.com$/i, 'REPUTABLE_JOURNALISM'],
  [/(^|\.)bloomberg\.com$/i, 'REPUTABLE_JOURNALISM'],
  [/(^|\.)ft\.com$/i, 'REPUTABLE_JOURNALISM'],
  [/(^|\.)wsj\.com$/i, 'REPUTABLE_JOURNALISM'],
  [/(^|\.)economist\.com$/i, 'REPUTABLE_JOURNALISM'],
  [/(^|\.)nytimes\.com$/i, 'REPUTABLE_JOURNALISM'],
  [/(^|\.)cnbc\.com$/i, 'REPUTABLE_JOURNALISM'],
  [/(^|\.)theinformation\.com$/i, 'SPECIALIST_PUBLICATION'],
  [/(^|\.)stratechery\.com$/i, 'SPECIALIST_PUBLICATION'],
  [/(^|\.)semianalysis\.com$/i, 'SPECIALIST_PUBLICATION'],
  [/(^|\.)gartner\.com$/i, 'INDUSTRY_RESEARCH'],
  [/(^|\.)idc\.com$/i, 'INDUSTRY_RESEARCH'],
  [/(^|\.)iea\.org$/i, 'INDUSTRY_RESEARCH'],
  [/(^|\.)statista\.com$/i, 'INDUSTRY_RESEARCH'],
];

/** Paths that mark a company's own domain as a primary financial source. */
const PRIMARY_PATH_HINTS = /\/(investor|investors|ir|annual-report|financial|quarterly-results|newsroom|press)/i;

export function tierForUrl(rawUrl: string): SourceTier | null {
  let host: string;
  let pathname: string;
  try {
    const u = new URL(rawUrl);
    host = u.hostname;
    pathname = u.pathname;
  } catch {
    return null;
  }

  for (const [re, tier] of DOMAIN_TIERS) if (re.test(host)) return tier;
  if (/^investor[s]?\./i.test(host) || PRIMARY_PATH_HINTS.test(pathname)) return 'PRIMARY_COMPANY';
  return null;
}

/**
 * Reliability starts from the tier prior and is adjusted by observable
 * properties. It never exceeds the tier ceiling — a blog post cannot become a
 * filing by being well written.
 */
export function reliabilityFor(tier: SourceTier, signals: { hasDate: boolean; isHttps: boolean; bodyLength: number }): number {
  let score = SOURCE_TIER_WEIGHT[tier];
  if (!signals.hasDate) score -= 8; // undated sources age badly and cannot be re-checked
  if (!signals.isHttps) score -= 5;
  if (signals.bodyLength < 400) score -= 10; // stub pages and paywalls
  return Math.max(0, Math.min(SOURCE_TIER_WEIGHT[tier], Math.round(score)));
}

/** Two sources from the same domain are one source for corroboration purposes. */
export function independentDomains(urls: string[]): number {
  const hosts = new Set<string>();
  for (const u of urls) {
    try {
      hosts.add(new URL(u).hostname.replace(/^www\./, ''));
    } catch {
      /* ignore unparseable */
    }
  }
  return hosts.size;
}
