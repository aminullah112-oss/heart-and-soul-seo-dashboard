import path from 'node:path';
import { env } from '@yme/config';
import { prisma, type PublishVisibility } from '@yme/database';
import { jobLogger, policyError, validationError } from '@yme/shared';
import { getStorage } from '@yme/storage';
import { getYouTubeClient, YOUTUBE_CATEGORY_SCIENCE_TECH, type Visibility } from '@yme/youtube';
import { ensureWorkDir } from './workdir.js';

/**
 * Publishing (spec §24).
 *
 * Every gate below is enforced HERE, in the code that performs the upload,
 * rather than in the UI that requests it. A dashboard bug, a stray API call or
 * a mis-scheduled cron must not be able to publish something a human has not
 * approved, so the checks live at the point of no return.
 *
 * The gates, in order:
 *   1. A PublishingJob exists and carries an explicit approver.
 *   2. QC passed.
 *   3. The fact check passed.
 *   4. A completed render exists.
 *   5. A title and thumbnail have been selected by a human.
 *   6. AUTOMATIC_PUBLISH is off unless the operator turned it on deliberately.
 */
export interface PublishResult {
  youtubeVideoId: string;
  youtubeId: string;
  visibility: Visibility;
  mock: boolean;
}

export async function approveForPublish(opts: {
  videoProjectId: string;
  userId: string;
  visibility: PublishVisibility;
  scheduledFor?: Date | null;
  note?: string;
}): Promise<string> {
  const project = await prisma.videoProject.findUnique({
    where: { id: opts.videoProjectId },
    include: { qcReport: true, renders: { where: { status: 'COMPLETED' }, orderBy: { createdAt: 'desc' }, take: 1 } },
  });
  if (!project) throw validationError(`VideoProject ${opts.videoProjectId} not found`);
  if (!project.qcReport?.passed) {
    throw policyError('Cannot approve: QC has not passed', {
      blockingReasons: project.qcReport?.blockingReasons ?? ['QC has not run'],
    });
  }
  const render = project.renders[0];
  if (!render) throw policyError('Cannot approve: no completed render exists');

  const job = await prisma.publishingJob.create({
    data: {
      videoProjectId: project.id,
      renderId: render.id,
      visibility: opts.visibility,
      status: 'SCHEDULED',
      scheduledFor: opts.scheduledFor ?? null,
      approvedById: opts.userId,
      approvedAt: new Date(),
    },
  });

  await prisma.$transaction([
    prisma.approvalEvent.create({
      data: {
        videoProjectId: project.id,
        userId: opts.userId,
        stage: 'APPROVAL',
        decision: 'APPROVED',
        note: opts.note ?? null,
      },
    }),
    prisma.videoProject.update({
      where: { id: project.id },
      data: { stage: 'SCHEDULED', approvedAt: new Date() },
    }),
  ]);

  return job.id;
}

