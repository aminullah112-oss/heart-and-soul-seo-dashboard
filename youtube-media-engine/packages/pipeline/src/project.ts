import { prisma, type VideoProject } from '@yme/database';
import { slugify, validationError } from '@yme/shared';
import { channelConfig } from '@yme/config';

/**
 * Promotes an approved topic into a production project.
 *
 * Deliberately requires the topic to be APPROVED, not merely well-scored. A
 * high score is a recommendation; a human pressing approve is the decision.
 */
export async function createProjectFromTopic(opts: {
  topicId: string;
  targetMinutes?: number;
  /** Bypasses the approval requirement — only for the CLI demo runner. */
  allowUnapproved?: boolean;
}): Promise<VideoProject> {
  const topic = await prisma.topic.findUnique({ where: { id: opts.topicId }, include: { videoProject: true } });
  if (!topic) throw validationError(`Topic ${opts.topicId} not found`);
  if (topic.videoProject) return topic.videoProject;

  if (topic.status !== 'APPROVED' && !opts.allowUnapproved) {
    throw validationError(
      `Topic "${topic.title}" is ${topic.status}, not APPROVED. Production starts only after a human approves the topic.`,
    );
  }

  const baseSlug = slugify(topic.title) || `video-${topic.id.slice(0, 8)}`;
  const slug = await uniqueSlug(baseSlug);

  const targetMinutes =
    opts.targetMinutes ??
    Math.round((channelConfig.videoLengthMinMinutes + channelConfig.videoLengthMaxMinutes) / 2);

  const [project] = await prisma.$transaction([
    prisma.videoProject.create({
      data: { channelId: topic.channelId, topicId: topic.id, slug, targetMinutes, stage: 'RESEARCH' },
    }),
    prisma.topic.update({ where: { id: topic.id }, data: { status: 'IN_PRODUCTION' } }),
  ]);

  return project;
}

async function uniqueSlug(base: string): Promise<string> {
  for (let i = 0; i < 50; i++) {
    const candidate = i === 0 ? base : `${base}-${i + 1}`;
    const existing = await prisma.videoProject.findUnique({ where: { slug: candidate }, select: { id: true } });
    if (!existing) return candidate;
  }
  return `${base}-${Date.now().toString(36)}`;
}
