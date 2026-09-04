'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '@yme/database';
import { describeError } from '@yme/shared';
import { approveForPublish, createProjectFromTopic, runPublish } from '@yme/pipeline';
import { requireEditor } from './auth.js';

/**
 * Mutating actions.
 *
 * Every one re-checks authorisation server-side. The UI hides buttons a viewer
 * cannot use, but hiding a button is presentation, not authorisation — the
 * check that matters is the one here.
 */

export interface ActionResult {
  ok: boolean;
  message: string;
}

export async function approveTopic(topicId: string, note?: string): Promise<ActionResult> {
  try {
    const user = await requireEditor();
    const topic = await prisma.topic.findUnique({ where: { id: topicId }, include: { scores: { orderBy: { createdAt: 'desc' }, take: 1 } } });
    if (!topic) return { ok: false, message: 'Topic not found' };

    const score = topic.scores[0];
    if (score && !score.gatesPassed) {
      // An operator may still want it, but they have to see why it failed
      // rather than approving past a gate silently.
      return {
        ok: false,
        message: `This topic failed its gates: ${score.gateFailureReasons.join('; ')}. Use "approve anyway" if you disagree with the score.`,
      };
    }

    await prisma.topic.update({
      where: { id: topicId },
      data: { status: 'APPROVED', decidedById: user.id, decidedAt: new Date(), decisionNote: note ?? null },
    });
    revalidatePath('/topics');
    return { ok: true, message: `Approved "${topic.title}"` };
  } catch (err) {
    return { ok: false, message: describeError(err) };
  }
}

export async function forceApproveTopic(topicId: string, note: string): Promise<ActionResult> {
  try {
    const user = await requireEditor();
    if (!note.trim()) return { ok: false, message: 'A note is required when overriding the score gate' };

    await prisma.topic.update({
      where: { id: topicId },
      data: {
        status: 'APPROVED',
        decidedById: user.id,
        decidedAt: new Date(),
        decisionNote: `OVERRIDE: ${note}`,
      },
    });
    await prisma.auditLog.create({
      data: { userId: user.id, action: 'topic.force_approve', entity: 'Topic', entityId: topicId, metadata: { note } },
    });
    revalidatePath('/topics');
    return { ok: true, message: 'Approved over the score gate; recorded in the audit log' };
  } catch (err) {
    return { ok: false, message: describeError(err) };
  }
}

export async function rejectTopic(topicId: string, note?: string): Promise<ActionResult> {
  try {
    const user = await requireEditor();
    await prisma.topic.update({
      where: { id: topicId },
      data: { status: 'REJECTED_BY_HUMAN', decidedById: user.id, decidedAt: new Date(), decisionNote: note ?? null },
    });
    revalidatePath('/topics');
    return { ok: true, message: 'Topic rejected' };
  } catch (err) {
    return { ok: false, message: describeError(err) };
  }
}

export async function startProduction(topicId: string): Promise<ActionResult> {
  try {
    await requireEditor();
    const project = await createProjectFromTopic({ topicId });
    revalidatePath('/queue');
    revalidatePath('/topics');
    return { ok: true, message: `Production started: ${project.slug}` };
  } catch (err) {
    return { ok: false, message: describeError(err) };
  }
}

export async function selectTitle(projectId: string, titleId: string): Promise<ActionResult> {
  try {
    await requireEditor();
    await prisma.$transaction([
      prisma.titleVariant.updateMany({ where: { videoProjectId: projectId }, data: { isSelected: false } }),
      prisma.titleVariant.update({ where: { id: titleId }, data: { isSelected: true } }),
      prisma.videoProject.update({ where: { id: projectId }, data: { selectedTitleId: titleId } }),
    ]);
    revalidatePath(`/videos/${projectId}`);
    return { ok: true, message: 'Title selected' };
  } catch (err) {
    return { ok: false, message: describeError(err) };
  }
}

export async function selectThumbnail(projectId: string, thumbnailId: string): Promise<ActionResult> {
  try {
    await requireEditor();
    await prisma.$transaction([
      prisma.thumbnail.updateMany({ where: { videoProjectId: projectId }, data: { isSelected: false } }),
      prisma.thumbnail.update({ where: { id: thumbnailId }, data: { isSelected: true } }),
      prisma.videoProject.update({ where: { id: projectId }, data: { selectedThumbnailId: thumbnailId } }),
    ]);
    revalidatePath(`/videos/${projectId}`);
    return { ok: true, message: 'Thumbnail selected' };
  } catch (err) {
    return { ok: false, message: describeError(err) };
  }
}

export async function requestRevision(projectId: string, note: string): Promise<ActionResult> {
  try {
    const user = await requireEditor();
    if (!note.trim()) return { ok: false, message: 'Describe what needs to change' };

    await prisma.$transaction([
      prisma.approvalEvent.create({
        data: { videoProjectId: projectId, userId: user.id, stage: 'APPROVAL', decision: 'REVISION_REQUESTED', note },
      }),
      prisma.videoProject.update({
        where: { id: projectId },
        // Sent back to SCRIPT, not to RESEARCH: the research is still valid and
        // re-running it would spend money to reach the same claims.
        data: { stage: 'SCRIPT', status: 'ON_HOLD', blockedReason: `Revision requested: ${note}` },
      }),
    ]);
    revalidatePath(`/videos/${projectId}`);
    return { ok: true, message: 'Revision requested; project returned to the script stage' };
  } catch (err) {
    return { ok: false, message: describeError(err) };
  }
}

