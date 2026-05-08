// Dispatcher для outbox'а уведомлений.
//
// Контракт:
//   - poll-loop раз в pollIntervalMs (def 5000) забирает батч pending-job'ов;
//   - claimBatch — атомарный UPDATE с SELECT FOR UPDATE SKIP LOCKED, безопасен
//     при нескольких репликах dashboard'а;
//   - также подбирает зависшие 'sending' с lockedAt < now() - STUCK_AFTER (15 мин);
//   - on success → status='done', doneAt=now();
//   - on RetryableError → status='pending', nextAttemptAt = now() + backoff(attempts),
//     если attempts < maxAttempts; иначе 'failed';
//   - on FatalError    → status='failed' сразу;
//   - per-channel изоляция: ошибка в push не влияет на telegram-job в том же батче.
//
// Singleton — через globalThis guard (Next.js hot-reload не плодит интервалы).

import { randomUUID } from "node:crypto";

import { prisma } from "@/lib/db";
import { FatalError, RetryableError } from "./errors";
import { sendTelegram } from "./channels/telegram";
import { sendPush } from "./channels/push";

const POLL_INTERVAL_MS = Number(
  process.env.NOTIFICATIONS_POLL_INTERVAL_MS ?? 5000,
);
const BATCH_LIMIT = Number(process.env.NOTIFICATIONS_BATCH_LIMIT ?? 20);
// Сколько ждать прежде чем считать 'sending'-job зависшей и подобрать заново.
const STUCK_AFTER_MS = 15 * 60 * 1000;

// Backoff: [30s, 1m, 5m, 15m, 1h, 6h, 24h, 24h]
const BACKOFF_SEC = [30, 60, 300, 900, 3600, 21600, 86400, 86400];

interface ClaimedJob {
  id: string;
  channel: string;
  target: string | null;
  payload: unknown;
  order_id: string | null;
  attempts: number;
  max_attempts: number;
}

interface DispatcherHandle {
  stop: () => void;
  workerId: string;
}

const globalForDispatcher = globalThis as unknown as {
  __notificationsDispatcher?: DispatcherHandle;
};

export function startDispatcher(): DispatcherHandle {
  if (globalForDispatcher.__notificationsDispatcher) {
    return globalForDispatcher.__notificationsDispatcher;
  }

  const workerId = `dashboard-${randomUUID().slice(0, 8)}`;
  let stopped = false;
  let timer: NodeJS.Timeout | null = null;

  const tick = async (): Promise<void> => {
    if (stopped) return;
    try {
      const jobs = await claimBatch(workerId, BATCH_LIMIT);
      if (jobs.length > 0) {
        const results = await Promise.allSettled(jobs.map(processJob));
        const errors = results.filter((r) => r.status === "rejected").length;
        const counts = jobs.reduce<Record<string, number>>((acc, j) => {
          acc[j.channel] = (acc[j.channel] ?? 0) + 1;
          return acc;
        }, {});
        const summary = Object.entries(counts)
          .map(([k, v]) => `${k}=${v}`)
          .join(", ");
        console.log(
          `[dispatcher] processed batch: ${summary}, errors=${errors}`,
        );
      }
    } catch (err) {
      console.error("[dispatcher] tick error:", err);
    } finally {
      if (!stopped) {
        timer = setTimeout(tick, POLL_INTERVAL_MS);
      }
    }
  };

  console.log(
    `[dispatcher] started worker=${workerId}, polling every ${POLL_INTERVAL_MS}ms`,
  );
  // Первый прогон — чуть отложенно, чтобы не блокировать boot.
  timer = setTimeout(tick, 1000);

  const handle: DispatcherHandle = {
    workerId,
    stop: () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      delete globalForDispatcher.__notificationsDispatcher;
      console.log(`[dispatcher] stopped worker=${workerId}`);
    },
  };

  globalForDispatcher.__notificationsDispatcher = handle;
  return handle;
}

async function claimBatch(
  workerId: string,
  limit: number,
): Promise<ClaimedJob[]> {
  // Один запрос: атомарно берём batch (pending или зависшие sending),
  // помечаем 'sending', инкрементируем attempts.
  const rows = await prisma.$queryRaw<ClaimedJob[]>`
    UPDATE notification_jobs
       SET status = 'sending',
           locked_at = now(),
           locked_by = ${workerId},
           attempts = attempts + 1
     WHERE id IN (
       SELECT id FROM notification_jobs
        WHERE (status = 'pending' AND next_attempt_at <= now())
           OR (status = 'sending' AND locked_at < now() - (${STUCK_AFTER_MS} || ' milliseconds')::interval)
        ORDER BY next_attempt_at
        FOR UPDATE SKIP LOCKED
        LIMIT ${limit}
     )
     RETURNING id, channel, target, payload, order_id, attempts, max_attempts
  `;
  return rows;
}

async function processJob(job: ClaimedJob): Promise<void> {
  try {
    await dispatchByChannel(job);
    await prisma.notificationJob.update({
      where: { id: job.id },
      data: {
        status: "done",
        doneAt: new Date(),
        lastError: null,
      },
    });
  } catch (err) {
    await handleFailure(job, err);
  }
}

async function dispatchByChannel(job: ClaimedJob): Promise<void> {
  switch (job.channel) {
    case "telegram":
      await sendTelegram(
        job.payload as Parameters<typeof sendTelegram>[0],
      );
      return;
    case "push":
      await sendPush(
        job.payload as Parameters<typeof sendPush>[0],
        job.order_id,
      );
      return;
    default:
      throw new FatalError(`unknown channel '${job.channel}'`);
  }
}

async function handleFailure(job: ClaimedJob, err: unknown): Promise<void> {
  const message = err instanceof Error ? err.message : String(err);
  const isFatal = err instanceof FatalError;
  const exhausted = job.attempts >= job.max_attempts;
  const shouldFail = isFatal || exhausted;

  if (shouldFail) {
    await prisma.notificationJob.update({
      where: { id: job.id },
      data: {
        status: "failed",
        lastError: message.slice(0, 1000),
        doneAt: new Date(),
      },
    });
    console.error(
      `[dispatcher] job ${job.id} (${job.channel}) FAILED after ${job.attempts} attempts: ${message}`,
    );
    return;
  }

  // Retry: запланировать следующую попытку.
  const retryable = err instanceof RetryableError ? err : null;
  const baseBackoff =
    BACKOFF_SEC[Math.min(job.attempts - 1, BACKOFF_SEC.length - 1)] ??
    BACKOFF_SEC[BACKOFF_SEC.length - 1];
  const delaySec = retryable?.retryAfterSec
    ? Math.max(retryable.retryAfterSec, 1)
    : baseBackoff;
  const nextAt = new Date(Date.now() + delaySec * 1000);

  await prisma.notificationJob.update({
    where: { id: job.id },
    data: {
      status: "pending",
      nextAttemptAt: nextAt,
      lastError: message.slice(0, 1000),
      lockedAt: null,
      lockedBy: null,
    },
  });
  console.warn(
    `[dispatcher] job ${job.id} (${job.channel}) retry in ${delaySec}s (attempt ${job.attempts}/${job.max_attempts}): ${message}`,
  );
}
