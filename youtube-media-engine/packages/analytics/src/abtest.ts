import { prisma, type AbTestKind } from '@yme/database';
import { compareProportions, MIN_TRIALS_PER_ARM } from './stats.js';

/**
 * A/B testing (spec §31).
 *
 * A caveat the dashboard repeats: YouTube does not expose per-variant
 * impression data through the Analytics API, and its own built-in "Test &
 * compare" runs the experiment inside YouTube without reporting arm-level
 * numbers to third parties. So any variant data here comes from a
 * SEQUENTIAL swap — variant A live for a period, then variant B — and that is
 * a weaker design than a true split test: it confounds the variant with
 * everything else that changed with time (video age, algorithmic promotion,
 * day of week).
 *
 * That is stated rather than hidden, and the result is labelled accordingly.
 */

export async function evaluateAbTest(abTestId: string): Promise<{
  status: 'RUNNING' | 'CONCLUSIVE' | 'INCONCLUSIVE';
  conclusion: string;
  winnerVariantId: string | null;
}> {
  const test = await prisma.abTest.findUnique({
    where: { id: abTestId },
    include: { variants: { orderBy: { activeFrom: 'asc' } } },
  });
  if (!test) throw new Error(`AbTest ${abTestId} not found`);

  if (test.variants.length < 2) {
    return { status: 'RUNNING', conclusion: 'Fewer than two variants have been served.', winnerVariantId: null };
  }

  // Only the two arms with the most exposure are compared. Multi-arm testing
  // multiplies the false-positive rate, and correcting for that needs far more
  // data than a channel at this scale will have.
  const [a, b] = [...test.variants].sort((x, y) => y.impressions - x.impressions).slice(0, 2);
  if (!a || !b) {
    return { status: 'RUNNING', conclusion: 'Not enough variants with data.', winnerVariantId: null };
  }

  const result = compareProportions(
    { successes: a.clicks, trials: a.impressions },
    { successes: b.clicks, trials: b.impressions },
  );

  const sequentialCaveat =
    ' Note: variants were served sequentially, not split concurrently, so the difference is ' +
    'confounded with video age and algorithmic promotion. Treat a positive result as suggestive.';

  if (!result.conclusive) {
    const stillCollecting = a.impressions < MIN_TRIALS_PER_ARM || b.impressions < MIN_TRIALS_PER_ARM;
    const conclusion = result.reason + (result.requiredTrialsPerArm ? ` Roughly ${result.requiredTrialsPerArm.toLocaleString()} impressions per arm would be needed.` : '');

    await prisma.abTest.update({
      where: { id: test.id },
      data: {
        status: stillCollecting ? 'RUNNING' : 'INCONCLUSIVE',
        conclusion,
        ...(stillCollecting ? {} : { endedAt: new Date() }),
      },
    });
    return {
      status: stillCollecting ? 'RUNNING' : 'INCONCLUSIVE',
      conclusion,
      winnerVariantId: null,
    };
  }

  const winner = result.winner === 'B' ? b : a;
  const conclusion =
    `${winner.label} wins: ${result.reason} Relative lift ` +
    `${result.relativeLift !== null ? `${(result.relativeLift * 100).toFixed(1)}%` : 'unknown'}.` +
    sequentialCaveat;

  await prisma.abTest.update({
    where: { id: test.id },
    data: { status: 'CONCLUSIVE', winnerVariantId: winner.id, conclusion, endedAt: new Date() },
  });

  return { status: 'CONCLUSIVE', conclusion, winnerVariantId: winner.id };
}

export async function startAbTest(opts: {
  youtubeVideoId: string;
  kind: AbTestKind;
  variants: Array<{ label: string; value: string; storageKey?: string | null }>;
}): Promise<string> {
  if (opts.variants.length < 2) throw new Error('An A/B test needs at least two variants');

  const test = await prisma.abTest.create({
    data: {
      youtubeVideoId: opts.youtubeVideoId,
      kind: opts.kind,
      status: 'RUNNING',
      variants: {
        create: opts.variants.map((v) => ({
          label: v.label,
          value: v.value,
          storageKey: v.storageKey ?? null,
        })),
      },
    },
  });
  return test.id;
}

/**
 * Records observed exposure for a variant. Impressions come from the daily
 * analytics snapshot delta while that variant was live, which is why the
 * sequential caveat above exists.
 */
export async function recordVariantExposure(opts: {
  variantId: string;
  impressions: number;
  clicks: number;
  views: number;
  watchTimeMinutes: number;
}): Promise<void> {
  await prisma.abVariant.update({
    where: { id: opts.variantId },
    data: {
      impressions: { increment: Math.max(0, opts.impressions) },
      clicks: { increment: Math.max(0, opts.clicks) },
      views: { increment: Math.max(0, opts.views) },
      watchTimeMinutes: { increment: Math.max(0, opts.watchTimeMinutes) },
    },
  });
}
