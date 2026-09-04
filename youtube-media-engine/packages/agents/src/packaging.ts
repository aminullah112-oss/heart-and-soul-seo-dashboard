import { generateStructured, type CostTracker } from '@yme/ai';
import { prisma } from '@yme/database';
import {
  DescriptionSchema,
  ShortSetSchema,
  ThumbnailSetSchema,
  TitleSetSchema,
  jobLogger,
  toChapterStamp,
  validationError,
  type ScriptSection,
} from '@yme/shared';
import { houseStyle, JSON_ONLY, PACKAGING_SYSTEM } from './prompts.js';
import { requireChannel } from './trend-hunter.js';

export interface PackagingResult {
  titleCount: number;
  thumbnailCount: number;
  shortCount: number;
  topTitle: string;
  rejectedTitles: Array<{ text: string; reason: string }>;
}

/**
 * Agents for §21–23 and §35.
 *
 * On scoring: the six title dimensions and the thumbnail score are RUBRIC
 * scores, and they are labelled as such everywhere they surface. Calling them
 * "predicted CTR" would be a fabrication — nothing here has been calibrated
 * against this channel's impressions. Once ~20 videos have analytics, the
 * learning loop compares rubric score against observed CTR and the dashboard
 * can show whether the rubric has any predictive value at all. See
 * docs/SCORING.md.
 */
