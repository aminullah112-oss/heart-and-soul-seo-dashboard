import fs from 'node:fs/promises';
import { stableId } from '@yme/shared';
import type { UploadRequest, UploadResult, VideoMetrics, YouTubeClient } from './types.js';

/**
 * Offline YouTube client.
 *
 * It makes no network calls at all — that is the safety property. Even with a
 * valid refresh token in .env, MOCK_MODE cannot publish, because this class has
 * no code path that reaches Google. It still verifies the render file exists,
 * so a missing artefact fails here rather than at the real upload.
 */
export class MockYouTubeClient implements YouTubeClient {
  readonly name = 'mock';
  private readonly uploads = new Map<string, UploadRequest>();

  async upload(req: UploadRequest): Promise<UploadResult> {
    const stat = await fs.stat(req.videoFilePath).catch(() => null);
    if (!stat || stat.size === 0) {
      throw new Error(`Render file is missing or empty: ${req.videoFilePath}`);
    }
    const youtubeId = `mock-${stableId(req.title, String(stat.size)).slice(0, 11)}`;
    this.uploads.set(youtubeId, req);
    return { youtubeId, uploadedAt: new Date(), visibility: req.visibility, mock: true };
  }

  async setThumbnail(youtubeId: string, imagePath: string): Promise<void> {
    const stat = await fs.stat(imagePath).catch(() => null);
    if (!stat) throw new Error(`Thumbnail file is missing: ${imagePath}`);
    // YouTube's own limit; enforcing it in mock catches the failure before spend.
    if (stat.size > 2 * 1024 * 1024) {
      throw new Error(`Thumbnail exceeds YouTube's 2MB limit (${stat.size} bytes): ${imagePath}`);
    }
  }

  async updateMetadata(): Promise<void> {
    /* no-op */
  }

  async fetchMetrics(youtubeId: string, publishedAt: Date): Promise<VideoMetrics> {
    // Deterministic, plausible-shaped numbers that decay with age, so the
    // learning loop and the dashboard have realistic series to work against.
    const days = Math.max(1, Math.floor((Date.now() - publishedAt.getTime()) / 86_400_000));
    const seed = parseInt(stableId(youtubeId).slice(0, 6), 16);
    const r = (salt: number, lo: number, hi: number) => lo + ((seed * (salt + 7)) % 1000) / 1000 * (hi - lo);

    const impressions = Math.round(r(1, 8_000, 60_000) * Math.log10(days + 9));
    const ctr = Math.round(r(2, 3.2, 9.4) * 100) / 100;
    const views = Math.round(impressions * (ctr / 100));
    const avgPct = Math.round(r(3, 28, 52) * 100) / 100;
    const durationSeconds = 11 * 60;
    const avgDuration = Math.round(durationSeconds * (avgPct / 100));

    return {
      asOf: new Date(),
      impressions,
      ctr,
      views,
      averageViewDurationSeconds: avgDuration,
      averageViewPercentage: avgPct,
      watchTimeMinutes: Math.round((views * avgDuration) / 60),
      subscribersGained: Math.round(views * r(4, 0.004, 0.02)),
      likes: Math.round(views * r(5, 0.02, 0.06)),
      comments: Math.round(views * r(6, 0.001, 0.006)),
      shares: Math.round(views * r(7, 0.002, 0.01)),
      returningViewers: Math.round(views * r(8, 0.1, 0.4)),
      estimatedRevenueUsd: Math.round(views * r(9, 0.004, 0.018) * 100) / 100,
      rpmUsd: Math.round(r(10, 4, 18) * 100) / 100,
      trafficSources: {
        BROWSE_FEATURES: Math.round(views * 0.42),
        YT_SEARCH: Math.round(views * 0.24),
        SUGGESTED_VIDEO: Math.round(views * 0.21),
        EXTERNAL: Math.round(views * 0.08),
        NOTIFICATION: Math.round(views * 0.05),
      },
      retentionCurve: buildCurve(),
      unavailable: [],
    };
  }
}

function buildCurve(): Array<{ ratio: number; audienceWatchRatio: number }> {
  const out: Array<{ ratio: number; audienceWatchRatio: number }> = [];
  for (let i = 0; i <= 20; i++) {
    const ratio = i / 20;
    // Steep early drop then a slow decline — the usual shape, so retention
    // analysis code is exercised against something realistic.
    const value = ratio === 0 ? 1 : Math.max(0.18, 1.02 * Math.exp(-2.1 * ratio) + 0.16);
    out.push({ ratio: Math.round(ratio * 100) / 100, audienceWatchRatio: Math.round(value * 1000) / 1000 });
  }
  return out;
}
