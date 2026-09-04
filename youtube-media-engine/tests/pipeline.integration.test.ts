import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { loadEnv, DEFAULT_SCORING_WEIGHTS } from '@yme/config';
import { prisma, disconnect } from '@yme/database';
import { discoverTopics, scoreTopic, runResearch, buildStoryBrief, writeScript, factCheckScript, detectDuplicates } from '@yme/agents';
import { createProjectFromTopic, approveForPublish, runPublish } from '@yme/pipeline';
import { newCostTracker } from '@yme/ai';

/**
 * Integration tests against a real Postgres and the real agent code paths, in
 * MOCK_MODE.
 *
 * Every test builds its own fixtures inside a dedicated channel that is
 * deleted afterwards. Depending on whatever the last demo run happened to
 * leave behind produced a suite that skipped half its cases and passed the
 * rest vacuously — green, and worthless.
 *
 * Render and voice are exercised by scripts/run-pipeline.ts instead: a
 * 500-second ffmpeg encode does not belong in a test suite.
 */

const env = loadEnv();
const describeIfMock = env.MOCK_MODE ? describe : describe.skip;

let channelId: string;
let ownerId: string;

beforeAll(async () => {
  const owner = await prisma.user.findFirst({ where: { role: 'OWNER' } });
  if (!owner) throw new Error('Run `pnpm db:seed` before the integration tests');
  ownerId = owner.id;

  const channel = await prisma.channel.create({
    data: {
      name: 'Integration Test Channel',
      positioning: 'Fixture channel for the integration suite.',
      primaryAudience: 'tests',
      scoringWeights: DEFAULT_SCORING_WEIGHTS as unknown as object,
      minimumTopicScore: 60,
      minimumQcScore: 85,
    },
  });
  channelId = channel.id;
});

afterAll(async () => {
  // Cascades clean up every topic, project, claim and cost record beneath it.
  if (channelId) await prisma.channel.delete({ where: { id: channelId } }).catch(() => undefined);
  await disconnect();
});

/** Creates a topic directly, bypassing discovery, for tests about later stages. */
async function makeTopic(title: string, status: 'DISCOVERED' | 'SCORED' | 'APPROVED' = 'SCORED') {
  return prisma.topic.create({
    data: {
      channelId,
      title,
      angle: 'A fixture angle describing the mechanism under test in enough words to be realistic.',
      pillar: 'AI_BUSINESS',
      status,
      discoverySignal: 'Fixture signal',
    },
  });
}

describeIfMock('discovery', () => {
  it('creates topics and refuses to store a duplicate of one already in the catalogue', async () => {
    const first = await discoverTopics({ channelId, limit: 4 });
    expect(first.created).toBeGreaterThan(0);

    // The offline catalogue is finite. Drain it, then assert that a further
    // pass proposes only things already stored and creates nothing.
    for (let i = 0; i < 4; i++) await discoverTopics({ channelId, limit: 12 });

    const exhausted = await discoverTopics({ channelId, limit: 12 });
    expect(exhausted.created).toBe(0);
    expect(exhausted.skippedAsDuplicate.length).toBeGreaterThan(0);

    const titles = await prisma.topic.findMany({ where: { channelId }, select: { title: true } });
    expect(new Set(titles.map((t) => t.title)).size).toBe(titles.length);
  }, 60_000);
});

describeIfMock('scoring', () => {
  it('stores the weights used so a score stays interpretable after retuning', async () => {
    const topic = await makeTopic('Fixture: weights are snapshotted', 'DISCOVERED');
    const result = await scoreTopic({ topicId: topic.id });

    const score = await prisma.topicScore.findFirstOrThrow({
      where: { topicId: topic.id },
      orderBy: { createdAt: 'desc' },
    });

    expect(score.weightsUsed).toBeTruthy();
    expect(score.overall).toBeCloseTo(result.overall, 5);

    const contributions = score.contributions as Record<string, number>;
    expect(Object.values(contributions).reduce((a, b) => a + b, 0)).toBeCloseTo(score.overall, 0);
  }, 60_000);

  it('writes the rejection reason onto the topic when a gate fails', async () => {
    const topic = await makeTopic('Fixture: gate failure is explained', 'DISCOVERED');
    await prisma.channel.update({ where: { id: channelId }, data: { minimumTopicScore: 100 } });

    const result = await scoreTopic({ topicId: topic.id });
    expect(result.passed).toBe(false);
    expect(result.gateFailureReasons.join(' ')).toMatch(/below the configured minimum/);

    const updated = await prisma.topic.findUniqueOrThrow({ where: { id: topic.id } });
    expect(updated.status).toBe('REJECTED_BY_SCORE');

    await prisma.channel.update({ where: { id: channelId }, data: { minimumTopicScore: 60 } });
  }, 60_000);
});

