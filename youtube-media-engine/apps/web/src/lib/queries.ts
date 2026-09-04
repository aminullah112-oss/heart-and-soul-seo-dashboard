import 'server-only';
import { prisma, channelCostSummary, type CostSummary } from '@yme/database';

/**
 * Read models for the dashboard.
 *
 * Kept out of the page components so each page issues a known, bounded set of
 * queries. A dashboard that lazily walks Prisma relations inside JSX is how
 * you end up with 400 queries behind one page load.
 */

export async function getChannel() {
  return prisma.channel.findFirst();
}

export async function getDashboardSummary(channelId: string): Promise<{
  inProduction: number;
  awaitingApproval: number;
  scheduled: number;
  published: number;
  blocked: number;
  recentJobs: Array<{
    id: string;
    stage: string;
    status: string;
    jobName: string;
    durationMs: number | null;
    error: string | null;
    errorKind: string | null;
    createdAt: Date;
    videoProjectId: string | null;
  }>;
  costs: CostSummary;
  failedJobs: number;
}> {
  const since = new Date(Date.now() - 30 * 86_400_000);

  const [inProduction, awaitingApproval, scheduled, published, blocked, recentJobs, costs, failedJobs] =
    await Promise.all([
      prisma.videoProject.count({
        where: { channelId, status: 'ACTIVE', stage: { notIn: ['APPROVAL', 'SCHEDULED', 'PUBLISHED'] } },
      }),
      prisma.videoProject.count({ where: { channelId, stage: 'APPROVAL', status: 'ACTIVE' } }),
      prisma.videoProject.count({ where: { channelId, stage: 'SCHEDULED' } }),
      prisma.videoProject.count({ where: { channelId, stage: 'PUBLISHED' } }),
      prisma.videoProject.count({ where: { channelId, status: { in: ['BLOCKED', 'FAILED'] } } }),
      prisma.automationJob.findMany({
        orderBy: { createdAt: 'desc' },
        take: 12,
        select: {
          id: true, stage: true, status: true, jobName: true, durationMs: true,
          error: true, errorKind: true, createdAt: true, videoProjectId: true,
        },
      }),
      channelCostSummary(since),
      prisma.automationJob.count({ where: { status: 'FAILED', createdAt: { gte: since } } }),
    ]);

  return { inProduction, awaitingApproval, scheduled, published, blocked, recentJobs, costs, failedJobs };
}

export async function getRecentPerformance(channelId: string) {
  const videos = await prisma.youTubeVideo.findMany({
    where: { videoProject: { channelId } },
    orderBy: { publishedAt: 'desc' },
    take: 8,
    include: {
      snapshots: { orderBy: { asOf: 'desc' }, take: 1 },
      videoProject: { select: { id: true, slug: true } },
    },
  });

  return videos.map((v) => {
    const s = v.snapshots[0];
    return {
      id: v.id,
      projectId: v.videoProject.id,
      title: v.title,
      youtubeId: v.youtubeId,
      publishedAt: v.publishedAt,
      visibility: v.visibility,
      views: s?.views ?? null,
      ctr: s?.ctr ?? null,
      avgViewPct: s?.averageViewPercentage ?? null,
      subs: s?.subscribersGained ?? null,
      revenueUsd: s?.estimatedRevenueUsd ?? null,
    };
  });
}

export async function getTopicRadar(channelId: string) {
  return prisma.topic.findMany({
    where: { channelId, status: { in: ['DISCOVERED', 'SCORED', 'APPROVED', 'REJECTED_BY_SCORE'] } },
    orderBy: [{ latestScore: 'desc' }, { createdAt: 'desc' }],
    take: 60,
    include: {
      scores: { orderBy: { createdAt: 'desc' }, take: 1 },
      videoProject: { select: { id: true } },
    },
  });
}

