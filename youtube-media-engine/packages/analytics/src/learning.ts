import { generateStructured, type CostTracker } from '@yme/ai';
import { prisma } from '@yme/database';
import { LearningReportSchema, jobLogger } from '@yme/shared';
import { LEARNING_SYSTEM } from './prompts.js';
import { findDropOffs, median, retentionAt, type RetentionPoint } from './stats.js';

/**
 * Performance learning (spec §30).
 *
 * The guard that matters: below MIN_VIDEOS_FOR_FINDINGS, every observation is
 * filed as provisional regardless of how convincing it looks, and the report
 * says so in its summary. A channel with six videos cannot distinguish "company
 * teardowns outperform industry overviews" from "the third video happened to
 * get picked up by the algorithm".
 */
export const MIN_VIDEOS_FOR_FINDINGS = 20;
export const MIN_VIDEOS_PER_GROUP = 8;

export interface LearningResult {
  reportId: string;
  videosAnalysed: number;
  findings: number;
  provisional: number;
  underpowered: boolean;
}

export async function buildLearningReport(opts: {
  channelId: string;
  periodStart: Date;
  periodEnd: Date;
  tracker?: CostTracker;
  jobId?: string;
}): Promise<LearningResult> {
  const log = jobLogger({ jobId: opts.jobId, stage: 'PUBLISHED' });

  const videos = await prisma.youTubeVideo.findMany({
    where: { videoProject: { channelId: opts.channelId }, publishedAt: { not: null } },
    include: {
      videoProject: {
        include: {
          topic: true,
          scripts: { where: { isCurrent: true }, take: 1 },
          qcReport: true,
          titleVariants: { where: { isSelected: true }, take: 1 },
        },
      },
      // Latest snapshot per video is the one that matters for a period report.
      snapshots: { orderBy: { asOf: 'desc' }, take: 1 },
    },
  });

  const rows = videos
    .map((v) => {
      const snap = v.snapshots[0];
      const script = v.videoProject.scripts[0];
      if (!snap) return null;
      const curve = (snap.retentionCurve as RetentionPoint[] | null) ?? [];
      const duration = script?.estimatedSeconds ?? 0;
      return {
        title: v.title,
        pillar: v.videoProject.topic.pillar,
        publishedAt: v.publishedAt,
        durationMinutes: duration > 0 ? Math.round(duration / 60) : null,
        views: snap.views,
        ctr: snap.ctr,
        avgViewPct: snap.averageViewPercentage,
        subs: snap.subscribersGained,
        retention30s: duration > 0 ? retentionAt(curve, 30, duration) : null,
        dropOffs: duration > 0 ? findDropOffs(curve, duration).slice(0, 3) : [],
        qcScore: v.videoProject.qcReport?.finalScore ?? null,
        retentionScore: script?.retentionScore ?? null,
        titleRubric: v.videoProject.titleVariants[0]?.rubricScore ?? null,
      };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null);

  const underpowered = rows.length < MIN_VIDEOS_FOR_FINDINGS;

  // Rubric calibration: the whole point of the packaging scores is that they
  // should eventually be checked against reality. This is where that happens.
  const calibration = calibrateRubric(rows);

  const { value } = await generateStructured({
    task: 'learning-report',
    schema: LearningReportSchema,
    system: LEARNING_SYSTEM,
    prompt: [
      `Analyse ${rows.length} published videos for the period ` +
        `${opts.periodStart.toISOString().slice(0, 10)} to ${opts.periodEnd.toISOString().slice(0, 10)}.`,
      '',
      underpowered
        ? `THIS CHANNEL HAS ONLY ${rows.length} VIDEOS WITH ANALYTICS. That is below the ` +
          `${MIN_VIDEOS_FOR_FINDINGS} needed to separate a pattern from noise. Put EVERY observation ` +
          'under "provisional" and return an empty "findings" array. Say plainly in the summary that ' +
          'nothing should change production yet.'
        : `Any grouped comparison needs at least ${MIN_VIDEOS_PER_GROUP} videos per group. Anything ` +
          'thinner goes under "provisional".',
      '',
      'DATA:',
      JSON.stringify(rows, null, 1).slice(0, 20_000),
      '',
      'RUBRIC CALIBRATION (do the packaging scores predict anything?):',
      JSON.stringify(calibration, null, 1),
      '',
      'Return: {"summary","findings":[{"pattern","evidence","sampleSize","recommendation"}],',
      '"provisional":[{"pattern","sampleSize","whyUnderpowered"}]}',
    ].join('\n'),
    maxTokens: 4000,
    temperature: 0.3,
    tracker: opts.tracker,
    ctx: { stage: 'PUBLISHED', jobId: opts.jobId },
    mockContext: { videosAnalysed: rows.length },
  });

  // Enforced in code, not left to the prompt: findings are discarded below the
  // threshold no matter what the model returned.
  const findings = underpowered ? [] : value.findings.filter((f) => f.sampleSize >= MIN_VIDEOS_PER_GROUP);
  const demoted = underpowered
    ? value.findings.map((f) => ({
        pattern: f.pattern,
        sampleSize: f.sampleSize,
        whyUnderpowered: `Only ${rows.length} videos have analytics; ${MIN_VIDEOS_FOR_FINDINGS} needed.`,
      }))
    : value.findings
        .filter((f) => f.sampleSize < MIN_VIDEOS_PER_GROUP)
        .map((f) => ({
          pattern: f.pattern,
          sampleSize: f.sampleSize,
          whyUnderpowered: `Group has ${f.sampleSize} videos; ${MIN_VIDEOS_PER_GROUP} needed.`,
        }));

  const provisional = [...value.provisional, ...demoted];

  const report = await prisma.performanceReport.upsert({
    where: {
      channelId_periodStart_periodEnd: {
        channelId: opts.channelId,
        periodStart: opts.periodStart,
        periodEnd: opts.periodEnd,
      },
    },
    update: {
      findings: findings as unknown as object,
      provisional: provisional as unknown as object,
      videosAnalysed: rows.length,
      summary: value.summary,
    },
    create: {
      channelId: opts.channelId,
      periodStart: opts.periodStart,
      periodEnd: opts.periodEnd,
      findings: findings as unknown as object,
      provisional: provisional as unknown as object,
      videosAnalysed: rows.length,
      summary: value.summary,
    },
  });

  log.info({ videos: rows.length, findings: findings.length, underpowered }, 'learning report built');
  return {
    reportId: report.id,
    videosAnalysed: rows.length,
    findings: findings.length,
    provisional: provisional.length,
    underpowered,
  };
}

/**
 * Compares the rubric scores assigned before publishing against what actually
 * happened. Reported as a rank comparison, not a correlation coefficient — with
 * a handful of videos, r is unstable enough to be actively misleading.
 */
export function calibrateRubric(
  rows: Array<{ titleRubric: number | null; ctr: number | null; retentionScore: number | null; avgViewPct: number | null }>,
): Record<string, unknown> {
  const titlePairs = rows.filter((r) => r.titleRubric !== null && r.ctr !== null);
  const retentionPairs = rows.filter((r) => r.retentionScore !== null && r.avgViewPct !== null);

  const summarise = (
    pairs: Array<{ predicted: number; actual: number }>,
    label: string,
  ): Record<string, unknown> => {
    if (pairs.length < MIN_VIDEOS_PER_GROUP) {
      return { label, usable: false, n: pairs.length, note: `Need ${MIN_VIDEOS_PER_GROUP}+ pairs to say anything.` };
    }
    const medianPredicted = median(pairs.map((p) => p.predicted))!;
    const high = pairs.filter((p) => p.predicted >= medianPredicted).map((p) => p.actual);
    const low = pairs.filter((p) => p.predicted < medianPredicted).map((p) => p.actual);
    return {
      label,
      usable: true,
      n: pairs.length,
      medianActualForHighScores: median(high),
      medianActualForLowScores: median(low),
      note: 'If these two medians are close, the rubric is not predicting anything and should be retired or retuned.',
    };
  };

  return {
    titleRubricVsCtr: summarise(
      titlePairs.map((r) => ({ predicted: r.titleRubric!, actual: r.ctr! })),
      'title rubric vs observed CTR',
    ),
    retentionScoreVsAvgViewPct: summarise(
      retentionPairs.map((r) => ({ predicted: r.retentionScore!, actual: r.avgViewPct! })),
      'pre-publish retention score vs observed average view percentage',
    ),
  };
}
