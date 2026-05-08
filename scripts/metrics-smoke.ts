// Sanity-check для RunMetrics. Запуск: npm run dev-script -- scripts/metrics-smoke.ts
// или просто: env -u HTTP_PROXY ... tsx scripts/metrics-smoke.ts

import "dotenv/config";

import { prisma } from "../src/core/prisma";
import { RunMetrics } from "../src/core/metrics";

async function main() {
  const before = await prisma.runMetric.count();

  const m = new RunMetrics();
  m.setParserDuration("kwork", 1234);
  m.setParserDuration("fl", 8765);
  m.incParsed("kwork", 5);
  m.incParsed("fl", 3);
  m.incFiltered();
  m.incFiltered();
  m.incLowScoreKeyword();
  m.incLowScoreAi();
  m.incScoringCall();
  m.incScoringCall();
  m.incPitchCall(2);
  m.addAiUsage({ tokensIn: 1500, tokensOut: 300, costUsd: 0.0042 });
  m.recordScore(2);
  m.recordScore(8);
  m.recordScore(10);
  m.incEnqueued();
  m.incError("scoring");

  await m.flush();

  const after = await prisma.runMetric.count();
  const last = await prisma.runMetric.findFirst({ orderBy: { createdAt: "desc" } });

  console.log(JSON.stringify({ before, after, delta: after - before, last }, null, 2));

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