describeIfMock('production gates', () => {
  it('refuses to start production on a topic a human has not approved', async () => {
    const topic = await makeTopic('Fixture: unapproved topic');
    await expect(createProjectFromTopic({ topicId: topic.id })).rejects.toThrow(/APPROVED/);
  }, 30_000);

  it('starts production once the topic is approved', async () => {
    const topic = await makeTopic('Fixture: approved topic', 'APPROVED');
    const project = await createProjectFromTopic({ topicId: topic.id });

    expect(project.stage).toBe('RESEARCH');
    const updated = await prisma.topic.findUniqueOrThrow({ where: { id: topic.id } });
    expect(updated.status).toBe('IN_PRODUCTION');
  }, 30_000);
});

describeIfMock('research integrity', () => {
  let projectId: string;

  beforeAll(async () => {
    const topic = await makeTopic('Fixture: research integrity', 'APPROVED');
    const project = await createProjectFromTopic({ topicId: topic.id });
    projectId = project.id;
    await runResearch({
      videoProjectId: projectId,
      tracker: newCostTracker({ videoProjectId: projectId, stage: 'RESEARCH' }),
    });
  }, 180_000);

  it('stores no claim that cites a source which was never retrieved', async () => {
    // The whole reason claims and sources are separate tables with an explicit
    // join: a hallucinated citation cannot be represented.
    const claims = await prisma.claim.findMany({
      where: { researchProject: { videoProjectId: projectId } },
      include: { sourceLinks: { include: { source: true } } },
    });

    expect(claims.length).toBeGreaterThan(0);
    for (const claim of claims) {
      expect(claim.sourceLinks.length, `claim ${claim.key} has no source`).toBeGreaterThan(0);
    }
  });

  it('caps HIGH confidence to claims backed by a strong source', async () => {
    const claims = await prisma.claim.findMany({
      where: { researchProject: { videoProjectId: projectId }, confidence: 'HIGH' },
      include: { sourceLinks: { include: { source: true } } },
    });

    for (const claim of claims) {
      const strong = claim.sourceLinks.some((l) =>
        ['PRIMARY_COMPANY', 'REGULATORY_FILING', 'GOVERNMENT', 'FINANCIAL_REPORT'].includes(l.source.tier),
      );
      expect(strong, `claim ${claim.key} is HIGH confidence on weak sources`).toBe(true);
    }
  });

  it('keeps unusable sources in the audit trail with a reason instead of dropping them', async () => {
    const sources = await prisma.source.findMany({ where: { researchProject: { videoProjectId: projectId } } });
    expect(sources.length).toBeGreaterThan(0);
    for (const s of sources) {
      if (s.unavailableReason) expect(s.reliability).toBe(0);
      else expect(s.reliability).toBeGreaterThan(0);
    }
  });
});

