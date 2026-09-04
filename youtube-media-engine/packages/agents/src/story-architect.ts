import { generateStructured, type CostTracker } from '@yme/ai';
import { prisma } from '@yme/database';
import { StoryBriefSchema, jobLogger, validationError } from '@yme/shared';
import { houseStyle, JSON_ONLY, STORY_SYSTEM } from './prompts.js';
import { requireChannel } from './trend-hunter.js';

/**
 * Agent 4 — Story Architect (spec §10).
 *
 * Runs before any script exists, on purpose. Writing first and structuring
 * afterwards is what produces the same five-section video every time.
 */
export async function buildStoryBrief(opts: {
  videoProjectId: string;
  tracker?: CostTracker;
  jobId?: string;
}): Promise<{ storyBriefId: string; arcSections: string[] }> {
  const log = jobLogger({ jobId: opts.jobId, videoId: opts.videoProjectId, stage: 'STORY' });

  const project = await prisma.videoProject.findUnique({
    where: { id: opts.videoProjectId },
    include: {
      topic: true,
      research: { include: { claims: { include: { sourceLinks: { include: { source: true } } } } } },
    },
  });
  if (!project) throw new Error(`VideoProject ${opts.videoProjectId} not found`);
  if (!project.research) throw validationError('Story brief requested before research completed');
  const channel = await requireChannel(project.channelId);

  const usable = project.research.claims.filter((c) => c.status !== 'REJECTED');
  if (usable.length === 0) throw validationError('No usable claims available for a story brief');

  const claimBlock = usable
    .map(
      (c) =>
        `- ${c.key} [${c.confidence}/${c.status}] ${c.text}` +
        (c.asOf ? ` (as of ${c.asOf.toISOString().slice(0, 10)})` : ''),
    )
    .join('\n');

  // Recently used arcs are shown so the model can avoid repeating a shape.
  const recentArcs = await prisma.storyBrief.findMany({
    orderBy: { createdAt: 'desc' },
    take: 5,
    select: { narrativeArc: true },
  });
  const usedShapes = recentArcs
    .map((b) => (b.narrativeArc as Array<{ section: string }> | null)?.map((s) => s.section).join(' → '))
    .filter(Boolean);

  const { value } = await generateStructured({
    task: 'story-brief',
    schema: StoryBriefSchema,
    system: `${STORY_SYSTEM}\n\n${houseStyle(channel)}`,
    prompt: [
      'Design the story brief for this video.',
      '',
      `TITLE: ${project.topic.title}`,
      `ANGLE: ${project.topic.angle}`,
      `RESEARCH QUESTION: ${project.research.question}`,
      `TARGET LENGTH: ${project.targetMinutes} minutes`,
      '',
      'VERIFIED CLAIMS AVAILABLE (the video may only assert these):',
      claimBlock,
      '',
      usedShapes.length
        ? `ARCS USED IN THE LAST FEW VIDEOS — do not reuse these shapes:\n${usedShapes.map((s) => `- ${s}`).join('\n')}`
        : '',
      '',
      'The narrative arc must have at least 4 sections and come from THIS story.',
      'supportingClaimKeys must be keys from the list above.',
      '',
      'Return: {"centralQuestion","thesis","targetViewer","whyCare","hook","conflict","stakes",',
      '"narrativeArc":[{"section","purpose"}],"keyRevelations":[],"supportingClaimKeys":[],"ending","cta"}',
      JSON_ONLY,
    ]
      .filter(Boolean)
      .join('\n'),
    maxTokens: 3000,
    temperature: 0.75,
    tracker: opts.tracker,
    ctx: { videoProjectId: project.id, stage: 'STORY', jobId: opts.jobId },
    mockContext: { title: project.topic.title, claimKeys: usable.map((c) => c.key) },
  });

  // Claim keys are validated against the database, not trusted from the model.
  const known = new Set(usable.map((c) => c.key));
  const unknown = value.supportingClaimKeys.filter((k) => !known.has(k));
  const supporting = value.supportingClaimKeys.filter((k) => known.has(k));
  if (unknown.length) log.warn({ unknown }, 'story brief referenced unknown claim keys; dropped');

  const brief = await prisma.storyBrief.upsert({
    where: { videoProjectId: project.id },
    update: {
      centralQuestion: value.centralQuestion,
      thesis: value.thesis,
      targetViewer: value.targetViewer,
      whyCare: value.whyCare,
      hook: value.hook,
      conflict: value.conflict,
      stakes: value.stakes,
      narrativeArc: value.narrativeArc as unknown as object,
      keyRevelations: value.keyRevelations,
      ending: value.ending,
      cta: value.cta,
    },
    create: {
      videoProjectId: project.id,
      centralQuestion: value.centralQuestion,
      thesis: value.thesis,
      targetViewer: value.targetViewer,
      whyCare: value.whyCare,
      hook: value.hook,
      conflict: value.conflict,
      stakes: value.stakes,
      narrativeArc: value.narrativeArc as unknown as object,
      keyRevelations: value.keyRevelations,
      ending: value.ending,
      cta: value.cta,
    },
  });

  if (supporting.length) {
    await prisma.claim.updateMany({
      where: { researchProjectId: project.research.id, key: { in: supporting } },
      data: { usedInScript: true },
    });
  }

  log.info({ sections: value.narrativeArc.length }, 'story brief built');
  return { storyBriefId: brief.id, arcSections: value.narrativeArc.map((s) => s.section) };
}
