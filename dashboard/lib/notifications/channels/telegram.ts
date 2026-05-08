// Канал Telegram для dispatcher'а: прямой вызов Bot API через fetch
// (без node-telegram-bot-api в dashboard — экономия зависимостей).
//
// Payload в БД — это TelegramMessage из src/notifiers/telegram-format.ts:
//   { text, parse_mode, link_preview_options, reply_markup? }
//
// Маппинг ошибок:
//   429  → RetryableError(retry_after) — Telegram прислал rate-limit
//   5xx  → RetryableError (временный сбой)
//   4xx  → FatalError (битый payload, неверный токен и т.п.)

import { FatalError, RetryableError } from "../errors";

interface TelegramPayload {
  text: string;
  parse_mode?: "HTML" | "MarkdownV2" | "Markdown";
  link_preview_options?: { is_disabled?: boolean };
  reply_markup?: unknown;
}

export async function sendTelegram(payload: TelegramPayload): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) {
    throw new FatalError("TELEGRAM_BOT_TOKEN/TELEGRAM_CHAT_ID не заданы");
  }

  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  const body = { chat_id: chatId, ...payload };

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (err) {
    // Сетевая ошибка / DNS / timeout — ретраим.
    throw new RetryableError(
      `network: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  if (res.ok) return;

  let detail: { description?: string; parameters?: { retry_after?: number } } =
    {};
  try {
    detail = (await res.json()) as typeof detail;
  } catch {
    // ignore — нет JSON-тела
  }

  const desc = detail.description ?? res.statusText;

  if (res.status === 429) {
    const retryAfter = detail.parameters?.retry_after;
    throw new RetryableError(`429 ${desc}`, retryAfter);
  }
  if (res.status >= 500) {
    throw new RetryableError(`${res.status} ${desc}`);
  }
  // 400/401/403/404 — нет смысла повторять.
  throw new FatalError(`${res.status} ${desc}`);
}
