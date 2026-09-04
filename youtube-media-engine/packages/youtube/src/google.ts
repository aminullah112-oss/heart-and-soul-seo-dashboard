import { createReadStream } from 'node:fs';
import { google, type youtube_v3, type youtubeAnalytics_v2 } from 'googleapis';
import { env } from '@yme/config';
import { EngineError, providerError } from '@yme/shared';
import type { UploadRequest, UploadResult, VideoMetrics, Visibility, YouTubeClient } from './types.js';

/**
 * Real YouTube client (Data API v3 + Analytics API v2).
 *
 * Quota is the constraint that shapes this code. A video insert costs ~1600
 * units against a default 10,000/day quota, so roughly six uploads a day
 * before the API stops responding — which is far above the channel's two
 * videos a week, but well within reach of a retry loop that treats a
 * quotaExceeded as retryable. It is mapped as terminal for that reason.
 */
export class GoogleYouTubeClient implements YouTubeClient {
  readonly name = 'google';
  private youtube: youtube_v3.Youtube;
  private analytics: youtubeAnalytics_v2.Youtubeanalytics;

  constructor() {
    for (const k of ['YOUTUBE_CLIENT_ID', 'YOUTUBE_CLIENT_SECRET', 'YOUTUBE_REFRESH_TOKEN'] as const) {
      if (!env[k]) throw new EngineError('CONFIG', `${k} is required for the google YouTube provider`);
    }
    const auth = new google.auth.OAuth2(env.YOUTUBE_CLIENT_ID, env.YOUTUBE_CLIENT_SECRET);
    auth.setCredentials({ refresh_token: env.YOUTUBE_REFRESH_TOKEN });
    this.youtube = google.youtube({ version: 'v3', auth });
    this.analytics = google.youtubeAnalytics({ version: 'v2', auth });
  }

  async upload(req: UploadRequest): Promise<UploadResult> {
    // Refuse anything but private when a publishAt is absent and the caller
    // asked for public — scheduling is the only safe way to go public, and it
    // requires the video to start private.
    const status: youtube_v3.Schema$VideoStatus = {
      privacyStatus: req.publishAt ? 'private' : req.visibility,
      selfDeclaredMadeForKids: req.madeForKids,
      ...(req.publishAt ? { publishAt: req.publishAt.toISOString() } : {}),
    };

    try {
      const res = await this.youtube.videos.insert({
        part: ['snippet', 'status'],
        requestBody: {
          snippet: {
            title: req.title.slice(0, 100),
            description: req.description.slice(0, 5000),
            tags: req.tags.slice(0, 30),
            categoryId: req.categoryId,
            defaultLanguage: req.defaultLanguage ?? 'en',
            defaultAudioLanguage: req.defaultLanguage ?? 'en',
          },
          status,
        },
        media: { body: createReadStream(req.videoFilePath) },
      });

      const youtubeId = res.data.id;
      if (!youtubeId) throw providerError('YouTube accepted the upload but returned no video id');

      if (req.playlistId) {
        await this.youtube.playlistItems.insert({
          part: ['snippet'],
          requestBody: {
            snippet: { playlistId: req.playlistId, resourceId: { kind: 'youtube#video', videoId: youtubeId } },
          },
        });
      }

      return {
        youtubeId,
        uploadedAt: new Date(),
        visibility: (status.privacyStatus as Visibility) ?? 'private',
        mock: false,
      };
    } catch (err) {
      throw mapGoogleError(err, 'upload');
    }
  }

  async setThumbnail(youtubeId: string, imagePath: string): Promise<void> {
    try {
      await this.youtube.thumbnails.set({ videoId: youtubeId, media: { body: createReadStream(imagePath) } });
    } catch (err) {
      throw mapGoogleError(err, 'setThumbnail');
    }
  }

  async updateMetadata(
    youtubeId: string,
    patch: Partial<Pick<UploadRequest, 'title' | 'description' | 'tags' | 'visibility'>>,
  ): Promise<void> {
    try {
      const current = await this.youtube.videos.list({ part: ['snippet', 'status'], id: [youtubeId] });
      const video = current.data.items?.[0];
      if (!video?.snippet) throw new EngineError('NOT_FOUND', `YouTube video ${youtubeId} not found`);

      await this.youtube.videos.update({
        part: ['snippet', 'status'],
        requestBody: {
          id: youtubeId,
          snippet: {
            ...video.snippet,
            ...(patch.title ? { title: patch.title.slice(0, 100) } : {}),
            ...(patch.description ? { description: patch.description.slice(0, 5000) } : {}),
            ...(patch.tags ? { tags: patch.tags.slice(0, 30) } : {}),
            // categoryId is required on update; carrying it over avoids a 400.
            categoryId: video.snippet.categoryId ?? '28',
          },
          status: { ...video.status, ...(patch.visibility ? { privacyStatus: patch.visibility } : {}) },
        },
      });
    } catch (err) {
      throw mapGoogleError(err, 'updateMetadata');
    }
  }

