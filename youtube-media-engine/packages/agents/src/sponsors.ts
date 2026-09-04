import { generateStructured, type CostTracker } from '@yme/ai';
import { prisma } from '@yme/database';
import { SponsorFitSchema, jobLogger } from '@yme/shared';
import { houseStyle, JSON_ONLY } from './prompts.js';
import { requireChannel } from './trend-hunter.js';

/**
 * Sponsorship fit scoring (spec §33).
 *
 * Scores how well a tracked company matches the audience a specific video
 * attracts. It is a CRM aid, nothing more:
 *
 *  - It never contacts anyone. There is no outreach code path, no email
 *    integration, and `lastContactAt` is only ever set by a human. Automated
 *    sponsor outreach is how a channel acquires a spam reputation.
 *  - It flags category conflicts, because taking money from a company you may
 *    later need to critique is a real editorial cost that a fit score alone
 *    hides.
 */
export interface SponsorFitResult {
  sponsorId: string;
  company: string;
  fitScore: number;
  rationale: string;
  risks: string[];
}

export async function scoreSponsorFit(opts: {
  sponsorId: string;
  videoProjectId?: string;
  tracker?: CostTracker;
  jobId?: string;
}): Promise<SponsorFitResult> {
  const log = jobLogger({ jobId: opts.jobId, videoId: opts.videoProjectId });

  const sponsor = await prisma.sponsor.findUnique({ where: { id: opts.sponsorId } });
  if (!sponsor) throw new Error(`Sponsor ${opts.sponsorId} not found`);
  const channel = await requireChannel(sponsor.channelId);

  const project = opts.videoProjectId
    ? await prisma.videoProject.findUnique({
        where: { id: opts.videoProjectId },
        include: { topic: true, storyBrief: true, entityLinks: { include: { entity: true } } },
      })
    : null;

  // A sponsor that is also a subject of the channel's coverage is a conflict,
  // and it is cheaper to detect here than in a comment section.
  const coveredEntities = await prisma.entity.findMany({
    where: { channelId: channel.id },
    select: { name: true, key: true },
    take: 200,
  });
  const conflict = coveredEntities.find(
    (e) => e.key === sponsor.company.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
  );

  const { value } = await generateStructured({
    task: 'sponsor-fit',
    schema: SponsorFitSchema,
    system: [
      'You assess whether a company is a sensible sponsor for a business and technology channel.',
      '',
      'Be sceptical. A high fit score means the audience genuinely wants the product, not that the',
      'company has money. A mismatch costs audience trust, which is worth more than one placement.',
      '',
      houseStyle(channel),
    ].join('\n'),
    prompt: [
      `SPONSOR: ${sponsor.company} (${sponsor.category})`,
      sponsor.website ? `WEBSITE: ${sponsor.website}` : '',
      '',
      `AUDIENCE: ${channel.primaryAudience}`,
      `POSITIONING: ${channel.positioning}`,
      '',
      project
        ? `CANDIDATE VIDEO: ${project.topic.title}\nANGLE: ${project.topic.angle}\nSUBJECTS: ${project.entityLinks.map((l) => l.entity.name).join(', ')}`
        : '(no specific video; score general channel fit)',
      '',
      conflict
        ? `NOTE: this channel has already covered "${conflict.name}" as a subject. Treat that as a conflict risk.`
        : '',
      '',
      'Return: {"fitScore","rationale","audienceMatch","risks":[]}',
      JSON_ONLY,
    ]
      .filter(Boolean)
      .join('\n'),
    maxTokens: 1200,
    temperature: 0.4,
    tracker: opts.tracker,
    ctx: { videoProjectId: opts.videoProjectId ?? null, stage: 'PACKAGING', jobId: opts.jobId },
    mockContext: { company: sponsor.company },
  });

  const risks = [...value.risks];
  if (conflict) risks.unshift(`Editorial conflict: the channel has covered ${conflict.name} as a subject.`);

  await prisma.sponsor.update({
    where: { id: sponsor.id },
    data: {
      fitScore: value.fitScore,
      fitRationale: `${value.rationale} Audience: ${value.audienceMatch}`,
      // Status is never advanced automatically. Moving a company to CONTACTED
      // is a human action, because only a human can actually contact them.
      notes: risks.length ? `Risks: ${risks.join(' ')}` : sponsor.notes,
    },
  });

  log.info({ company: sponsor.company, fitScore: value.fitScore }, 'sponsor fit scored');
  return { sponsorId: sponsor.id, company: sponsor.company, fitScore: value.fitScore, rationale: value.rationale, risks };
}

/** Scores every tracked sponsor against a video. Never contacts anyone. */
export async function scoreAllSponsors(opts: {
  channelId: string;
  videoProjectId?: string;
  tracker?: CostTracker;
  jobId?: string;
}): Promise<SponsorFitResult[]> {
  const sponsors = await prisma.sponsor.findMany({
    where: { channelId: opts.channelId, status: { notIn: ['DO_NOT_CONTACT', 'LOST'] } },
    select: { id: true },
  });

  const out: SponsorFitResult[] = [];
  for (const s of sponsors) {
    out.push(
      await scoreSponsorFit({
        sponsorId: s.id,
        videoProjectId: opts.videoProjectId,
        tracker: opts.tracker,
        jobId: opts.jobId,
      }),
    );
  }
  return out.sort((a, b) => b.fitScore - a.fitScore);
}
