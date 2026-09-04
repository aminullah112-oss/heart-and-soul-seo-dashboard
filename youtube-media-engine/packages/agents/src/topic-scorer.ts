import { generateStructured, type CostTracker } from '@yme/ai';
import { prisma } from '@yme/database';
import {
  TopicScoringSchema,
  computeOverallScore,
  computeMonetizationPotential,
  evaluateTopicGates,
  jobLogger,
  type ScoringWeights,
} from '@yme/shared';
import { houseStyle, JSON_ONLY, SCORER_SYSTEM } from './prompts.js';
import { requireChannel } from './trend-hunter.js';

export interface ScoreResult {
  topicId: string;
  overall: number;
  monetizationPotential: number;
  passed: boolean;
  gateFailureReasons: string[];
}

/**
 * Agent 2 — Topic Scorer (spec §7).
 *
 * The model supplies the twelve dimension ratings; the WEIGHTING AND GATES ARE
 * COMPUTED IN CODE. That split matters — asking a model for an "overall score"
 * produces a number that drifts between calls and cannot be re-derived when
 * the operator retunes the weights. Here, old scores stay interpretable
 * because the weights used are stored alongside them.
 */
export async function scoreTopic(opts: {
  topicId: string;
  tracker?: CostTracker;
  jobId?: string;
}): Promise<ScoreResult> {
  const log = jobLogger({ jobId: opts.jobId, topicId: opts.topicId, stage: 'DISCOVERY' });

  const topic = await prisma.topic.findUnique({ where: { id: opts.topicId } });
  if (!topic) throw new Error(`Topic ${opts.topicId} not found`);
  const channel = await requireChannel(topic.channelId);

  const siblings = await prisma.topic.findMany({
    where: { channelId: channel.id, status: 'PUBLISHED' },
    select: { title: true },
    take: 40,
  });

  const prompt = [
    'Score this video opportunity on all twelve dimensions.',
    '',
    `TITLE: ${topic.title}`,
    `ANGLE: ${topic.angle}`,
    `PILLAR: ${topic.pillar}`,
    `SIGNAL: ${topic.discoverySignal ?? '(none recorded)'}`,
    `RATIONALE: ${topic.rationale ?? '(none recorded)'}`,
    '',
    'ALREADY PUBLISHED ON THIS CHANNEL (affects competition and channelRelevance):',
    siblings.length ? siblings.map((s) => `- ${s.title}`).join('\n') : '(nothing published yet)',
    '',
    'Remember: competition is scored so that HIGH = saturated = bad.',
    'Give one paragraph of reasoning that a sceptic could argue with.',
    '',
    'Return: {"viralPotential",...,"channelRelevance","reasoning"}',
    JSON_ONLY,
  ].join('\n');

  const { value, model } = await generateStructured({
    task: 'score-topic',
    schema: TopicScoringSchema,
    system: `${SCORER_SYSTEM}\n\n${houseStyle(channel)}`,
    prompt,
    maxTokens: 1600,
    temperature: 0.3, // scoring should be stable across runs, not creative
    tracker: opts.tracker,
    ctx: { stage: 'DISCOVERY', jobId: opts.jobId },
    mockContext: { title: topic.title, topicId: topic.id },
  });

  const weights = (channel.scoringWeights ?? {}) as Partial<ScoringWeights>;
  const { reasoning, ...dimensions } = value;
  const { overall, contributions, effectiveWeights } = computeOverallScore(dimensions, weights);
  const gates = evaluateTopicGates(dimensions, overall, channel.minimumTopicScore);
  const monetization = computeMonetizationPotential({
    advertiserValue: value.advertiserValue,
    affiliatePotential: value.affiliatePotential,
    sponsorshipPotential: value.sponsorshipPotential,
    evergreenValue: value.evergreenValue,
    searchDemand: value.searchDemand,
  });

  await prisma.$transaction([
    prisma.topicScore.create({
      data: {
        topicId: topic.id,
        ...dimensions,
        overall,
        monetizationPotential: monetization,
        weightsUsed: effectiveWeights as unknown as object,
        contributions: contributions as unknown as object,
        reasoning,
        gatesPassed: gates.passed,
        gateFailureReasons: gates.reasons,
        scoredByModel: model,
      },
    }),
    prisma.topic.update({
      where: { id: topic.id },
      data: {
        latestScore: overall,
        // A failed gate is a rejection, not a silent low score — the radar
        // must show why something will never be produced.
        status: gates.passed ? 'SCORED' : 'REJECTED_BY_SCORE',
      },
    }),
  ]);

  log.info({ overall, passed: gates.passed }, 'topic scored');
  return { topicId: topic.id, overall, monetizationPotential: monetization, passed: gates.passed, gateFailureReasons: gates.reasons };
}

/** Scores every DISCOVERED topic for a channel. */
export async function scorePendingTopics(opts: {
  channelId: string;
  limit?: number;
  tracker?: CostTracker;
  jobId?: string;
}): Promise<ScoreResult[]> {
  const pending = await prisma.topic.findMany({
    where: { channelId: opts.channelId, status: 'DISCOVERED' },
    orderBy: { createdAt: 'asc' },
    take: opts.limit ?? 20,
    select: { id: true },
  });

  const out: ScoreResult[] = [];
  for (const t of pending) {
    out.push(await scoreTopic({ topicId: t.id, tracker: opts.tracker, jobId: opts.jobId }));
  }
  return out;
}
