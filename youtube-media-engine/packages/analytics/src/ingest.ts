import { prisma } from '@yme/database';
import { getYouTubeClient } from '@yme/youtube';
import { jobLogger } from '@yme/shared';

/**
 * Analytics ingestion (spec §29).
 *
 * One snapshot per video per day, keyed on the day the metrics DESCRIBE rather
 * than the day they were fetched. YouTube revises figures for up to about
 * 72 hours after the fact, so a re-fetch has to overwrite the existing row for
 * that date instead of appending a second one — otherwise every "views on day
 * 2" query silently double-counts.
 */
export async function ingestVideoMetrics(opts: { youtubeVideoId: string; jobId?: string }): Promise<{
  snapshotId: string;
  unavailable: string[];
}> {
  const log = jobLogger({ jobId: opts.jobId, stage: 'PUBLISHED' });

  const video = await prisma.youTubeVideo.findUnique({ where: { id: opts.youtubeVideoId } });
  if (!video) throw new Error(`YouTubeVideo ${opts.youtubeVideoId} not found`);
  if (!video.publishedAt) {
    throw new Error(`YouTubeVideo ${video.youtubeId} has no publishedAt; nothing to measure yet`);
  }

  const client = getYouTubeClient();
  const metrics = await client.fetchMetrics(video.youtubeId, video.publishedAt);

  const asOf = startOfUtcDay(metrics.asOf);
  const daysSincePublish = Math.max(
    0,
    Math.floor((asOf.getTime() - startOfUtcDay(video.publishedAt).getTime()) / 86_400_000),
  );

  const snapshot = await prisma.analyticsSnapshot.upsert({
    where: { youtubeVideoId_asOf: { youtubeVideoId: video.id, asOf } },
    update: {
      impressions: metrics.impressions,
      ctr: metrics.ctr,
      views: metrics.views,
      averageViewDurationSeconds: metrics.averageViewDurationSeconds,
      averageViewPercentage: metrics.averageViewPercentage,
      watchTimeMinutes: metrics.watchTimeMinutes,
      subscribersGained: metrics.subscribersGained,
      likes: metrics.likes,
      comments: metrics.comments,
      shares: metrics.shares,
      returningViewers: metrics.returningViewers,
      estimatedRevenueUsd: metrics.estimatedRevenueUsd,
      rpmUsd: metrics.rpmUsd,
      trafficSources: (metrics.trafficSources ?? undefined) as never,
      retentionCurve: (metrics.retentionCurve ?? undefined) as never,
    },
    create: {
      youtubeVideoId: video.id,
      asOf,
      daysSincePublish,
      impressions: metrics.impressions,
      ctr: metrics.ctr,
      views: metrics.views,
      averageViewDurationSeconds: metrics.averageViewDurationSeconds,
      averageViewPercentage: metrics.averageViewPercentage,
      watchTimeMinutes: metrics.watchTimeMinutes,
      subscribersGained: metrics.subscribersGained,
      likes: metrics.likes,
      comments: metrics.comments,
      shares: metrics.shares,
      returningViewers: metrics.returningViewers,
      estimatedRevenueUsd: metrics.estimatedRevenueUsd,
      rpmUsd: metrics.rpmUsd,
      trafficSources: (metrics.trafficSources ?? undefined) as never,
      retentionCurve: (metrics.retentionCurve ?? undefined) as never,
    },
  });

  if (metrics.unavailable.length) {
    log.warn({ youtubeId: video.youtubeId, unavailable: metrics.unavailable }, 'some metric families unavailable');
  }

  return { snapshotId: snapshot.id, unavailable: metrics.unavailable };
}

export async function ingestAllPublished(opts: { channelId: string; jobId?: string }): Promise<number> {
  const videos = await prisma.youTubeVideo.findMany({
    where: { videoProject: { channelId: opts.channelId }, publishedAt: { not: null } },
    select: { id: true },
  });

  let ok = 0;
  for (const v of videos) {
    try {
      await ingestVideoMetrics({ youtubeVideoId: v.id, jobId: opts.jobId });
      ok++;
    } catch (err) {
      // One video's analytics failing must not abort the whole daily sweep.
      jobLogger({ jobId: opts.jobId }).warn({ id: v.id, err: String(err) }, 'metrics ingest failed for video');
    }
  }
  return ok;
}

function startOfUtcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}
