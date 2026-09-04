import { generateStructured, type CostTracker } from '@yme/ai';
import { prisma, type EntityKind } from '@yme/database';
import { EntityExtractionSchema, FollowupSetSchema, jobLogger, slugify, type ScriptSection } from '@yme/shared';
import { houseStyle, JSON_ONLY } from './prompts.js';
import { requireChannel } from './trend-hunter.js';

/**
 * Content Genome (spec §26).
 *
 * A knowledge graph of companies, technologies, industries and business models
 * that accumulates across videos. Its job is to answer "what have we already
 * said about NVIDIA" in one query, and to propose the next video from an edge
 * that is already established — which is a cheaper and better source of topics
 * than another trawl of the news.
 *
 * Edge strength decays on each rebuild for edges that stop being re-observed,
 * so a relationship asserted once in 2024 stops driving suggestions forever.
 */
export const EDGE_DECAY = 0.92;
export const EDGE_REINFORCE = 0.06;

export async function updateGenome(opts: {
  videoProjectId: string;
  tracker?: CostTracker;
  jobId?: string;
}): Promise<{ entities: number; relationships: number }> {
  const log = jobLogger({ jobId: opts.jobId, videoId: opts.videoProjectId, stage: 'QC' });

  const project = await prisma.videoProject.findUnique({
    where: { id: opts.videoProjectId },
    include: { topic: true, scripts: { where: { isCurrent: true }, take: 1 } },
  });
  if (!project) throw new Error(`VideoProject ${opts.videoProjectId} not found`);
  const channel = await requireChannel(project.channelId);
  const script = project.scripts[0];

  const body = script
    ? (script.sections as unknown as ScriptSection[]).map((s) => s.narration).join('\n\n')
    : `${project.topic.title}. ${project.topic.angle}`;

  const { value } = await generateStructured({
    task: 'extract-entities',
    schema: EntityExtractionSchema,
    system: [
      'You extract the entities and relationships a business video establishes, for a knowledge graph.',
      '',
      'Only extract what the text actually asserts. Do not add relationships you know to be true from',
      'elsewhere — the graph records what THIS channel has said, not general knowledge.',
      '',
      houseStyle(channel),
    ].join('\n'),
    prompt: [
      'Extract entities and the relationships between them.',
      '',
      body.slice(0, 16_000),
      '',
      'kind is one of COMPANY, PERSON, PRODUCT, INDUSTRY, TECHNOLOGY, BUSINESS_MODEL, MARKET.',
      'relation is a short uppercase verb phrase, e.g. DEPENDS_ON, COMPETES_WITH, OPERATES_IN, SUPPLIES.',
      'strength is 0-1: how central the relationship is to the story.',
      '',
      'Return: {"entities":[{"name","kind","summary"}],"relationships":[{"from","to","relation","strength"}]}',
      JSON_ONLY,
    ].join('\n'),
    maxTokens: 3000,
    temperature: 0.3,
    tracker: opts.tracker,
    ctx: { videoProjectId: project.id, stage: 'QC', jobId: opts.jobId },
    mockContext: { title: project.topic.title },
  });

  const idByName = new Map<string, string>();

  for (const e of value.entities) {
    const key = slugify(e.name, 80);
    if (!key) continue;
    const row = await prisma.entity.upsert({
      where: { channelId_key: { channelId: channel.id, key } },
      update: { summary: e.summary ?? undefined, name: e.name },
      create: { channelId: channel.id, key, name: e.name, kind: e.kind as EntityKind, summary: e.summary ?? null },
    });
    idByName.set(e.name.toLowerCase(), row.id);

    await prisma.entityLink.upsert({
      where: {
        entityId_topicId_videoProjectId: {
          entityId: row.id,
          topicId: project.topicId,
          videoProjectId: project.id,
        },
      },
      update: {},
      create: { entityId: row.id, topicId: project.topicId, videoProjectId: project.id, role: 'MENTIONED' },
    });
  }

  // Decay every existing edge, then reinforce the ones observed this run.
  await prisma.$executeRaw`
    UPDATE "ContentRelationship" cr
    SET strength = GREATEST(0.05, cr.strength * ${EDGE_DECAY})
    FROM "Entity" e
    WHERE cr."fromEntityId" = e.id AND e."channelId" = ${channel.id}
  `;

  let edges = 0;
  for (const r of value.relationships) {
    const from = idByName.get(r.from.toLowerCase());
    const to = idByName.get(r.to.toLowerCase());
    if (!from || !to || from === to) continue;

    const existing = await prisma.contentRelationship.findUnique({
      where: { fromEntityId_toEntityId_relation: { fromEntityId: from, toEntityId: to, relation: r.relation } },
    });
    const strength = existing
      ? Math.min(1, existing.strength + EDGE_REINFORCE)
      : Math.max(0.1, Math.min(1, r.strength));

    await prisma.contentRelationship.upsert({
      where: { fromEntityId_toEntityId_relation: { fromEntityId: from, toEntityId: to, relation: r.relation } },
      update: { strength },
      create: { fromEntityId: from, toEntityId: to, relation: r.relation, strength },
    });
    edges++;
  }

  log.info({ entities: idByName.size, relationships: edges }, 'content genome updated');
  return { entities: idByName.size, relationships: edges };
}

