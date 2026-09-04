import { prisma, type DuplicateVerdict } from '@yme/database';
import { checkDuplicates, compareText, jobLogger, type ScriptSection } from '@yme/shared';

export interface DedupeResult {
  flags: Array<{ verdict: DuplicateVerdict; againstTitle: string; reason: string; combinedScore: number }>;
  blocked: boolean;
}

/**
 * Duplicate and cannibalization detection (spec §27, §28).
 *
 * Runs at two points with different data:
 *   - before production, on title + angle only (cheap, catches obvious repeats);
 *   - after the script exists, on the full narration (catches reused prose that
 *     a different title concealed).
 *
 * DUPLICATE blocks production. CANNIBALIZES does not block — two videos
 * competing for the same search intent is sometimes the right call, and that
 * is a judgement for the operator, so it is surfaced as a flag on the review
 * screen instead.
 */
export async function detectDuplicates(opts: {
  videoProjectId: string;
  jobId?: string;
  /** Include the full script text in the comparison when it exists. */
  deep?: boolean;
}): Promise<DedupeResult> {
  const log = jobLogger({ jobId: opts.jobId, videoId: opts.videoProjectId, stage: 'QC' });

  const project = await prisma.videoProject.findUnique({
    where: { id: opts.videoProjectId },
    include: {
      topic: true,
      scripts: opts.deep ? { where: { isCurrent: true }, take: 1 } : false,
      entityLinks: { include: { entity: true } },
    },
  });
  if (!project) throw new Error(`VideoProject ${opts.videoProjectId} not found`);

  const others = await prisma.videoProject.findMany({
    where: { channelId: project.channelId, id: { not: project.id }, status: { not: 'ABANDONED' } },
    include: {
      topic: true,
      scripts: opts.deep ? { where: { isCurrent: true }, take: 1 } : false,
      entityLinks: { include: { entity: true } },
    },
    take: 200,
  });

  const candidateEntities = project.entityLinks.map((l) => l.entity.key);

  const matches = checkDuplicates({
    candidateTitle: project.topic.title,
    candidateAngle: project.topic.angle,
    candidateEntityKeys: candidateEntities,
    existing: others.map((o) => ({
      id: o.id,
      title: o.topic.title,
      angle: o.topic.angle,
      entityKeys: o.entityLinks.map((l) => l.entity.key),
    })),
  });

  // Deep pass: compare actual narration. Two videos can have unrelated titles
  // and share three paragraphs, which is the reuse that damages a channel.
  const deepFlags: typeof matches = [];
  if (opts.deep && 'scripts' in project) {
    const mine = scriptText(project.scripts);
    if (mine) {
      for (const other of others) {
        const theirs = scriptText(other.scripts);
        if (!theirs) continue;
        const sim = compareText(mine, theirs);
        if (sim.phrasal >= 0.3) {
          deepFlags.push({
            id: other.id,
            title: other.topic.title,
            verdict: sim.phrasal >= 0.5 ? 'DUPLICATE' : 'CANNIBALIZES',
            similarity: sim,
            sharedEntities: [],
            reason: `Script narration is ${Math.round(sim.phrasal * 100)}% phrase-identical to "${other.topic.title}"`,
          });
        }
      }
    }
  }

  const all = [...matches, ...deepFlags].filter((m) => m.verdict !== 'DISTINCT');

  await prisma.duplicateFlag.deleteMany({ where: { videoProjectId: project.id, resolvedAt: null } });

  const flags: DedupeResult['flags'] = [];
  for (const m of all) {
    if (m.verdict === 'RELATED') continue; // informational only; not stored as a flag
    await prisma.duplicateFlag.create({
      data: {
        videoProjectId: project.id,
        againstProjectId: m.id,
        againstTitle: m.title,
        verdict: m.verdict as DuplicateVerdict,
        topicalScore: m.similarity.topical,
        phrasalScore: m.similarity.phrasal,
        combinedScore: m.similarity.combined,
        sharedEntities: m.sharedEntities,
        reason: m.reason,
      },
    });
    flags.push({
      verdict: m.verdict as DuplicateVerdict,
      againstTitle: m.title,
      reason: m.reason,
      combinedScore: m.similarity.combined,
    });
  }

  const blocked = flags.some((f) => f.verdict === 'DUPLICATE');
  if (blocked) {
    await prisma.videoProject.update({
      where: { id: project.id },
      data: {
        status: 'BLOCKED',
        blockedReason: flags.find((f) => f.verdict === 'DUPLICATE')!.reason,
      },
    });
  }

  log.info({ flags: flags.length, blocked }, 'duplicate detection complete');
  return { flags, blocked };
}

function scriptText(scripts: unknown): string | null {
  if (!Array.isArray(scripts) || scripts.length === 0) return null;
  const first = scripts[0] as { sections?: unknown };
  const sections = first.sections as ScriptSection[] | undefined;
  if (!Array.isArray(sections)) return null;
  return sections.map((s) => s.narration).join('\n\n');
}
