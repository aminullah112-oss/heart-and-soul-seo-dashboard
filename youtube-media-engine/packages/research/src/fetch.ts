import { env } from '@yme/config';
import { withRetry, withTimeout, EngineError } from '@yme/shared';
import { MOCK_SEARCH_CORPUS } from './mock-corpus.js';

export interface FetchedPage {
  url: string;
  finalUrl: string;
  title: string | null;
  text: string;
  publishedAt: string | null;
  ok: boolean;
  /** Populated when the page could not be used as evidence. */
  unavailableReason: string | null;
}

const USER_AGENT =
  'Mozilla/5.0 (compatible; YouTubeMediaEngine/0.1; +research-bot) AppleWebKit/537.36 (KHTML, like Gecko)';

/** Signals that a fetch succeeded technically but produced no usable evidence. */
const PAYWALL_MARKERS = [
  'subscribe to continue',
  'subscription required',
  'you have reached your article limit',
  'sign in to read',
  'this content is for subscribers',
  'enable javascript',
  'please enable cookies',
  'access denied',
  'are you a robot',
];

export async function fetchPage(url: string, opts: { timeoutMs?: number } = {}): Promise<FetchedPage> {
  if (env.MOCK_MODE) return mockFetch(url);

  const timeoutMs = opts.timeoutMs ?? 20_000;

  try {
    const res = await withRetry(
      () =>
        withTimeout(
          fetch(url, {
            headers: { 'User-Agent': USER_AGENT, Accept: 'text/html,application/xhtml+xml' },
            redirect: 'follow',
          }),
          timeoutMs,
          `fetch:${url}`,
        ),
      {
        attempts: 3,
        baseDelayMs: 700,
        shouldRetry: (err) => err instanceof EngineError && err.retryable,
      },
    );

    if (!res.ok) {
      return unusable(url, `HTTP ${res.status}`);
    }

    const contentType = res.headers.get('content-type') ?? '';
    if (!/text\/html|application\/xhtml|text\/plain/i.test(contentType)) {
      // PDFs are common for filings and reports, but parsing them is a
      // separate concern; the source is kept with the reason recorded rather
      // than silently dropped.
      return unusable(url, `Unsupported content-type: ${contentType || 'unknown'}`);
    }

    const html = await res.text();
    const extracted = extractReadableText(html);

    if (extracted.text.length < 300) {
      return unusable(url, 'Extracted body too short to support a claim (likely JS-rendered or a stub page)');
    }
    const lower = extracted.text.slice(0, 3000).toLowerCase();
    const marker = PAYWALL_MARKERS.find((m) => lower.includes(m));
    if (marker) {
      return unusable(url, `Paywall or bot wall detected ("${marker}")`);
    }

    return {
      url,
      finalUrl: res.url || url,
      title: extracted.title,
      text: extracted.text,
      publishedAt: extracted.publishedAt,
      ok: true,
      unavailableReason: null,
    };
  } catch (err) {
    return unusable(url, err instanceof Error ? err.message : String(err));
  }
}

function unusable(url: string, reason: string): FetchedPage {
  return { url, finalUrl: url, title: null, text: '', publishedAt: null, ok: false, unavailableReason: reason };
}

function mockFetch(url: string): FetchedPage {
  const doc = MOCK_SEARCH_CORPUS.find((d) => d.url === url);
  const body = doc
    ? `${doc.snippet}\n\n${'This is mock page body text used to exercise extraction, tiering and claim linking. '.repeat(12)}`
    : `Mock page body for ${url}. ${'Filler content for offline pipeline testing. '.repeat(14)}`;
  return {
    url,
    finalUrl: url,
    title: doc?.title ?? `Mock document — ${url}`,
    text: body,
    publishedAt: doc?.publishedAt ?? null,
    ok: true,
    unavailableReason: null,
  };
}

/**
 * Minimal readability pass.
 *
 * Deliberately not a full DOM parser: research only needs enough clean text to
 * quote an excerpt and let the model locate figures. Strip the non-content
 * elements, unwrap tags, decode entities, collapse whitespace. If a site needs
 * more than this to be readable, it is usually JS-rendered and gets rejected
 * above rather than half-parsed into a misleading excerpt.
 */
export function extractReadableText(html: string): { title: string | null; text: string; publishedAt: string | null } {
  const title = firstMatch(html, /<title[^>]*>([\s\S]*?)<\/title>/i);

  const publishedAt =
    firstMatch(html, /<meta[^>]+property=["']article:published_time["'][^>]+content=["']([^"']+)["']/i) ??
    firstMatch(html, /<meta[^>]+name=["']date["'][^>]+content=["']([^"']+)["']/i) ??
    firstMatch(html, /<time[^>]+datetime=["']([^"']+)["']/i);

  const body = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<nav[\s\S]*?<\/nav>/gi, ' ')
    .replace(/<header[\s\S]*?<\/header>/gi, ' ')
    .replace(/<footer[\s\S]*?<\/footer>/gi, ' ')
    .replace(/<aside[\s\S]*?<\/aside>/gi, ' ')
    .replace(/<form[\s\S]*?<\/form>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    // Keep block boundaries as newlines so paragraphs do not run together.
    .replace(/<\/(p|div|section|article|li|h[1-6]|tr|br)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ');

  return {
    title: title ? decodeEntities(title).trim() : null,
    text: decodeEntities(body)
      .replace(/[ \t ]+/g, ' ')
      .replace(/\n\s*\n\s*\n+/g, '\n\n')
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .join('\n')
      .trim(),
    publishedAt: publishedAt ?? null,
  };
}

function firstMatch(s: string, re: RegExp): string | null {
  const m = s.match(re);
  return m?.[1] ?? null;
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', mdash: '—', ndash: '–',
  lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', hellip: '…', eacute: 'é', pound: '£', euro: '€',
};

export function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => safeCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => safeCodePoint(parseInt(d, 10)))
    .replace(/&([a-z]+);/gi, (m, name: string) => NAMED_ENTITIES[name.toLowerCase()] ?? m);
}

function safeCodePoint(cp: number): string {
  if (!Number.isFinite(cp) || cp < 0 || cp > 0x10ffff) return '';
  try {
    return String.fromCodePoint(cp);
  } catch {
    return '';
  }
}
