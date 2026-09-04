import { env, pricing } from '@yme/config';
import { EngineError, providerError, withRetry, withTimeout } from '@yme/shared';
import { recordCost } from '@yme/database';
import type { StockQuery, VisualAsset } from './types.js';

export interface StockProvider {
  readonly name: string;
  searchVideos(q: StockQuery): Promise<VisualAsset[]>;
  searchPhotos(q: StockQuery): Promise<VisualAsset[]>;
}

/**
 * Offline stock provider. Returns no downloadable media — the render pipeline
 * substitutes a generated placeholder card instead. That is deliberate: mock
 * mode must never fabricate an asset with a plausible-looking licence, because
 * a licence field that is wrong is worse than one that is empty.
 */
class MockStockProvider implements StockProvider {
  readonly name = 'mock';

  async searchVideos(q: StockQuery): Promise<VisualAsset[]> {
    return [this.placeholder(q, 'video/mp4', 1920, 1080)];
  }

  async searchPhotos(q: StockQuery): Promise<VisualAsset[]> {
    return [this.placeholder(q, 'image/png', 1920, 1080)];
  }

  private placeholder(q: StockQuery, mimeType: string, width: number, height: number): VisualAsset {
    return {
      provider: 'mock',
      sourceUrl: null,
      downloadUrl: null,
      mimeType,
      width,
      height,
      durationSeconds: mimeType.startsWith('video') ? 10 : undefined,
      licence: 'MOCK — no real asset, render substitutes a generated card',
      licenceUrl: null,
      attributionRequired: false,
      attributionText: null,
      copyrightRisk: 'NONE',
    };
  }
}

class PexelsProvider implements StockProvider {
  readonly name = 'pexels';

  async searchVideos(q: StockQuery): Promise<VisualAsset[]> {
    const url = new URL('https://api.pexels.com/videos/search');
    url.searchParams.set('query', q.query);
    url.searchParams.set('per_page', String(q.limit ?? 5));
    url.searchParams.set('orientation', q.orientation ?? 'landscape');
    url.searchParams.set('size', 'medium');

    const body = await this.call<{
      videos?: Array<{
        id: number;
        url: string;
        width: number;
        height: number;
        duration: number;
        user: { name: string; url: string };
        video_files: Array<{ link: string; width: number | null; height: number | null; file_type: string }>;
      }>;
    }>(url);

    return (body.videos ?? []).flatMap((v) => {
      const file = [...v.video_files]
        .filter((f) => f.file_type === 'video/mp4' && (f.width ?? 0) >= (q.minWidth ?? 1280))
        .sort((a, b) => (a.width ?? 0) - (b.width ?? 0))[0];
      if (!file) return [];
      return [
        {
          provider: 'pexels',
          sourceUrl: v.url,
          downloadUrl: file.link,
          mimeType: 'video/mp4',
          width: file.width ?? v.width,
          height: file.height ?? v.height,
          durationSeconds: v.duration,
          licence: 'Pexels License',
          licenceUrl: 'https://www.pexels.com/license/',
          // Not legally required by the Pexels licence, but credited anyway:
          // the cost is one line in the description and it keeps the channel
          // clear of "did you have the right to use that" arguments.
          attributionRequired: false,
          attributionText: `Video by ${v.user.name} on Pexels`,
          copyrightRisk: 'LOW' as const,
        },
      ];
    });
  }

  async searchPhotos(q: StockQuery): Promise<VisualAsset[]> {
    const url = new URL('https://api.pexels.com/v1/search');
    url.searchParams.set('query', q.query);
    url.searchParams.set('per_page', String(q.limit ?? 5));
    url.searchParams.set('orientation', q.orientation ?? 'landscape');

    const body = await this.call<{
      photos?: Array<{
        id: number;
        url: string;
        width: number;
        height: number;
        photographer: string;
        src: { original: string; large2x: string };
      }>;
    }>(url);

    return (body.photos ?? []).map((p) => ({
      provider: 'pexels',
      sourceUrl: p.url,
      downloadUrl: p.src.large2x || p.src.original,
      mimeType: 'image/jpeg',
      width: p.width,
      height: p.height,
      licence: 'Pexels License',
      licenceUrl: 'https://www.pexels.com/license/',
      attributionRequired: false,
      attributionText: `Photo by ${p.photographer} on Pexels`,
      copyrightRisk: 'LOW' as const,
    }));
  }

  private async call<T>(url: URL): Promise<T> {
    const res = await fetch(url, { headers: { Authorization: env.STOCK_VIDEO_API_KEY } });
    if (res.status === 401) throw new EngineError('CONFIG', 'Pexels rejected STOCK_VIDEO_API_KEY', { retryable: false });
    if (res.status === 429) throw new EngineError('RATE_LIMIT', 'Pexels rate limit', { retryable: true });
    if (!res.ok) throw providerError(`Pexels request failed (${res.status})`);
    return (await res.json()) as T;
  }
}

let cached: StockProvider | null = null;

export function getStockProvider(): StockProvider {
  if (cached) return cached;
  cached = env.MOCK_MODE || env.STOCK_PROVIDER === 'mock' ? new MockStockProvider() : new PexelsProvider();
  return cached;
}

export function resetStockProvider(): void {
  cached = null;
}

export async function findStock(
  q: StockQuery,
  kind: 'video' | 'photo',
  ctx: { videoProjectId?: string | null } = {},
): Promise<VisualAsset[]> {
  const provider = getStockProvider();
  const assets = await withRetry(
    () =>
      withTimeout(
        kind === 'video' ? provider.searchVideos(q) : provider.searchPhotos(q),
        30_000,
        `stock:${provider.name}`,
      ),
    { attempts: 3, baseDelayMs: 800 },
  );

  const rate = pricing.stock[provider.name] ?? pricing.stock.default!;
  if (rate > 0) {
    await recordCost({
      videoProjectId: ctx.videoProjectId ?? null,
      category: 'STOCK',
      provider: provider.name,
      stage: 'VISUALS',
      usd: rate * assets.length,
      units: assets.length,
      unitLabel: 'assets',
      detail: { query: q.query, kind },
    });
  }

  return assets;
}
