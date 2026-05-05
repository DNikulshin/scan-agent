// Pure форматтеры Telegram-сообщений: HTML-текст + inline keyboard.
// Используются:
//   - агентом (src/core/notifications.ts) для построения payload outbox-job;
//   - dashboard worker'ом (dashboard/lib/notifications/channels/telegram.ts)
//     для отправки через Telegram Bot API.
//
// Ничего не отправляет, ничего не читает из БД — только форматирует.

import { config } from "../config";
import type { ReminderOrder } from "../core/storage";
import type { ScoredOrder } from "../types";

const SOURCE_LABEL: Record<string, string> = {
  kwork: "Kwork",
  fl: "FL.ru",
  freelanceru: "Freelance.ru",
  habr: "Habr",
  hh: "HH.ru",
};

export interface InlineButton {
  text: string;
  callback_data: string;
}

export interface TelegramMessage {
  text: string;
  parse_mode: "HTML";
  link_preview_options: { is_disabled: true };
  reply_markup?: { inline_keyboard: InlineButton[][] };
}

export function esc(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function buildOrderMessage(scored: ScoredOrder): TelegramMessage {
  if (scored.order.source === "hh") return formatVacancy(scored);
  if (scored.order.source === "fl" && !config.fl.generatePitch) {
    return formatFlOrder(scored);
  }
  return formatFreelanceOrder(scored);
}

export function buildReminderMessage(order: ReminderOrder): TelegramMessage {
  const source = SOURCE_LABEL[order.source] ?? order.source;
  const stars = "⭐".repeat(Math.min(Math.round(order.score / 2), 5));

  const lines: string[] = [
    `⏰ <b>Напоминание</b> — заказ ещё не рассмотрен`,
    ``,
    `🔥 <b>${esc(order.title)}</b>`,
    `${stars} Оценка: <b>${order.score}/10</b> | 🏪 ${source}`,
  ];

  if (order.pitch) {
    lines.push(``, `✍️ <code>${esc(order.pitch)}</code>`);
  }
  lines.push(``, `🔗 <a href="${order.link}">${esc(order.title)}</a>`);

  return {
    text: lines.join("\n"),
    parse_mode: "HTML",
    link_preview_options: { is_disabled: true },
    reply_markup: {
      inline_keyboard: [
        [
          {
            text: "⏭ Пропустить",
            callback_data: `skip:${order.source}:${order.order_id}`,
          },
        ],
      ],
    },
  };
}

function formatFlOrder(scored: ScoredOrder): TelegramMessage {
  const { order, score } = scored;
  const stars = "⭐".repeat(Math.min(Math.round(score.score / 2), 5));
  const tags = scored.tags?.length ? scored.tags.join(", ") : null;

  const lines: string[] = [
    `🔵 <b>${esc(order.title)}</b>`,
    ``,
    `💰 Бюджет: ${esc(order.price)}`,
    `📊 Предложений: ${order.offersCount} | 🏪 FL.ru`,
    `${stars} Оценка: <b>${score.score}/10</b>`,
    ``,
    `🧠 <b>Почему брать:</b>`,
    esc(score.reason),
  ];

  if (order.desc) {
    lines.push(
      ``,
      `📝 ${esc(order.desc.slice(0, 200))}${order.desc.length > 200 ? "..." : ""}`,
    );
  }

  if (tags) {
    lines.push(``, `🏷️ ${esc(tags)}`);
  }

  lines.push(``, `🔗 <a href="${order.link}">Открыть на FL.ru</a>`);

  return {
    text: lines.join("\n"),
    parse_mode: "HTML",
    link_preview_options: { is_disabled: true },
    reply_markup: {
      inline_keyboard: [
        [
          {
            text: "⏭ Пропустить",
            callback_data: `skip:${order.source}:${order.id}`,
          },
        ],
      ],
    },
  };
}

function formatFreelanceOrder(scored: ScoredOrder): TelegramMessage {
  const { order, score, pitch } = scored;
  const source = SOURCE_LABEL[order.source] ?? order.source;
  const stars = "⭐".repeat(Math.min(Math.round(score.score / 2), 5));
  const hasPitchB = !!scored.pitchB;

  const lines: string[] = [
    `🔥 <b>${esc(order.title)}</b>`,
    ``,
    `💰 Бюджет: ${esc(order.price)}`,
    `📊 Предложений: ${order.offersCount} | 🏪 ${source}`,
    `${stars} Оценка: <b>${score.score}/10</b>`,
    ``,
    `🧠 <b>Почему брать:</b>`,
    esc(score.reason),
    ``,
    `✍️ <b>Вариант 1</b> <i>(тап — скопировать):</i>`,
    `<code>${esc(pitch.hook)}\n\n${esc(pitch.pitch)}</code>`,
  ];

  if (hasPitchB) {
    lines.push(
      ``,
      `✍️ <b>Вариант 2</b>`,
      `<code>${esc(scored.pitchB!.hook)}\n\n${esc(scored.pitchB!.pitch)}</code>`,
    );
  }

  lines.push(``, `🔗 <a href="${order.link}">${esc(order.title)}</a>`);

  const callbackSkip = `skip:${order.source}:${order.id}`;
  const inline_keyboard = hasPitchB
    ? [
        [
          {
            text: "✅ Вариант 1",
            callback_data: `pick1:${order.source}:${order.id}`,
          },
          {
            text: "✅ Вариант 2",
            callback_data: `pick2:${order.source}:${order.id}`,
          },
        ],
        [{ text: "⏭ Пропустить", callback_data: callbackSkip }],
      ]
    : [[{ text: "⏭ Пропустить", callback_data: callbackSkip }]];

  return {
    text: lines.join("\n"),
    parse_mode: "HTML",
    link_preview_options: { is_disabled: true },
    reply_markup: { inline_keyboard },
  };
}

function formatVacancy(scored: ScoredOrder): TelegramMessage {
  const { order, score } = scored;
  const employer = order.meta?.employer ?? "";
  const city = order.meta?.city ?? "";

  const starCount = Math.min(5, Math.round(score.score / 2));
  const stars = starCount > 0 ? "⭐".repeat(starCount) : "☆";

  const lines: (string | null)[] = [
    `💼 <b>${esc(order.title)}</b>`,
    ``,
    employer ? `🏢 ${esc(employer)}` : null,
    city ? `📍 ${esc(city)}` : null,
    `💰 Зарплата: ${esc(order.price)}`,
    ``,
    `${stars} Keyword score: <b>${score.score}/10</b>`,
    score.reason ? `🎯 <i>${esc(score.reason)}</i>` : null,
    ``,
    `🔗 <a href="${order.link}">Открыть вакансию на HH</a>`,
  ];

  return {
    text: lines.filter(Boolean).join("\n"),
    parse_mode: "HTML",
    link_preview_options: { is_disabled: true },
    reply_markup: {
      inline_keyboard: [
        [
          {
            text: "⏭ Пропустить",
            callback_data: `skip:${order.source}:${order.id}`,
          },
        ],
      ],
    },
  };
}
