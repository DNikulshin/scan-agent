// Накопитель метрик одного прогона агента. Всё хранится в памяти,
// в конце run() вызывается flush() — INSERT в RunMetric.
//
// "sent" в этом контексте = enqueued (orders, для которых вызван
// enqueueNotifications). Реальная доставка считается в dashboard worker'е,
// см. /api/health/notifications.

import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";

import { logger } from "../utils/logger";
import type { AiUsage } from "../types";
import { prisma } from "./prisma";

type ScoreBucket = "0-2" | "3-4" | "5-6" | "7-8" | "9-10";

const SCORE_BUCKETS: ScoreBucket[] = ["0-2", "3-4", "5-6", "7-8", "9-10"];

function bucketOf(score: number): ScoreBucket {
  if (score <= 2) return "0-2";
  if (score <= 4) return "3-4";
  if (score <= 6) return "5-6";
  if (score <= 8) return "7-8";
  return "9-10";
}

export class RunMetrics {
  readonly runId = randomUUID();
  private readonly startedAt = new Date();

  private parsedTotal = 0;
  private parsedBySource: Record<string, number> = {};
  private parserDurations: Record<string, number> = {};

  private filtered = 0;
  private lowScoreKeyword = 0;
  private lowScoreAi = 0;

  private scoringCalls = 0;
  private pitchCalls = 0;
  private aiTokensIn = 0;
  private aiTokensOut = 0;
  private aiCostUsd = 0;

  private scoreHistogram: Record<ScoreBucket, number> = {
    "0-2": 0,
    "3-4": 0,
    "5-6": 0,
    "7-8": 0,
    "9-10": 0,
  };

  private enqueued = 0;
  private errors: Record<string, number> = {};

  setParserDuration(source: string, ms: number): void {
    this.parserDurations[source] = ms;
  }

  incParsed(source: string, count: number): void {
    this.parsedTotal += count;
    this.parsedBySource[source] = (this.parsedBySource[source] ?? 0) + count;
  }

  incFiltered(): void {
    this.filtered++;
  }

  incLowScoreKeyword(): void {
    this.lowScoreKeyword++;
  }

  incLowScoreAi(): void {
    this.lowScoreAi++;
  }

  incScoringCall(): void {
    this.scoringCalls++;
  }

  incPitchCall(n = 1): void {
    this.pitchCalls += n;
  }

  addAiUsage(u: AiUsage): void {
    this.aiTokensIn += u.tokensIn;
    this.aiTokensOut += u.tokensOut;
    this.aiCostUsd += u.costUsd;
  }

  recordScore(score: number): void {
    this.scoreHistogram[bucketOf(score)]++;
  }

  incEnqueued(): void {
    this.enqueued++;
  }

  incError(stage: string): void {
    this.errors[stage] = (this.errors[stage] ?? 0) + 1;
  }

  /** INSERT записи RunMetric в БД. Не бросает — логирует и продолжает. */
  async flush(): Promise<void> {
    const finishedAt = new Date();
    const durationMs = finishedAt.getTime() - this.startedAt.getTime();

    try {
      await prisma.runMetric.create({
        data: {
          startedAt: this.startedAt,
          finishedAt,
          durationMs,
          parsedTotal: this.parsedTotal,
          parsedBySource: this.parsedBySource as Prisma.InputJsonValue,
          filtered: this.filtered,
          lowScoreAi: this.lowScoreAi,
          lowScoreKeyword: this.lowScoreKeyword,
          sent: this.enqueued, // в outbox-эпохе sent = enqueued
          errors: this.errors as Prisma.InputJsonValue,
          scoringCalls: this.scoringCalls,
          pitchCalls: this.pitchCalls,
          aiTokensIn: this.aiTokensIn,
          aiTokensOut: this.aiTokensOut,
          aiCostUsd: new Prisma.Decimal(this.aiCostUsd.toFixed(6)),
          parserDurations: this.parserDurations as Prisma.InputJsonValue,
          scoreHistogram: this.scoreHistogram as unknown as Prisma.InputJsonValue,
          runId: this.runId,
        },
      });

      logger.info(
        {
          runId: this.runId,
          durationMs,
          parsed: this.parsedTotal,
          enqueued: this.enqueued,
          aiCostUsd: this.aiCostUsd.toFixed(4),
          tokens: this.aiTokensIn + this.aiTokensOut,
        },
        "RunMetric записан",
      );
    } catch (err) {
      logger.error({ err, runId: this.runId }, "Не удалось записать RunMetric");
    }
  }
}

export { SCORE_BUCKETS };
export type { ScoreBucket };