export async function buildPackaging(opts: {
  videoProjectId: string;
  tracker?: CostTracker;
  jobId?: string;
}): Promise<PackagingResult> {
  const log = jobLogger({ jobId: opts.jobId, videoId: opts.videoProjectId, stage: 'PACKAGING' });

  const project = await prisma.videoProject.findUnique({
    where: { id: opts.videoProjectId },
    include: {
      topic: true,
      storyBrief: true,
      scripts: { where: { isCurrent: true }, take: 1 },
      scenes: { orderBy: { index: 'asc' } },
      research: { include: { claims: { include: { sourceLinks: { include: { source: true } } } } } },
    },
  });
  if (!project) throw new Error(`VideoProject ${opts.videoProjectId} not found`);
  const script = project.scripts[0];
  if (!script) throw validationError('Packaging requested before a script existed');
  const channel = await requireChannel(project.channelId);

  const sections = script.sections as unknown as ScriptSection[];
  const system = `${PACKAGING_SYSTEM}\n\n${houseStyle(channel)}`;
  const scriptDigest = sections
    .map((s) => `## ${s.heading}\n${s.narration.slice(0, 700)}`)
    .join('\n\n')
    .slice(0, 14_000);

  const promises = {
    titles: generateStructured({
      task: 'generate-titles',
      schema: TitleSetSchema,
      system,
      prompt: [
        'Write 10 title candidates for this video.',
        '',
        `THESIS: ${project.storyBrief?.thesis ?? project.topic.angle}`,
        `WHAT THE VIDEO ACTUALLY ESTABLISHES: ${project.storyBrief?.keyRevelations.join('; ') ?? '(unknown)'}`,
        '',
        'SCRIPT:',
        scriptDigest,
        '',
        'Max 100 characters. Score each on the six dimensions. Set overclaims=true for any title that',
        'promises something the script does not deliver — be strict about this.',
        '',
        'Return: {"titles":[{"text","curiosity","clarity","searchIntent","emotionalImpact","uniqueness",',
        '"credibility","overclaims","rationale"}]}',
        JSON_ONLY,
      ].join('\n'),
      maxTokens: 3500,
      temperature: 0.9,
      tracker: opts.tracker,
      ctx: { videoProjectId: project.id, stage: 'PACKAGING', jobId: opts.jobId },
      mockContext: { title: project.topic.title },
    }),

    thumbnails: generateStructured({
      task: 'generate-thumbnails',
      schema: ThumbnailSetSchema,
      system,
      prompt: [
        'Give 6 thumbnail concepts for this video.',
        '',
        `THESIS: ${project.storyBrief?.thesis ?? project.topic.angle}`,
        '',
        'SCRIPT:',
        scriptDigest.slice(0, 6000),
        '',
        'One focal idea each. Headline under 30 characters. Must be legible at 168x94 pixels.',
        'rubricScore is a heuristic quality rating, not a CTR prediction — do not pretend otherwise.',
        'Set misleadingRisk honestly.',
        '',
        'Return: {"concepts":[{"concept","headline","visualDirection","emotionalHook","rubricScore",',
        '"mobileLegible","misleadingRisk"}]}',
        JSON_ONLY,
      ].join('\n'),
      maxTokens: 3000,
      temperature: 0.9,
      tracker: opts.tracker,
      ctx: { videoProjectId: project.id, stage: 'PACKAGING', jobId: opts.jobId },
      mockContext: { title: project.topic.title },
    }),
  };

  const [titles, thumbnails] = await Promise.all([promises.titles, promises.thumbnails]);

  // ── Titles ─────────────────────────────────────────────────────────────
  const rejectedTitles: Array<{ text: string; reason: string }> = [];
  const acceptedTitles = titles.value.titles.filter((t) => {
    if (t.overclaims) {
      rejectedTitles.push({ text: t.text, reason: 'Promises something the video does not establish' });
      return false;
    }
    if (t.text.length > 100) {
      rejectedTitles.push({ text: t.text, reason: 'Exceeds YouTube’s 100-character title limit' });
      return false;
    }
    return true;
  });

  if (acceptedTitles.length === 0) {
    throw validationError('Every generated title overclaimed or was too long — packaging cannot proceed');
  }

  const scored = acceptedTitles
    .map((t) => ({
      ...t,
      rubricScore:
        Math.round(
          (t.curiosity * 0.22 +
            t.clarity * 0.2 +
            t.searchIntent * 0.18 +
            t.credibility * 0.18 +
            t.uniqueness * 0.12 +
            t.emotionalImpact * 0.1) *
            10,
        ) / 10,
    }))
    .sort((a, b) => b.rubricScore - a.rubricScore);

  await prisma.$transaction(async (tx) => {
    await tx.titleVariant.deleteMany({ where: { videoProjectId: project.id } });
    for (const t of scored) {
      await tx.titleVariant.create({
        data: {
          videoProjectId: project.id,
          text: t.text,
          curiosity: t.curiosity,
          clarity: t.clarity,
          searchIntent: t.searchIntent,
          emotionalImpact: t.emotionalImpact,
          uniqueness: t.uniqueness,
          credibility: t.credibility,
          rubricScore: t.rubricScore,
          overclaims: false,
          rationale: t.rationale,
          // Nothing is pre-selected. A human picks in the review screen; the
          // ranking is a suggestion, not a decision.
          isSelected: false,
        },
      });
    }

    await tx.thumbnail.deleteMany({ where: { videoProjectId: project.id } });
    for (const c of thumbnails.value.concepts) {
      await tx.thumbnail.create({
        data: {
          videoProjectId: project.id,
          concept: c.concept,
          headline: c.headline,
          visualDirection: c.visualDirection,
          emotionalHook: c.emotionalHook,
          rubricScore: c.rubricScore,
          mobileLegible: c.mobileLegible,
          misleadingRisk: c.misleadingRisk,
          isSelected: false,
        },
      });
    }
  });

  // ── Description ────────────────────────────────────────────────────────
  // Chapters come from real scene offsets, not from the model guessing.
  const chapters = deriveChapters(project.scenes, sections);
  const references = collectReferences(project.research?.claims ?? []);

  const description = await generateStructured({
    task: 'generate-description',
    schema: DescriptionSchema,
    system,
    prompt: [
      'Write the YouTube description for this video.',
      '',
      `TITLE (working): ${scored[0]!.text}`,
      `THESIS: ${project.storyBrief?.thesis ?? project.topic.angle}`,
      '',
      'SCRIPT:',
      scriptDigest.slice(0, 8000),
      '',
      'CHAPTERS (use exactly these seconds and labels):',
      chapters.map((c) => `${toChapterStamp(c.seconds)} ${c.label}`).join('\n'),
      '',
      'REFERENCES (include these, do not invent others):',
      references.map((r) => `${r.label} — ${r.url}`).join('\n') || '(none)',
      '',
      'Do not keyword-stuff. Max 30 tags. Include an analysis-not-advice line.',
      '',
      'Return: {"body","chapters":[{"seconds","label"}],"tags":[],"references":[{"label","url"}],"disclosure"}',
      JSON_ONLY,
    ].join('\n'),
    maxTokens: 2500,
    temperature: 0.6,
    tracker: opts.tracker,
    ctx: { videoProjectId: project.id, stage: 'PACKAGING', jobId: opts.jobId },
    mockContext: { title: project.topic.title, chapters },
  });

  await prisma.videoDescription.upsert({
    where: { videoProjectId: project.id },
    update: {
      body: description.value.body,
      // Chapters and references are overwritten with the computed values: the
      // model is allowed to write prose, not to invent timestamps or sources.
      chapters: chapters as unknown as object,
      tags: description.value.tags.slice(0, 30),
      references: references as unknown as object,
      disclosure: description.value.disclosure,
    },
    create: {
      videoProjectId: project.id,
      body: description.value.body,
      chapters: chapters as unknown as object,
      tags: description.value.tags.slice(0, 30),
      references: references as unknown as object,
      disclosure: description.value.disclosure,
    },
  });

  // ── Shorts ─────────────────────────────────────────────────────────────
  const shortCount = await buildShorts({
    videoProjectId: project.id,
    sections,
    channelId: channel.id,
    perVideo: channel.shortsPerVideo,
    tracker: opts.tracker,
    jobId: opts.jobId,
  });

  log.info(
    { titles: scored.length, thumbnails: thumbnails.value.concepts.length, shorts: shortCount, rejectedTitles: rejectedTitles.length },
    'packaging complete',
  );

  return {
    titleCount: scored.length,
    thumbnailCount: thumbnails.value.concepts.length,
    shortCount,
    topTitle: scored[0]!.text,
    rejectedTitles,
  };
}