describeIfMock('script and fact check', () => {
  let projectId: string;

  beforeAll(async () => {
    const topic = await makeTopic('Fixture: script and fact check', 'APPROVED');
    const project = await createProjectFromTopic({ topicId: topic.id });
    projectId = project.id;
    const tracker = newCostTracker({ videoProjectId: projectId, stage: 'RESEARCH' });
    await runResearch({ videoProjectId: projectId, tracker });
    await buildStoryBrief({ videoProjectId: projectId, tracker });
    await writeScript({ videoProjectId: projectId, tracker });
  }, 240_000);

  it('writes a script whose claim references all resolve to stored claims', async () => {
    const script = await prisma.script.findFirstOrThrow({ where: { videoProjectId: projectId, isCurrent: true } });
    const claims = await prisma.claim.findMany({ where: { researchProject: { videoProjectId: projectId } } });
    const known = new Set(claims.map((c) => c.key));

    const sections = script.sections as Array<{ claimKeys: string[] }>;
    for (const section of sections) {
      for (const key of section.claimKeys) expect(known.has(key), `unknown claim key ${key}`).toBe(true);
    }
  });

  it('passes the fact check on a script that frames its disputed claim as contested', async () => {
    const result = await factCheckScript({
      videoProjectId: projectId,
      tracker: newCostTracker({ videoProjectId: projectId, stage: 'FACT_CHECK' }),
    });
    expect(result.verdict).toBe('PASS');
    expect(result.highRiskCount).toBe(0);
  }, 60_000);

  it('fails the fact check when a disputed claim is asserted as settled fact', async () => {
    // The mechanical pass must catch this even when the model says PASS.
    const script = await prisma.script.findFirstOrThrow({ where: { videoProjectId: projectId, isCurrent: true } });
    const sections = script.sections as Array<{ id: string; heading: string; narration: string; claimKeys: string[]; openLoop: string | null }>;

    const disputed = await prisma.claim.findFirst({
      where: { researchProject: { videoProjectId: projectId }, status: 'DISPUTED' },
    });
    expect(disputed, 'fixture needs a DISPUTED claim').not.toBeNull();

    const tampered = sections.map((s) =>
      s.claimKeys.includes(disputed!.key)
        ? { ...s, narration: 'The advantage is permanent and settled. Nobody serious questions it.' }
        : s,
    );
    await prisma.script.update({ where: { id: script.id }, data: { sections: tampered as unknown as object } });

    const result = await factCheckScript({
      videoProjectId: projectId,
      tracker: newCostTracker({ videoProjectId: projectId, stage: 'FACT_CHECK' }),
    });
    expect(result.verdict).toBe('FAIL');
    expect(result.highRiskCount).toBeGreaterThan(0);
    expect(JSON.stringify(result.findings)).toMatch(/contested/i);
  }, 60_000);
});

describeIfMock('duplicate detection across projects', () => {
  it('blocks a second project that duplicates an existing one', async () => {
    const a = await makeTopic('Fixture: How ACME Makes Money From Rentals', 'APPROVED');
    const b = await makeTopic('Fixture: How ACME Makes Money From Rentals', 'APPROVED');
    await createProjectFromTopic({ topicId: a.id });
    const second = await createProjectFromTopic({ topicId: b.id });

    const result = await detectDuplicates({ videoProjectId: second.id });
    expect(result.blocked).toBe(true);

    const updated = await prisma.videoProject.findUniqueOrThrow({ where: { id: second.id } });
    expect(updated.status).toBe('BLOCKED');
  }, 60_000);
});

describeIfMock('publishing gates', () => {
  it('refuses to approve a video whose QC has not passed', async () => {
    const topic = await makeTopic('Fixture: no QC report', 'APPROVED');
    const project = await createProjectFromTopic({ topicId: topic.id });

    await expect(
      approveForPublish({ videoProjectId: project.id, userId: ownerId, visibility: 'PRIVATE' }),
    ).rejects.toThrow(/QC/);
  }, 30_000);

  it('refuses to upload a publishing job that carries no approver', async () => {
    // The gate lives in the uploader, not the UI. A dashboard bug, a stray API
    // call or a mis-scheduled cron must not be able to publish.
    const topic = await makeTopic('Fixture: rogue publish job', 'APPROVED');
    const project = await createProjectFromTopic({ topicId: topic.id });

    const rogue = await prisma.publishingJob.create({
      data: { videoProjectId: project.id, visibility: 'PUBLIC', status: 'SCHEDULED' },
    });

    await expect(runPublish({ publishingJobId: rogue.id })).rejects.toThrow(/approver/i);
  }, 30_000);
});

describeIfMock('observability', () => {
  it('attributes cost to the stage that incurred it, not to one bucket', async () => {
    const records = await prisma.costRecord.findMany({
      where: { videoProject: { channelId } },
      select: { stage: true },
    });
    expect(records.length).toBeGreaterThan(0);
    // A single stage for everything means the tracker is never told which
    // stage is running — which is exactly the bug this catches.
    expect(new Set(records.map((r) => r.stage)).size).toBeGreaterThan(1);
  }, 30_000);
});