/**
 * Proposes follow-up topics from graph edges that have not been covered.
 * One published video should generate its own successors (spec §26).
 */
export async function suggestFollowups(opts: {
  videoProjectId: string;
  tracker?: CostTracker;
  jobId?: string;
  limit?: number;
}): Promise<number> {
  const project = await prisma.videoProject.findUnique({
    where: { id: opts.videoProjectId },
    include: { topic: true },
  });
  if (!project) throw new Error(`VideoProject ${opts.videoProjectId} not found`);
  const channel = await requireChannel(project.channelId);

  const links = await prisma.entityLink.findMany({
    where: { videoProjectId: project.id },
    include: {
      entity: {
        include: {
          fromEdges: { include: { to: true }, orderBy: { strength: 'desc' }, take: 6 },
        },
      },
    },
  });

  const edges = links
    .flatMap((l) => l.entity.fromEdges.map((e) => `${l.entity.name} --${e.relation}--> ${e.to.name} (${e.strength.toFixed(2)})`))
    .slice(0, 30);

  if (edges.length === 0) return 0;

  const covered = await prisma.topic.findMany({
    where: { channelId: channel.id },
    select: { title: true },
    take: 200,
  });

  const { value } = await generateStructured({
    task: 'suggest-followups',
    schema: FollowupSetSchema,
    system: houseStyle(channel),
    prompt: [
      `The video "${project.topic.title}" established these relationships:`,
      edges.join('\n'),
      '',
      'ALREADY COVERED (do not repeat):',
      covered.map((c) => `- ${c.title}`).join('\n'),
      '',
      'Propose follow-up videos that follow one of these edges in a direction the published video did',
      'not explore. Each must be a distinct story, not a restatement.',
      '',
      'Return: {"followups":[{"title","angle","whyNow"}]}',
      JSON_ONLY,
    ].join('\n'),
    maxTokens: 2000,
    temperature: 0.85,
    tracker: opts.tracker,
    ctx: { videoProjectId: project.id, stage: 'PUBLISHED', jobId: opts.jobId },
    mockContext: { title: project.topic.title },
  });

  let created = 0;
  for (const f of value.followups.slice(0, opts.limit ?? 3)) {
    const exists = await prisma.topic.findFirst({ where: { channelId: channel.id, title: f.title } });
    if (exists) continue;
    await prisma.topic.create({
      data: {
        channelId: channel.id,
        title: f.title,
        angle: f.angle,
        pillar: project.topic.pillar,
        discoverySignal: f.whyNow,
        rationale: `Suggested from the content genome after "${project.topic.title}"`,
        discoveredVia: 'content-genome',
        status: 'DISCOVERED',
      },
    });
    created++;
  }
  return created;
}