async function buildShorts(opts: {
  videoProjectId: string;
  sections: ScriptSection[];
  channelId: string;
  perVideo: number;
  tracker?: CostTracker;
  jobId?: string;
}): Promise<number> {
  const channel = await requireChannel(opts.channelId);
  const scenes = await prisma.scene.findMany({
    where: { videoProjectId: opts.videoProjectId },
    orderBy: { index: 'asc' },
    select: { sectionId: true, startSeconds: true, estimatedSeconds: true },
  });

  const { value } = await generateStructured({
    task: 'generate-shorts',
    schema: ShortSetSchema,
    system: `${PACKAGING_SYSTEM}\n\n${houseStyle(channel)}`,
    prompt: [
      `Identify ${opts.perVideo} moments from this video that stand alone as vertical shorts.`,
      '',
      'A good short moment: one complete idea, a hook in the first 2 seconds, no dependency on',
      'context from earlier in the video, and a reason to watch the long-form version.',
      '',
      'SCRIPT:',
      opts.sections.map((s) => `## ${s.id} — ${s.heading}\n${s.narration}`).join('\n\n').slice(0, 14_000),
      '',
      'Each short is 20-55 seconds of narration. sourceSectionId must be a real section id.',
      '',
      'Return: {"shorts":[{"hook","narration","sourceSectionId","startSeconds","endSeconds",',
      '"onScreenText":[],"ctaToLongForm"}]}',
      JSON_ONLY,
    ].join('\n'),
    maxTokens: 3000,
    temperature: 0.85,
    tracker: opts.tracker,
    ctx: { videoProjectId: opts.videoProjectId, stage: 'PACKAGING', jobId: opts.jobId },
    mockContext: { sections: opts.sections },
  });

  const knownSections = new Set(opts.sections.map((s) => s.id));
  const sectionStart = new Map<string, number>();
  for (const s of scenes) {
    if (!sectionStart.has(s.sectionId)) sectionStart.set(s.sectionId, s.startSeconds ?? 0);
  }

  await prisma.shortClip.deleteMany({ where: { videoProjectId: opts.videoProjectId, approvedAt: null } });

  let created = 0;
  for (const short of value.shorts.slice(0, opts.perVideo)) {
    if (!knownSections.has(short.sourceSectionId)) continue;
    // Offsets are corrected against real scene timing rather than trusted.
    const start = sectionStart.get(short.sourceSectionId) ?? short.startSeconds;
    const duration = Math.min(58, Math.max(15, short.endSeconds - short.startSeconds || 40));

    await prisma.shortClip.create({
      data: {
        videoProjectId: opts.videoProjectId,
        hook: short.hook,
        narration: short.narration,
        sourceSectionId: short.sourceSectionId,
        startSeconds: start,
        endSeconds: start + duration,
        onScreenText: short.onScreenText,
        ctaToLongForm: short.ctaToLongForm,
      },
    });
    created++;
  }
  return created;
}

/** Chapters derived from actual scene offsets, one per script section. */
export function deriveChapters(
  scenes: Array<{ sectionId: string; startSeconds: number | null; index: number }>,
  sections: ScriptSection[],
): Array<{ seconds: number; label: string }> {
  const firstScene = new Map<string, number>();
  for (const s of [...scenes].sort((a, b) => a.index - b.index)) {
    if (!firstScene.has(s.sectionId)) firstScene.set(s.sectionId, Math.round(s.startSeconds ?? 0));
  }

  const chapters = sections
    .map((s) => ({ seconds: firstScene.get(s.id) ?? -1, label: s.heading }))
    .filter((c) => c.seconds >= 0)
    .sort((a, b) => a.seconds - b.seconds);

  // YouTube requires the first chapter at 0:00 and at least three chapters.
  if (chapters.length && chapters[0]!.seconds !== 0) chapters[0]!.seconds = 0;
  return chapters;
}

function collectReferences(
  claims: Array<{ sourceLinks: Array<{ source: { url: string; publisher: string; title: string; unavailableReason: string | null } }> }>,
): Array<{ label: string; url: string }> {
  const byUrl = new Map<string, { label: string; url: string }>();
  for (const c of claims) {
    for (const link of c.sourceLinks) {
      // Never link a source that could not be retrieved — a dead reference in
      // the description is worse than no reference.
      if (link.source.unavailableReason) continue;
      if (!byUrl.has(link.source.url)) {
        byUrl.set(link.source.url, {
          label: `${link.source.publisher} — ${link.source.title}`.slice(0, 120),
          url: link.source.url,
        });
      }
    }
  }
  return [...byUrl.values()].slice(0, 12);
}