export async function getProductionQueue(channelId: string) {
  return prisma.videoProject.findMany({
    where: { channelId, stage: { notIn: ['PUBLISHED'] } },
    orderBy: { updatedAt: 'desc' },
    take: 60,
    include: {
      topic: { select: { title: true, pillar: true } },
      qcReport: { select: { finalScore: true, passed: true } },
      automationJobs: { orderBy: { createdAt: 'desc' }, take: 1, select: { status: true, error: true, stage: true } },
      costRecords: { select: { usd: true } },
    },
  });
}

export async function getVideoReview(projectId: string) {
  return prisma.videoProject.findUnique({
    where: { id: projectId },
    include: {
      channel: true,
      topic: { include: { scores: { orderBy: { createdAt: 'desc' }, take: 1 } } },
      storyBrief: true,
      scripts: { where: { isCurrent: true }, take: 1 },
      scenes: { orderBy: { index: 'asc' }, include: { asset: true, voiceover: true } },
      research: {
        include: {
          sources: { orderBy: { reliability: 'desc' } },
          claims: { include: { sourceLinks: { include: { source: true } } } },
        },
      },
      factCheck: true,
      qcReport: true,
      titleVariants: { orderBy: { rubricScore: 'desc' } },
      thumbnails: { orderBy: { rubricScore: 'desc' } },
      description: true,
      shorts: { include: { render: true } },
      renders: { orderBy: { createdAt: 'desc' } },
      duplicateFlags: { where: { resolvedAt: null } },
      approvalEvents: { orderBy: { createdAt: 'desc' }, include: { user: { select: { email: true } } } },
      publishingJobs: { orderBy: { createdAt: 'desc' } },
      youtubeVideo: { include: { snapshots: { orderBy: { asOf: 'desc' }, take: 30 } } },
      costRecords: { orderBy: { createdAt: 'asc' } },
      assets: true,
    },
  });
}

export async function getSystemHealth(): Promise<{
  jobsByStatus: Array<{ status: string; _count: { _all: number } }>;
  recentErrors: Array<{
    id: string;
    level: string;
    source: string;
    message: string;
    stage: string | null;
    createdAt: Date;
  }>;
  stuckProjects: Array<{ id: string; slug: string; stage: string; updatedAt: Date }>;
  costToday: CostSummary;
  oldestQueued: { createdAt: Date; stage: string } | null;
}> {
  const since = new Date(Date.now() - 24 * 3600 * 1000);

  const [jobsByStatus, recentErrors, stuckProjects, costToday, oldestQueued] = await Promise.all([
    prisma.automationJob.groupBy({ by: ['status'], _count: { _all: true }, where: { createdAt: { gte: since } } }),
    prisma.systemLog.findMany({
      where: { level: { in: ['ERROR', 'FATAL'] }, createdAt: { gte: since } },
      orderBy: { createdAt: 'desc' },
      take: 20,
    }),
    // "Stuck" is a project that is ACTIVE but has not moved in over six hours —
    // usually a crashed worker rather than slow work.
    prisma.videoProject.findMany({
      where: { status: 'ACTIVE', stage: { notIn: ['APPROVAL', 'SCHEDULED', 'PUBLISHED'] }, updatedAt: { lt: new Date(Date.now() - 6 * 3600 * 1000) } },
      select: { id: true, slug: true, stage: true, updatedAt: true },
      take: 20,
    }),
    channelCostSummary(since),
    prisma.automationJob.findFirst({ where: { status: 'QUEUED' }, orderBy: { createdAt: 'asc' }, select: { createdAt: true, stage: true } }),
  ]);

  return { jobsByStatus, recentErrors, stuckProjects, costToday, oldestQueued };
}

export async function getSponsors(channelId: string) {
  return prisma.sponsor.findMany({ where: { channelId }, orderBy: [{ status: 'asc' }, { fitScore: 'desc' }] });
}

export async function getLatestLearningReport(channelId: string) {
  return prisma.performanceReport.findFirst({ where: { channelId }, orderBy: { periodEnd: 'desc' } });
}
