// Outbox для уведомлений: агент пишет sync, dashboard worker доставляет async.
//
// enqueueNotifications(scored):
//   - в одной транзакции upsert'ит Order (помечает processed) и создаёт
//     NotificationJob записи (1 на telegram + N на push, по одной на endpoint).
//   - если push-подписок нет — создаётся только telegram-job.
//   - возвращает количество созданных job'ов (для логирования).
//
// enqueueReminder(order):
//   - один telegram-job с pre-built reminder payload.
//
// Job не отправляются здесь — это делает dashboard worker
// (см. dashboard/lib/notifications/dispatcher.ts).

import type { Prisma } from "@prisma/client";

import { logger } from "../utils/logger";
import type { ReminderOrder } from "./storage";
import type { ScoredOrder } from "../types";
import {
  buildOrderMessage,
  buildReminderMessage,
} from "../notifiers/telegram-format";
import { prisma } from "./prisma";

interface EnqueueResult {
  telegramJobs: number;
  pushJobs: number;
}

export async function enqueueNotifications(
  scored: ScoredOrder,
): Promise<EnqueueResult> {
  const order = scored.order;

  const telegramPayload = buildOrderMessage(scored);

  const pushPayload = {
    title: `Новый заказ: ${order.title}`,
    body: `Оценка: ${scored.score.score}/10`,
    icon: "/icons/icon-192.svg",
    data: { orderId: order.id, source: order.source, link: order.link },
  };

  const subs = await prisma.pushSubscription.findMany({
    select: { endpoint: true, p256dh: true, auth: true },
  });

  const jobs: Prisma.NotificationJobCreateManyInput[] = [
    {
      channel: "telegram",
      target: null,
      payload: telegramPayload as unknown as Prisma.InputJsonValue,
      orderId: order.id,
    },
    ...subs.map((sub) => ({
      channel: "push",
      target: sub.endpoint,
      payload: {
        ...pushPayload,
        subscription: {
          endpoint: sub.endpoint,
          keys: { p256dh: sub.p256dh, auth: sub.auth },
        },
      } as unknown as Prisma.InputJsonValue,
      orderId: order.id,
    })),
  ];

  const result = await prisma.notificationJob.createMany({ data: jobs });

  logger.info(
    {
      orderId: order.id,
      source: order.source,
      telegramJobs: 1,
      pushJobs: subs.length,
      total: result.count,
    },
    "Enqueued notification jobs",
  );

  return { telegramJobs: 1, pushJobs: subs.length };
}

export async function enqueueReminder(order: ReminderOrder): Promise<void> {
  const payload = buildReminderMessage(order);
  await prisma.notificationJob.create({
    data: {
      channel: "telegram",
      target: null,
      payload: payload as unknown as Prisma.InputJsonValue,
      orderId: null,
    },
  });
  logger.info(
    { orderId: order.order_id, source: order.source },
    "Enqueued reminder job",
  );
}