export async function rejectVideo(projectId: string, note: string): Promise<ActionResult> {
  try {
    const user = await requireEditor();
    await prisma.$transaction([
      prisma.approvalEvent.create({
        data: { videoProjectId: projectId, userId: user.id, stage: 'APPROVAL', decision: 'REJECTED', note: note || null },
      }),
      prisma.videoProject.update({ where: { id: projectId }, data: { status: 'ABANDONED', blockedReason: note || 'Rejected' } }),
    ]);
    revalidatePath(`/videos/${projectId}`);
    return { ok: true, message: 'Video rejected and abandoned' };
  } catch (err) {
    return { ok: false, message: describeError(err) };
  }
}

/**
 * Approve for publishing.
 *
 * This only records the approval and creates the PublishingJob. The upload
 * itself re-verifies every gate in @yme/pipeline/publish, so a bug here cannot
 * publish something QC rejected.
 */
export async function approveVideo(
  projectId: string,
  opts: { visibility: 'PRIVATE' | 'UNLISTED' | 'PUBLIC'; scheduledFor?: string | null; note?: string },
): Promise<ActionResult> {
  try {
    const user = await requireEditor();

    const project = await prisma.videoProject.findUnique({
      where: { id: projectId },
      include: { titleVariants: { where: { isSelected: true } }, thumbnails: { where: { isSelected: true } } },
    });
    if (!project) return { ok: false, message: 'Project not found' };
    if (project.titleVariants.length === 0) return { ok: false, message: 'Select a title before approving' };
    if (project.thumbnails.length === 0) return { ok: false, message: 'Select a thumbnail before approving' };

    const scheduledFor = opts.scheduledFor ? new Date(opts.scheduledFor) : null;
    if (scheduledFor && Number.isNaN(scheduledFor.getTime())) {
      return { ok: false, message: 'Scheduled time is not a valid date' };
    }
    if (scheduledFor && scheduledFor.getTime() < Date.now()) {
      return { ok: false, message: 'Scheduled time is in the past' };
    }

    const jobId = await approveForPublish({
      videoProjectId: projectId,
      userId: user.id,
      visibility: opts.visibility,
      scheduledFor,
      note: opts.note,
    });

    revalidatePath(`/videos/${projectId}`);
    revalidatePath('/queue');
    return {
      ok: true,
      message: scheduledFor
        ? `Approved and scheduled for ${scheduledFor.toISOString()} (job ${jobId})`
        : `Approved for upload as ${opts.visibility} (job ${jobId})`,
    };
  } catch (err) {
    return { ok: false, message: describeError(err) };
  }
}

/** Uploads now, for an already-approved job. */
export async function publishNow(publishingJobId: string): Promise<ActionResult> {
  try {
    await requireEditor();
    const result = await runPublish({ publishingJobId });
    revalidatePath('/queue');
    return {
      ok: true,
      message: `Uploaded as ${result.youtubeId} (${result.visibility})${result.mock ? ' — MOCK, nothing left this machine' : ''}`,
    };
  } catch (err) {
    return { ok: false, message: describeError(err) };
  }
}

export async function resolveDuplicateFlag(flagId: string, resolution: string): Promise<ActionResult> {
  try {
    const user = await requireEditor();
    const flag = await prisma.duplicateFlag.update({
      where: { id: flagId },
      data: { resolvedAt: new Date(), resolution: `${user.email}: ${resolution}` },
    });
    revalidatePath(`/videos/${flag.videoProjectId}`);
    return { ok: true, message: 'Flag resolved' };
  } catch (err) {
    return { ok: false, message: describeError(err) };
  }
}

export async function retryStage(projectId: string, stage: string): Promise<ActionResult> {
  try {
    await requireEditor();
    // The dashboard does not run stages inline — a render would block the
    // request for minutes. It clears the failure so the worker picks it up.
    await prisma.videoProject.update({
      where: { id: projectId },
      data: { status: 'ACTIVE', blockedReason: null, stage: stage as never },
    });
    revalidatePath(`/videos/${projectId}`);
    revalidatePath('/queue');
    return { ok: true, message: `Reset to ${stage}; the worker will pick it up` };
  } catch (err) {
    return { ok: false, message: describeError(err) };
  }
}

export async function updateScoringWeights(channelId: string, weights: Record<string, number>): Promise<ActionResult> {
  try {
    await requireEditor();
    const total = Object.values(weights).reduce((a, b) => a + b, 0);
    if (total <= 0) return { ok: false, message: 'Weights must sum to more than zero' };

    await prisma.channel.update({ where: { id: channelId }, data: { scoringWeights: weights } });
    revalidatePath('/settings');
    return { ok: true, message: 'Weights saved. They apply to future scores; existing scores keep the weights they used.' };
  } catch (err) {
    return { ok: false, message: describeError(err) };
  }
}
