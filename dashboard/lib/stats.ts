// Аггрегации для /stats и MD-экспорта. Один источник правды на оба роута.
//
// "sent" в RunMetric после миграции на outbox = enqueued. Реальная доставка
// (telegram/push) идёт асинхронно через worker и считается в /api/health/notifications.

import { prisma } from "./db";

export interface StatsKpi {
  totalParsed: number;
  totalEnqueued: number;
  totalApplied: number;
  totalWon: number;
  totalLost: number;
  winRate: number; // 0..1
  aiCostUsdTotal: number;
  aiTokensInTotal: number;
  aiTokensOutTotal: number;
  runsCount: number;
  avgRunDurationMs: number;
}

export interface FunnelStage {
  parsed: number;
  filtered: number;
  lowScoreKeyword: number;
  lowScoreAi: number;
  enqueued: number;
  applied: number;
  won: number;
}

export interface BySource {
  source: string;
  parsed: number;
  enqueued: number;
  applied: number;
  won: number;
}

export interface RecentRun {
  runId: string | null;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  parsedTotal: number;
  enqueued: number;
  errors: Record<string, number>;
}

export interface StatsPayload {
  kpi: StatsKpi;
  funnel: FunnelStage;
  scoreHistogram: Record<string, number>; // {"0-2": n, "3-4": n, ...}
  parserDurations: Record<string, number>; // средние ms по последним 30 runs
  parsedBySource: Record<string, number>; // суммарно за всё время
  enqueuedBySource: Record<string, number>;
  bySource: BySource[];
  recentRuns: RecentRun[];
  generatedAt: string;
}

const SCORE_BUCKETS = ["0-2", "3-4", "5-6", "7-8", "9-10"] as const;

