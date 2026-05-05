// Smoke-test: создаёт фейковый ScoredOrder и кладёт его в outbox
// (notification_jobs) через enqueueNotifications. Не дёргает OpenRouter
// и парсеры — нужен только чтобы убедиться что job'ы пишутся в БД.
//
// Использование:
//   env -u HTTP_PROXY -u HTTPS_PROXY -u http_proxy -u https_proxy npx tsx scripts/enqueue-smoke.ts

import "dotenv/config";

import { enqueueNotifications } from "../src/core/notifications";
import { prisma } from "../src/core/prisma";
import type { ScoredOrder } from "../src/types";

async function main() {
  const before = await prisma.notificationJob.count();
  const subs = await prisma.pushSubscription.count();

  const scored: ScoredOrder = {
    order: {
      id: `smoke-${Date.now()}`,
      title: "TEST: smoke-проверка outbox",
      desc: "Это тестовый заказ — не должен попасть в Telegram при работе worker'а в проде",
      price: "1₽",
      link: "https://example.com",
      offersCount: 0,
      source: "kwork",
    },
    score: { score: 1, reason: "smoke-test" },
    pitch: { hook: "h", pitch: "p" },
    pitchB: null,
    tags: ["smoke"],
  };

  const result = await enqueueNotifications(scored);
  const after = await prisma.notificationJob.count();

  console.log({
    pushSubscriptions: subs,
    enqueued: result,
    notification_jobs: { before, after, delta: after - before },
  });

  // Очищаем тестовые job'ы, чтобы worker не пытался их доставить
  const cleanup = await prisma.notificationJob.deleteMany({
    where: { orderId: scored.order.id },
  });
  console.log({ cleaned_up: cleanup.count });
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
