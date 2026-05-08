// Канал Web Push: web-push с TTL=30d, urgency=high, topic=orderId.
// Payload в БД:
//   { title, body, icon, data, subscription: { endpoint, keys: { p256dh, auth } } }
//
// Маппинг ошибок:
//   410/404/403 → подписка мёртвая → удалить + FatalError (не ретраим)
//   429/5xx     → RetryableError
//   timeout/net → RetryableError

import webpush from "web-push";

import { prisma } from "@/lib/db";
import { FatalError, RetryableError } from "../errors";

interface PushPayload {
  title: string;
  body: string;
  icon?: string;
  data?: Record<string, unknown>;
  subscription: {
    endpoint: string;
    keys: { p256dh: string; auth: string };
  };
}

let vapidConfigured = false;
function ensureVapid(): void {
  if (vapidConfigured) return;
  const publicKey =
    process.env.VAPID_PUBLIC_KEY ??
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ??
    "";
  const privateKey = process.env.VAPID_PRIVATE_KEY ?? "";
  const subject = process.env.VAPID_SUBJECT ?? "mailto:admin@example.com";
  if (!publicKey || !privateKey) {
    throw new FatalError("VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY не заданы");
  }
  webpush.setVapidDetails(subject, publicKey, privateKey);
  vapidConfigured = true;
}

export async function sendPush(
  payload: PushPayload,
  orderId: string | null,
): Promise<void> {
  ensureVapid();

  const { subscription, ...notification } = payload;

  const options: webpush.RequestOptions = {
    TTL: 2592000, // 30 дней — push-сервис буферизует офлайн-устройство
    headers: { Urgency: "high" },
  };
  if (orderId) {
    // topic должен быть base64url, ≤32 символа. uuid с дефисами длиной 36 — сократим.
    const topic = orderId.replace(/-/g, "").slice(0, 32);
    (options.headers as Record<string, string>).Topic = topic;
  }

  try {
    await webpush.sendNotification(
      subscription,
      JSON.stringify(notification),
      options,
    );
  } catch (err: unknown) {
    const e = err as {
      statusCode?: number;
      body?: string;
      message?: string;
    };
    const status = e.statusCode;

    if (status === 410 || status === 404 || status === 403) {
      await prisma.pushSubscription
        .deleteMany({ where: { endpoint: subscription.endpoint } })
        .catch(() => {});
      throw new FatalError(
        `${status} subscription gone (${e.body ?? e.message ?? ""})`,
      );
    }

    if (status === 429 || (status !== undefined && status >= 500)) {
      throw new RetryableError(`${status} ${e.body ?? e.message ?? ""}`);
    }

    if (status === undefined) {
      // Сетевая ошибка / timeout
      throw new RetryableError(
        `network: ${e.message ?? "unknown error"}`,
      );
    }

    // Прочие 4xx — фатально (битый payload, неверный VAPID).
    throw new FatalError(`${status} ${e.body ?? e.message ?? ""}`);
  }
}
