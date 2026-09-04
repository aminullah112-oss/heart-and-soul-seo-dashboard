import { env, pricing } from '@yme/config';
import { EngineError, providerError, withRetry, withTimeout } from '@yme/shared';
import { recordCost } from '@yme/database';
import { MOCK_SEARCH_CORPUS } from './mock-corpus.js';

export interface SearchResult {
  url: string;
  title: string;
  snippet: string;
  publisher?: string;
  publishedAt?: string | null;
}

export interface SearchProvider {
  readonly name: string;
  search(query: string, limit: number): Promise<SearchResult[]>;
}

class MockSearchProvider implements SearchProvider {
  readonly name = 'mock';
  async search(query: string, limit: number): Promise<SearchResult[]> {
    const terms = query.toLowerCase().split(/\s+/).filter((t) => t.length > 2);
    const scored = MOCK_SEARCH_CORPUS.map((doc) => {
      const hay = `${doc.title} ${doc.snippet} ${doc.publisher}`.toLowerCase();
      const score = terms.reduce((a, t) => a + (hay.includes(t) ? 1 : 0), 0);
      return { doc, score };
    })
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score);

    // Always return something: an empty result set would make every mock run
    // fail the coverage gate and hide real bugs behind a fake rejection.
    const chosen = (scored.length ? scored.map((x) => x.doc) : MOCK_SEARCH_CORPUS).slice(0, limit);
    return chosen.map((d) => ({ ...d }));
  }
}

class BraveSearchProvider implements SearchProvider {
  readonly name = 'brave';
  async search(query: string, limit: number): Promise<SearchResult[]> {
    const url = new URL('https://api.search.brave.com/res/v1/web/search');
    url.searchParams.set('q', query);
    url.searchParams.set('count', String(Math.min(limit, 20)));

    const res = await fetch(url, {
      headers: { Accept: 'application/json', 'X-Subscription-Token': env.BRAVE_SEARCH_API_KEY },
    });
    if (res.status === 429) throw new EngineError('RATE_LIMIT', 'Brave search rate limit', { retryable: true });
    if (res.status === 401 || res.status === 403)
      throw new EngineError('CONFIG', 'Brave rejected BRAVE_SEARCH_API_KEY', { retryable: false });
    if (!res.ok) throw providerError(`Brave search failed (${res.status})`);

    const body = (await res.json()) as {
      web?: { results?: Array<{ url: string; title: string; description?: string; age?: string; profile?: { name?: string } }> };
    };
    return (body.web?.results ?? []).map((r) => ({
      url: r.url,
      title: r.title,
      snippet: stripTags(r.description ?? ''),
      publisher: r.profile?.name,
      publishedAt: r.age ?? null,
    }));
  }
}

class TavilySearchProvider implements SearchProvider {
  readonly name = 'tavily';
  async search(query: string, limit: number): Promise<SearchResult[]> {
    const res = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: env.TAVILY_API_KEY,
        query,
        max_results: Math.min(limit, 20),
        search_depth: 'advanced',
      }),
    });
    if (res.status === 429) throw new EngineError('RATE_LIMIT', 'Tavily rate limit', { retryable: true });
    if (res.status === 401) throw new EngineError('CONFIG', 'Tavily rejected TAVILY_API_KEY', { retryable: false });
    if (!res.ok) throw providerError(`Tavily search failed (${res.status})`);

    const body = (await res.json()) as {
      results?: Array<{ url: string; title: string; content?: string; published_date?: string }>;
    };
    return (body.results ?? []).map((r) => ({
      url: r.url,
      title: r.title,
      snippet: r.content ?? '',
      publishedAt: r.published_date ?? null,
    }));
  }
}

const stripTags = (s: string) => s.replace(/<[^>]*>/g, '');

let cached: SearchProvider | null = null;

export function getSearchProvider(): SearchProvider {
  if (cached) return cached;
  if (env.MOCK_MODE || env.SEARCH_PROVIDER === 'mock') cached = new MockSearchProvider();
  else if (env.SEARCH_PROVIDER === 'brave') cached = new BraveSearchProvider();
  else cached = new TavilySearchProvider();
  return cached;
}

export function resetSearchProvider(): void {
  cached = null;
}

/** Search with retry, timeout and cost accounting in one place. */
export async function search(
  query: string,
  opts: { limit?: number; videoProjectId?: string | null; stage?: string } = {},
): Promise<SearchResult[]> {
  const provider = getSearchProvider();
  const limit = opts.limit ?? 8;

  const results = await withRetry(() => withTimeout(provider.search(query, limit), 30_000, `search:${provider.name}`), {
    attempts: 3,
    baseDelayMs: 800,
  });

  const rate = pricing.search[provider.name] ?? pricing.search.default!;
  if (rate > 0) {
    await recordCost({
      videoProjectId: opts.videoProjectId ?? null,
      category: 'SEARCH',
      provider: provider.name,
      stage: opts.stage ?? 'RESEARCH',
      usd: rate,
      units: 1,
      unitLabel: 'queries',
      detail: { query, resultCount: results.length },
    });
  }

  return results;
}
