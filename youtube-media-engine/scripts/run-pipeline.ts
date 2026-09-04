/**
 * End-to-end pipeline runner.
 *
 * Drives discovery -> scoring -> production -> QC -> approval -> upload
 * without Redis or the dashboard, so the whole system can be exercised in one
 * command. This is the command the README tells a new operator to run first.
 *
 *   pnpm pipeline              # full run in whatever mode .env selects
 *   pnpm pipeline --topic <id> # produce one existing topic
 *   pnpm pipeline --no-publish # stop after QC
 */
import { loadEnv } from '@yme/config';
import { prisma, disconnect } from '@yme/database';
import { describeError } from '@yme/shared';
import { newCostTracker } from '@yme/ai';
import { discoverTopics, scorePendingTopics } from '@yme/agents';
import { createProjectFromTopic, runProductionPipeline, approveForPublish, runPublish } from '@yme/pipeline';
import { ingestVideoMetrics } from '@yme/analytics';
import { videoCostSummary } from '@yme/database';

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(`--${name}`);
const value = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};

function heading(text: string) {
  console.log(`\n\x1b[1m${'─'.repeat(72)}\n${text}\n${'─'.repeat(72)}\x1b[0m`);
}

async function main() {
  const env = loadEnv();
  heading('YouTube Media Engine — pipeline run');
  console.log(`mode:      ${env.MOCK_MODE ? 'MOCK (no external calls, no spend)' : 'LIVE'}`);
  console.log(`llm:       ${env.MOCK_MODE ? 'mock' : env.LLM_PROVIDER}`);
  console.log(`tts:       ${env.MOCK_MODE ? 'mock' : env.TTS_PROVIDER}`);
  console.log(`youtube:   ${env.MOCK_MODE ? 'mock (cannot reach Google)' : env.YOUTUBE_PROVIDER}`);
  console.log(`publish:   ${env.AUTOMATIC_PUBLISH ? 'AUTOMATIC' : 'human approval required'}`);

  const channel = await prisma.channel.findFirst();
  if (!channel) throw new Error('No channel found. Run: pnpm db:seed');

  const owner = await prisma.user.findFirst({ where: { role: 'OWNER' } });
  if (!owner) throw new Error('No owner account found. Run: pnpm db:seed');

  // ── 1. Topic ───────────────────────────────────────────────────────────
  let topicId = value('topic');

  if (!topicId) {
    heading('1. Discovery');
    const tracker = newCostTracker({ stage: 'DISCOVERY', limitUsd: 5 });
    const discovery = await discoverTopics({ channelId: channel.id, limit: 5, tracker });
    console.log(`discovered ${discovery.created} new topics (${discovery.skippedAsDuplicate.length} skipped as duplicates)`);
    for (const s of discovery.skippedAsDuplicate) console.log(`  skipped: ${s.title} — ${s.reason}`);

    heading('2. Scoring');
    const scores = await scorePendingTopics({ channelId: channel.id, tracker });
    for (const s of scores.sort((a, b) => b.overall - a.overall)) {
      const topic = await prisma.topic.findUnique({ where: { id: s.topicId }, select: { title: true } });
      console.log(
        `  ${s.passed ? '\x1b[32mPASS\x1b[0m' : '\x1b[31mFAIL\x1b[0m'} ${String(s.overall).padStart(5)}  ` +
          `monetization ${String(s.monetizationPotential).padStart(5)}  ${topic?.title ?? s.topicId}`,
      );
      for (const r of s.gateFailureReasons) console.log(`         ↳ ${r}`);
    }
    console.log(`\ndiscovery+scoring cost: $${tracker.totalUsd.toFixed(4)}`);

    const best = scores.filter((s) => s.passed).sort((a, b) => b.overall - a.overall)[0];
    if (!best) throw new Error('No topic passed the scoring gates. Nothing to produce.');
    topicId = best.topicId;
  }

  // ── 2. Approve the topic (a human decision, simulated here) ────────────
  const topic = await prisma.topic.findUnique({ where: { id: topicId } });
  if (!topic) throw new Error(`Topic ${topicId} not found`);
  await prisma.topic.update({
    where: { id: topic.id },
    data: { status: 'APPROVED', decidedById: owner.id, decidedAt: new Date(), decisionNote: 'Approved by pipeline runner' },
  });

  heading(`3. Production — "${topic.title}"`);
  const project = await createProjectFromTopic({ topicId: topic.id });
  console.log(`project ${project.id} (${project.slug}), target ${project.targetMinutes} minutes\n`);

  const run = await runProductionPipeline({
    videoProjectId: project.id,
    onStage: (o) => {
      const status = o.blocked ? '\x1b[31mBLOCKED\x1b[0m' : '\x1b[32mok\x1b[0m';
      console.log(`  ${o.stage.padEnd(12)} ${status}  ${JSON.stringify(o.summary)}`);
      if (o.blocked) console.log(`    ↳ ${o.blocked.reason}`);
    },
  });

  if (run.blocked) {
    const reason = run.blocked.blocked?.reason ?? 'unknown reason';

    // MOCK_MODE cannot source real footage, so every asset is a placeholder and
    // visual quality is correctly scored low. --override-qc lets a demo run
    // continue past that to show the approval and upload path. It overrides
    // ONLY the numeric QC threshold, never a failed fact check, a copyright
    // failure or a duplicate block.
    const overridable =
      run.blocked.stage === 'QC' && /QC score .* is below the configured minimum/.test(reason);

    if (flag('override-qc') && overridable) {
      heading('QC threshold overridden');
      console.log('\x1b[33m' + '!'.repeat(72));
      console.log('QC BLOCKED THIS VIDEO AND THE BLOCK IS BEING OVERRIDDEN FOR THIS DEMO RUN.');
      console.log(`Reason: ${reason}`);
      console.log('In MOCK_MODE every visual is a placeholder, so visual quality is genuinely low.');
      console.log('Never pass --override-qc against a real channel.');
      console.log('!'.repeat(72) + '\x1b[0m');
      await prisma.videoProject.update({
        where: { id: project.id },
        data: { status: 'ACTIVE', stage: 'APPROVAL', blockedReason: null },
      });
      await prisma.qcReport.update({
        where: { videoProjectId: project.id },
        data: {
          passed: true,
          warnings: { push: `QC threshold manually overridden by pipeline runner: ${reason}` },
        },
      });
    } else {
      heading('Pipeline stopped');
      console.log(`Blocked at ${run.blocked.stage}: ${reason}`);
      console.log('\nThis is a correct outcome, not a crash — the system refused to continue.');
      if (overridable) console.log('Re-run with --override-qc to continue past the QC threshold for a demo.');
      await printCosts(project.id);
      return;
    }
  }

  // ── 3. Human packaging choices ─────────────────────────────────────────
  heading('4. Review — selecting title and thumbnail');
  const [title, thumb] = await Promise.all([
    prisma.titleVariant.findFirst({ where: { videoProjectId: project.id }, orderBy: { rubricScore: 'desc' } }),
    prisma.thumbnail.findFirst({ where: { videoProjectId: project.id }, orderBy: { rubricScore: 'desc' } }),
  ]);
  if (!title) throw new Error('No title candidates were produced');

  await prisma.titleVariant.update({ where: { id: title.id }, data: { isSelected: true } });
  if (thumb) await prisma.thumbnail.update({ where: { id: thumb.id }, data: { isSelected: true } });
  await prisma.videoProject.update({
    where: { id: project.id },
    data: { selectedTitleId: title.id, selectedThumbnailId: thumb?.id ?? null },
  });
  console.log(`  title:     "${title.text}" (rubric ${title.rubricScore})`);
  console.log(`  thumbnail: ${thumb ? `${thumb.headline} (rubric ${thumb.rubricScore})` : 'none'}`);
  console.log('  note: rubric scores are heuristics, not CTR predictions — see docs/SCORING.md');

  if (flag('no-publish')) {
    heading('Stopping before publish (--no-publish)');
    await printCosts(project.id);
    return;
  }

  // ── 4. Approval and upload ─────────────────────────────────────────────
  heading('5. Approval and upload');
  const publishingJobId = await approveForPublish({
    videoProjectId: project.id,
    userId: owner.id,
    visibility: 'PRIVATE',
    note: 'Approved by pipeline runner',
  });
  console.log(`  approved by ${owner.email}, publishing job ${publishingJobId}`);

  const published = await runPublish({ publishingJobId });
  console.log(`  uploaded: ${published.youtubeId} (${published.visibility})${published.mock ? '  [MOCK — nothing left this machine]' : ''}`);

  // ── 5. Analytics ───────────────────────────────────────────────────────
  heading('6. Analytics');
  const ingested = await ingestVideoMetrics({ youtubeVideoId: published.youtubeVideoId });
  const snapshot = await prisma.analyticsSnapshot.findUnique({ where: { id: ingested.snapshotId } });
  console.log(
    `  views ${snapshot?.views ?? '—'}  ctr ${snapshot?.ctr ?? '—'}%  ` +
      `avg view ${snapshot?.averageViewPercentage ?? '—'}%  subs +${snapshot?.subscribersGained ?? '—'}`,
  );
  if (ingested.unavailable.length) console.log(`  unavailable metric families: ${ingested.unavailable.join(', ')}`);

  await printCosts(project.id);

  heading('Done');
  const render = await prisma.videoRender.findFirst({
    where: { videoProjectId: project.id, status: 'COMPLETED', format: 'LONG_FORM_16_9' },
  });
  console.log(`Video:      ${render?.storageKey ?? '(none)'}`);
  console.log(`Duration:   ${render?.durationSeconds ? `${Math.round(render.durationSeconds)}s` : '—'}`);
  console.log(`Dashboard:  pnpm dev:web  →  http://localhost:3000/videos/${project.id}`);
}

async function printCosts(videoProjectId: string) {
  heading('Cost');
  const summary = await videoCostSummary(videoProjectId);
  console.log(`  total: $${summary.totalUsd.toFixed(4)}`);
  for (const [k, v] of Object.entries(summary.byCategory)) console.log(`    ${k.padEnd(10)} $${v.toFixed(4)}`);
  console.log('\n  by stage:');
  for (const [k, v] of Object.entries(summary.byStage)) console.log(`    ${k.padEnd(12)} $${v.toFixed(4)}`);
}

main()
  .catch((err) => {
    console.error(`\n\x1b[31mPipeline failed:\x1b[0m ${describeError(err)}`);
    if (err instanceof Error && err.stack) console.error(err.stack.split('\n').slice(1, 6).join('\n'));
    process.exitCode = 1;
  })
  .finally(async () => {
    await disconnect();
  });