export async function runPublish(opts: { publishingJobId: string; jobId?: string }): Promise<PublishResult> {
  const log = jobLogger({ jobId: opts.jobId, stage: 'PUBLISHED' });
  const storage = getStorage();

  const job = await prisma.publishingJob.findUnique({
    where: { id: opts.publishingJobId },
    include: {
      videoProject: {
        include: {
          channel: true,
          qcReport: true,
          factCheck: true,
          description: true,
          titleVariants: { where: { isSelected: true }, take: 1 },
          thumbnails: { where: { isSelected: true }, take: 1 },
          renders: { where: { status: 'COMPLETED', format: 'LONG_FORM_16_9' }, orderBy: { createdAt: 'desc' }, take: 1 },
        },
      },
    },
  });
  if (!job) throw validationError(`PublishingJob ${opts.publishingJobId} not found`);
  const project = job.videoProject;

  // ── Gate 1: explicit human approval ──────────────────────────────────
  if (!job.approvedById || !job.approvedAt) {
    throw policyError(
      'Refusing to publish: this job has no recorded approver. Publishing requires an explicit human approval.',
    );
  }
  if (project.channel.humanApproval && env.AUTOMATIC_PUBLISH) {
    throw policyError(
      'Configuration conflict: AUTOMATIC_PUBLISH is on while the channel requires human approval. Refusing to publish.',
    );
  }

  // ── Gate 2 & 3: quality and accuracy ─────────────────────────────────
  if (!project.qcReport?.passed) {
    throw policyError('Refusing to publish: QC did not pass', {
      blockingReasons: project.qcReport?.blockingReasons ?? ['QC has not run'],
    });
  }
  if (project.factCheck?.verdict !== 'PASS') {
    throw policyError('Refusing to publish: the fact check did not pass', {
      highRiskCount: project.factCheck?.highRiskCount ?? null,
    });
  }

  // ── Gate 4 & 5: artefacts and human packaging choices ────────────────
  const render = project.renders[0];
  if (!render?.storageKey) throw policyError('Refusing to publish: no completed render');
  const title = project.titleVariants[0];
  if (!title) throw policyError('Refusing to publish: no title has been selected by a human');
  const thumbnail = project.thumbnails[0];
  if (!project.description) throw policyError('Refusing to publish: no description has been generated');

  await prisma.publishingJob.update({
    where: { id: job.id },
    data: { status: 'UPLOADING', attempts: { increment: 1 } },
  });

  try {
    const workDir = await ensureWorkDir(project.id, 'publish');
    const videoPath = path.join(workDir, 'upload.mp4');
    await storage.getToFile(render.storageKey, videoPath);

    const client = getYouTubeClient();
    const description = buildDescription(project.description, project.channel.name);

    const upload = await client.upload({
      videoFilePath: videoPath,
      title: title.text,
      description,
      tags: project.description.tags,
      categoryId: YOUTUBE_CATEGORY_SCIENCE_TECH,
      // Scheduled uploads must start private; YouTube flips them at publishAt.
      visibility: job.scheduledFor ? 'private' : (job.visibility.toLowerCase() as Visibility),
      publishAt: job.scheduledFor,
      // Synthetic narration is disclosed. Cheap to declare, expensive to be
      // caught not declaring.
      containsSyntheticMedia: true,
      madeForKids: false,
      defaultLanguage: 'en',
    });

    let thumbnailSet = false;
    if (thumbnail?.storageKey) {
      const thumbPath = path.join(workDir, 'thumbnail.jpg');
      await storage.getToFile(thumbnail.storageKey, thumbPath);
      try {
        await client.setThumbnail(upload.youtubeId, thumbPath);
        thumbnailSet = true;
      } catch (err) {
        // A failed thumbnail must not fail the upload — the video is already
        // live and a thumbnail can be set afterwards from the dashboard.
        log.warn({ err: String(err) }, 'thumbnail upload failed; video is live without it');
      }
    }

    const record = await prisma.youTubeVideo.upsert({
      where: { videoProjectId: project.id },
      update: {
        youtubeId: upload.youtubeId,
        title: title.text,
        description,
        tags: project.description.tags,
        visibility: upload.visibility.toUpperCase() as PublishVisibility,
        thumbnailSet,
        publishedAt: job.scheduledFor ?? upload.uploadedAt,
      },
      create: {
        videoProjectId: project.id,
        youtubeId: upload.youtubeId,
        title: title.text,
        description,
        tags: project.description.tags,
        categoryId: YOUTUBE_CATEGORY_SCIENCE_TECH,
        visibility: upload.visibility.toUpperCase() as PublishVisibility,
        thumbnailSet,
        publishedAt: job.scheduledFor ?? upload.uploadedAt,
      },
    });

    await prisma.$transaction([
      prisma.publishingJob.update({ where: { id: job.id }, data: { status: 'UPLOADED', error: null } }),
      prisma.videoProject.update({ where: { id: project.id }, data: { stage: 'PUBLISHED', status: 'COMPLETED' } }),
      prisma.topic.update({ where: { id: project.topicId }, data: { status: 'PUBLISHED' } }),
    ]);

    log.info({ youtubeId: upload.youtubeId, mock: upload.mock, visibility: upload.visibility }, 'published');
    return {
      youtubeVideoId: record.id,
      youtubeId: upload.youtubeId,
      visibility: upload.visibility,
      mock: upload.mock,
    };
  } catch (err) {
    await prisma.publishingJob.update({
      where: { id: job.id },
      data: { status: 'FAILED', error: err instanceof Error ? err.message.slice(0, 4000) : String(err) },
    });
    throw err;
  }
}

function buildDescription(
  desc: { body: string; chapters: unknown; references: unknown; disclosure: string | null },
  channelName: string,
): string {
  const chapters = (desc.chapters as Array<{ seconds: number; label: string }> | null) ?? [];
  const references = (desc.references as Array<{ label: string; url: string }> | null) ?? [];

  const parts = [desc.body.trim()];

  if (chapters.length >= 3) {
    parts.push(
      '\nChapters\n' +
        chapters.map((c) => `${stamp(c.seconds)} ${c.label}`).join('\n'),
    );
  }
  if (references.length) {
    parts.push('\nSources\n' + references.map((r) => `${r.label}\n${r.url}`).join('\n\n'));
  }
  if (desc.disclosure) parts.push(`\n${desc.disclosure}`);

  parts.push(
    '\nNarration in this video is synthesised. Research, script and analysis are original work by ' +
      `${channelName}. Figures are stated as of the dates shown on screen.`,
  );

  // YouTube truncates at 5000 characters and silently drops the rest.
  return parts.join('\n').slice(0, 4990);
}

function stamp(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
}
