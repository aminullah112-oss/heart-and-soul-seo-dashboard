import { env, pricing } from '@yme/config';
import { EngineError, providerError, withRetry, withTimeout } from '@yme/shared';
import { recordCost } from '@yme/database';
import type { VisualAsset } from './types.js';

export interface ImageGenRequest {
  prompt: string;
  width?: number;
  height?: number;
  /** Style suffix applied to every prompt so the channel stays visually coherent. */
  styleSuffix?: string;
}

export interface ImageProvider {
  readonly name: string;
  generate(req: ImageGenRequest): Promise<VisualAsset>;
}

/**
 * Offline image provider: returns no bytes. The render pipeline draws a typed
 * placeholder card in its place, which keeps the composition and timing real
 * while making it obvious at a glance that the visual is not final.
 */
class MockImageProvider implements ImageProvider {
  readonly name = 'mock';
  async generate(req: ImageGenRequest): Promise<VisualAsset> {
    return {
      provider: 'mock',
      sourceUrl: null,
      downloadUrl: null,
      mimeType: 'image/png',
      width: req.width ?? 1920,
      height: req.height ?? 1080,
      licence: 'MOCK — placeholder card rendered locally',
      licenceUrl: null,
      attributionRequired: false,
      attributionText: null,
      copyrightRisk: 'NONE',
    };
  }
}

class OpenAiImageProvider implements ImageProvider {
  readonly name = 'openai';

  async generate(req: ImageGenRequest): Promise<VisualAsset> {
    const size = pickSize(req.width ?? 1792, req.height ?? 1024);
    const res = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.IMAGE_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-image-1',
        prompt: req.styleSuffix ? `${req.prompt}. ${req.styleSuffix}` : req.prompt,
        size,
        n: 1,
      }),
    });

    if (res.status === 401) throw new EngineError('CONFIG', 'OpenAI rejected IMAGE_API_KEY', { retryable: false });
    if (res.status === 429) throw new EngineError('RATE_LIMIT', 'OpenAI image rate limit', { retryable: true });
    if (res.status === 400) {
      // Usually a content-policy rejection. Retrying an identical prompt just
      // spends money to get the same answer.
      throw new EngineError('VALIDATION', `OpenAI rejected the image prompt: ${await safeText(res)}`, {
        retryable: false,
      });
    }
    if (!res.ok) throw providerError(`OpenAI image generation failed (${res.status})`);

    const body = (await res.json()) as { data?: Array<{ b64_json?: string; url?: string }> };
    const first = body.data?.[0];
    if (!first) throw providerError('OpenAI returned no image data');

    const [w, h] = size.split('x').map(Number) as [number, number];
    return {
      provider: 'openai',
      sourceUrl: null,
      downloadUrl: first.url ?? null,
      data: first.b64_json ? Buffer.from(first.b64_json, 'base64') : undefined,
      mimeType: 'image/png',
      width: w,
      height: h,
      licence: 'Generated — see provider terms for commercial use',
      licenceUrl: null,
      attributionRequired: false,
      attributionText: null,
      // Generated imagery is not risk-free: a prompt naming a living person or
      // a trademarked design can still produce a problem. Flagged for the
      // copyright check rather than waved through.
      copyrightRisk: 'LOW',
    };
  }
}

function pickSize(w: number, h: number): string {
  const ratio = w / h;
  if (ratio > 1.3) return '1536x1024';
  if (ratio < 0.77) return '1024x1536';
  return '1024x1024';
}

async function safeText(res: Response): Promise<string> {
  try {
    return (await res.text()).slice(0, 300);
  } catch {
    return '(no body)';
  }
}

let cached: ImageProvider | null = null;

export function getImageProvider(): ImageProvider {
  if (cached) return cached;
  cached = env.MOCK_MODE || env.IMAGE_PROVIDER === 'mock' ? new MockImageProvider() : new OpenAiImageProvider();
  return cached;
}

export function resetImageProvider(): void {
  cached = null;
}

export async function generateImage(
  req: ImageGenRequest,
  ctx: { videoProjectId?: string | null } = {},
): Promise<VisualAsset> {
  const provider = getImageProvider();
  const asset = await withRetry(() => withTimeout(provider.generate(req), 120_000, `image:${provider.name}`), {
    attempts: 3,
    baseDelayMs: 2000,
  });

  const rate = pricing.image[provider.name] ?? pricing.image.default!;
  if (rate > 0) {
    await recordCost({
      videoProjectId: ctx.videoProjectId ?? null,
      category: 'IMAGE',
      provider: provider.name,
      stage: 'VISUALS',
      usd: rate,
      units: 1,
      unitLabel: 'images',
      detail: { prompt: req.prompt.slice(0, 300) },
    });
  }

  return asset;
}