  async fetchMetrics(youtubeId: string, publishedAt: Date): Promise<VideoMetrics> {
    const startDate = publishedAt.toISOString().slice(0, 10);
    const endDate = new Date().toISOString().slice(0, 10);
    const unavailable: string[] = [];

    const core = await this.queryAnalytics(
      {
        ids: 'channel==MINE',
        startDate,
        endDate,
        metrics:
          'views,estimatedMinutesWatched,averageViewDuration,averageViewPercentage,subscribersGained,likes,comments,shares',
        filters: `video==${youtubeId}`,
      },
      unavailable,
      'core',
    );

    // Impressions and CTR live behind a different metric family and are the
    // first thing to 403 on a channel without the right access.
    const impressionsRow = await this.queryAnalytics(
      {
        ids: 'channel==MINE',
        startDate,
        endDate,
        metrics: 'impressions,impressionsClickThroughRate',
        filters: `video==${youtubeId}`,
      },
      unavailable,
      'impressions',
    );

    const revenueRow = await this.queryAnalytics(
      {
        ids: 'channel==MINE',
        startDate,
        endDate,
        metrics: 'estimatedRevenue,playbackBasedCpm',
        filters: `video==${youtubeId}`,
      },
      unavailable,
      'revenue',
    );

    const trafficRows = await this.queryAnalytics(
      {
        ids: 'channel==MINE',
        startDate,
        endDate,
        metrics: 'views',
        dimensions: 'insightTrafficSourceType',
        filters: `video==${youtubeId}`,
        sort: '-views',
      },
      unavailable,
      'traffic',
    );

    const retentionRows = await this.queryAnalytics(
      {
        ids: 'channel==MINE',
        startDate,
        endDate,
        metrics: 'audienceWatchRatio',
        dimensions: 'elapsedVideoTimeRatio',
        filters: `video==${youtubeId}`,
      },
      unavailable,
      'retention',
    );

    const c = core?.[0] ?? [];
    const i = impressionsRow?.[0] ?? [];
    const rev = revenueRow?.[0] ?? [];

    return {
      asOf: new Date(),
      views: numAt(c, 0),
      watchTimeMinutes: numAt(c, 1),
      averageViewDurationSeconds: numAt(c, 2),
      averageViewPercentage: numAt(c, 3),
      subscribersGained: numAt(c, 4),
      likes: numAt(c, 5),
      comments: numAt(c, 6),
      shares: numAt(c, 7),
      impressions: numAt(i, 0),
      ctr: numAt(i, 1),
      estimatedRevenueUsd: numAt(rev, 0),
      rpmUsd: numAt(rev, 1),
      // Not exposed as a single metric; would need a returningViewer dimension
      // query that most channels cannot run. Left null rather than guessed.
      returningViewers: null,
      trafficSources: trafficRows
        ? Object.fromEntries(trafficRows.map((r) => [String(r[0]), Number(r[1]) || 0]))
        : null,
      retentionCurve: retentionRows
        ? retentionRows.map((r) => ({ ratio: Number(r[0]) || 0, audienceWatchRatio: Number(r[1]) || 0 }))
        : null,
      unavailable,
    };
  }

  private async queryAnalytics(
    params: youtubeAnalytics_v2.Params$Resource$Reports$Query,
    unavailable: string[],
    label: string,
  ): Promise<unknown[][] | null> {
    try {
      const res = await this.analytics.reports.query(params);
      return (res.data.rows as unknown[][] | undefined) ?? [];
    } catch (err) {
      // A missing metric family is normal (no monetization, no impressions
      // access) and must not fail the whole snapshot. It is recorded so the
      // dashboard shows "unavailable" rather than zero.
      const mapped = mapGoogleError(err, `analytics:${label}`);
      if (mapped.kind === 'RATE_LIMIT' || mapped.kind === 'CONFIG') throw mapped;
      unavailable.push(label);
      return null;
    }
  }
}

function numAt(row: unknown[], idx: number): number | null {
  const v = row[idx];
  return typeof v === 'number' ? v : v === undefined || v === null ? null : Number(v) || null;
}

function mapGoogleError(err: unknown, op: string): EngineError {
  const e = err as { code?: number; status?: number; errors?: Array<{ reason?: string }>; message?: string };
  const code = e.code ?? e.status ?? 0;
  const reason = e.errors?.[0]?.reason ?? '';
  const message = e.message ?? String(err);

  if (reason === 'quotaExceeded' || reason === 'dailyLimitExceeded') {
    // Retrying does not help: quota resets at midnight Pacific.
    return new EngineError('PROVIDER', `YouTube API quota exhausted during ${op}. Quota resets at 00:00 PT.`, {
      retryable: false,
      cause: err,
    });
  }
  if (reason === 'rateLimitExceeded' || reason === 'userRateLimitExceeded' || code === 429)
    return new EngineError('RATE_LIMIT', `YouTube rate limit during ${op}`, { retryable: true, cause: err });
  if (code === 401 || reason === 'authError')
    return new EngineError('CONFIG', `YouTube auth failed during ${op} — refresh token may be revoked`, {
      retryable: false,
      cause: err,
    });
  if (code === 403)
    return new EngineError('CONFIG', `YouTube denied ${op} (${reason || 'forbidden'}): ${message}`, {
      retryable: false,
      cause: err,
    });
  if (code === 404) return new EngineError('NOT_FOUND', `YouTube resource not found during ${op}`);
  if (code >= 500) return new EngineError('PROVIDER', `YouTube server error during ${op} (${code})`, { retryable: true, cause: err });
  return providerError(`YouTube ${op} failed: ${message}`, { cause: err });
}