export async function getStats(): Promise<StatsPayload> {
  const [runAgg, ordersByStatus, ordersByOutcome, ordersBySource, recentRunsRaw, allRuns] =
    await Promise.all([
      prisma.runMetric.aggregate({
        _sum: {
          parsedTotal: true,
          filtered: true,
          lowScoreAi: true,
          lowScoreKeyword: true,
          sent: true,
          scoringCalls: true,
          pitchCalls: true,
          aiTokensIn: true,
          aiTokensOut: true,
          aiCostUsd: true,
        },
        _avg: { durationMs: true },
        _count: { _all: true },
      }),
      prisma.order.groupBy({
        by: ["status"],
        _count: { _all: true },
      }),
      prisma.order.groupBy({
        by: ["outcome"],
        _count: { _all: true },
      }),
      prisma.order.groupBy({
        by: ["source", "status", "outcome"],
        _count: { _all: true },
      }),
      prisma.runMetric.findMany({
        orderBy: { startedAt: "desc" },
        take: 30,
        select: {
          runId: true,
          startedAt: true,
          finishedAt: true,
          durationMs: true,
          parsedTotal: true,
          sent: true,
          errors: true,
          parsedBySource: true,
          parserDurations: true,
          scoreHistogram: true,
        },
      }),
      prisma.runMetric.findMany({
        select: {
          parsedBySource: true,
          scoreHistogram: true,
        },
      }),
    ]);

  // KPI
  const sums = runAgg._sum;
  const totalApplied =
    ordersByStatus.find((r) => r.status === "applied")?._count._all ?? 0;
  const totalWon =
    ordersByOutcome.find((r) => r.outcome === "won")?._count._all ?? 0;
  const totalLost =
    ordersByOutcome.find((r) => r.outcome === "lost")?._count._all ?? 0;
  const winRate = totalWon + totalLost > 0 ? totalWon / (totalWon + totalLost) : 0;

  const kpi: StatsKpi = {
    totalParsed: sums.parsedTotal ?? 0,
    totalEnqueued: sums.sent ?? 0,
    totalApplied,
    totalWon,
    totalLost,
    winRate,
    aiCostUsdTotal: Number(sums.aiCostUsd ?? 0),
    aiTokensInTotal: sums.aiTokensIn ?? 0,
    aiTokensOutTotal: sums.aiTokensOut ?? 0,
    runsCount: runAgg._count._all,
    avgRunDurationMs: Math.round(runAgg._avg.durationMs ?? 0),
  };

  // Воронка: parsed/filtered/lowScore — из RunMetric, applied/won — из Order
  const funnel: FunnelStage = {
    parsed: kpi.totalParsed,
    filtered: sums.filtered ?? 0,
    lowScoreKeyword: sums.lowScoreKeyword ?? 0,
    lowScoreAi: sums.lowScoreAi ?? 0,
    enqueued: kpi.totalEnqueued,
    applied: totalApplied,
    won: totalWon,
  };

  // Score histogram (суммарно по всем RunMetric)
  const scoreHistogram: Record<string, number> = Object.fromEntries(
    SCORE_BUCKETS.map((b) => [b, 0]),
  );
  for (const r of allRuns) {
    const h = (r.scoreHistogram ?? {}) as Record<string, number>;
    for (const b of SCORE_BUCKETS) {
      scoreHistogram[b] += Number(h[b] ?? 0);
    }
  }

  // parsedBySource — суммарно за всё время
  const parsedBySource: Record<string, number> = {};
  for (const r of allRuns) {
    const ps = (r.parsedBySource ?? {}) as Record<string, number>;
    for (const [src, n] of Object.entries(ps)) {
      parsedBySource[src] = (parsedBySource[src] ?? 0) + Number(n);
    }
  }

  // parserDurations — средние по последним 30 прогонам (только успешные парсеры)
  const parserDurations: Record<string, { sum: number; n: number }> = {};
  for (const r of recentRunsRaw) {
    const pd = (r.parserDurations ?? {}) as Record<string, number>;
    for (const [src, ms] of Object.entries(pd)) {
      const acc = parserDurations[src] ?? { sum: 0, n: 0 };
      acc.sum += Number(ms);
      acc.n += 1;
      parserDurations[src] = acc;
    }
  }
  const parserDurationsAvg: Record<string, number> = {};
  for (const [src, { sum, n }] of Object.entries(parserDurations)) {
    parserDurationsAvg[src] = n > 0 ? Math.round(sum / n) : 0;
  }

  // bySource: для каждого source считаем applied / won
  const bySourceMap: Record<string, BySource> = {};
  for (const src of Object.keys(parsedBySource)) {
    bySourceMap[src] = {
      source: src,
      parsed: parsedBySource[src],
      enqueued: 0,
      applied: 0,
      won: 0,
    };
  }
  // enqueued by source: из orders с непустым hook/pitch не вычислить точно
  // (low-score тоже сохраняются как processed, но без enqueue). Пропустим для
  // первой версии — оставим bySource без enqueued, KPI выдаёт total в kpi.totalEnqueued.
  for (const row of ordersBySource) {
    const src = row.source;
    if (!bySourceMap[src]) {
      bySourceMap[src] = { source: src, parsed: 0, enqueued: 0, applied: 0, won: 0 };
    }
    if (row.status === "applied") {
      bySourceMap[src].applied += row._count._all;
    }
    if (row.outcome === "won") {
      bySourceMap[src].won += row._count._all;
    }
  }
  const bySource = Object.values(bySourceMap).sort(
    (a, b) => b.parsed - a.parsed,
  );

  // enqueuedBySource — пока 0 (если нужно — добавим колонку в RunMetric.parsedBySource → enqueuedBySource)
  const enqueuedBySource: Record<string, number> = {};

  const recentRuns: RecentRun[] = recentRunsRaw.map((r) => ({
    runId: r.runId,
    startedAt: r.startedAt.toISOString(),
    finishedAt: r.finishedAt.toISOString(),
    durationMs: r.durationMs,
    parsedTotal: r.parsedTotal,
    enqueued: r.sent,
    errors: (r.errors ?? {}) as Record<string, number>,
  }));

  return {
    kpi,
    funnel,
    scoreHistogram,
    parserDurations: parserDurationsAvg,
    parsedBySource,
    enqueuedBySource,
    bySource,
    recentRuns,
    generatedAt: new Date().toISOString(),
  };
}
