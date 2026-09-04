import { Prisma, type CostCategory } from '@prisma/client';
import { prisma } from './client.js';

/**
 * Cost ledger writes (spec §38). Every provider call goes through here, so
 * "what did this video cost" is a sum over one table rather than an estimate.
 */
export async function recordCost(entry: {
  videoProjectId?: string | null;
  category: CostCategory;
  provider: string;
  stage: string;
  usd: number;
  units: number;
  unitLabel: string;
  model?: string | null;
  detail?: Record<string, unknown>;
}): Promise<void> {
  await prisma.costRecord.create({
    data: {
      videoProjectId: entry.videoProjectId ?? null,
      category: entry.category,
      provider: entry.provider,
      stage: entry.stage,
      usd: new Prisma.Decimal(entry.usd.toFixed(6)),
      units: entry.units,
      unitLabel: entry.unitLabel,
      model: entry.model ?? null,
      detail: (entry.detail ?? undefined) as never,
    },
  });
}

export interface CostSummary {
  totalUsd: number;
  byCategory: Record<string, number>;
  byStage: Record<string, number>;
}

export async function videoCostSummary(videoProjectId: string): Promise<CostSummary> {
  const rows = await prisma.costRecord.findMany({
    where: { videoProjectId },
    select: { category: true, stage: true, usd: true },
  });
  return summarise(rows);
}

export async function channelCostSummary(since: Date): Promise<CostSummary> {
  const rows = await prisma.costRecord.findMany({
    where: { createdAt: { gte: since } },
    select: { category: true, stage: true, usd: true },
  });
  return summarise(rows);
}

function summarise(rows: Array<{ category: string; stage: string; usd: Prisma.Decimal }>): CostSummary {
  const byCategory: Record<string, number> = {};
  const byStage: Record<string, number> = {};
  let totalUsd = 0;
  for (const r of rows) {
    const v = r.usd.toNumber();
    totalUsd += v;
    byCategory[r.category] = (byCategory[r.category] ?? 0) + v;
    byStage[r.stage] = (byStage[r.stage] ?? 0) + v;
  }
  return {
    totalUsd: round6(totalUsd),
    byCategory: mapValues(byCategory, round6),
    byStage: mapValues(byStage, round6),
  };
}

const round6 = (n: number) => Math.round(n * 1e6) / 1e6;
const mapValues = <T, U>(o: Record<string, T>, f: (v: T) => U): Record<string, U> =>
  Object.fromEntries(Object.entries(o).map(([k, v]) => [k, f(v)]));
