import { Bot } from "grammy";
import { config } from "../config";
import { logger } from "../utils/logger";
import type {
  Storage,
  ReminderOrder,
  StatsResult,
  DynamicSettings,
} from "../core/storage";
import type { ScoredOrder, Notifier } from "../types";
import {
  buildOrderMessage,
  buildReminderMessage,
  esc,
} from "./telegram-format";

export class TelegramNotifier implements Notifier {
  name = "telegram";
  private bot: Bot;
  private storage: Storage | null;

  constructor(storage?: Storage) {
    this.bot = new Bot(config.telegram.botToken);
    this.storage = storage ?? null;
  }

  async send(scored: ScoredOrder): Promise<void> {
    const msg = buildOrderMessage(scored);
    await this.bot.api.sendMessage(config.telegram.chatId, msg.text, {
      parse_mode: msg.parse_mode,
      link_preview_options: msg.link_preview_options,
      reply_markup: msg.reply_markup,
    });
    logger.info(
      {
        orderId: scored.order.id,
        source: scored.order.source,
        score: scored.score.score,
      },
      "Уведомление отправлено в Telegram",
    );
  }

  async sendReminder(order: ReminderOrder): Promise<void> {
    const msg = buildReminderMessage(order);
    await this.bot.api.sendMessage(config.telegram.chatId, msg.text, {
      parse_mode: msg.parse_mode,
      link_preview_options: msg.link_preview_options,
      reply_markup: msg.reply_markup,
    });
    logger.info(
      { orderId: order.order_id, source: order.source },
      "Напоминание отправлено в Telegram",
    );
  }

  startCallbackListener(): void {
    if (!this.storage) {
      logger.warn("Storage не передан — callback-кнопки не будут работать");
      return;
    }

    this.bot.catch((err) => {
      logger.error({ err: err.error }, "Ошибка Telegram-бота");
    });

    this.bot.on("message:text", async (ctx) => {
      const storage = this.storage;
      const text = ctx.message.text.trim();
      if (!storage || !text.startsWith("/")) return;
      const chatId = config.telegram.chatId;

      try {
        if (text === "/stats") {
          const settings = await storage.getSettings();
          const stats = await storage.getStats(settings.minScore);
          await this.bot.api.sendMessage(chatId, formatStats(stats), {
            parse_mode: "HTML",
          });
        } else if (text === "/settings") {
          const settings = await storage.getSettings();
          await this.bot.api.sendMessage(chatId, formatSettings(settings), {
            parse_mode: "HTML",
          });
        } else if (text.startsWith("/setrate ")) {
          const val = parseInt(text.slice(9).trim(), 10);
          if (isNaN(val) || val < 0)
            throw new Error("Неверное значение. Пример: /setrate 2000");
          await storage.setSetting("minPrice", String(val));
          await this.bot.api.sendMessage(
            chatId,
            `✅ Мин. бюджет: <b>${val}₽</b>`,
            { parse_mode: "HTML" },
          );
        } else if (text.startsWith("/setscore ")) {
          const val = parseInt(text.slice(10).trim(), 10);
          if (isNaN(val) || val < 0 || val > 10)
            throw new Error("Неверное значение (0–10). Пример: /setscore 7");
          await storage.setSetting("minScore", String(val));
          await this.bot.api.sendMessage(
            chatId,
            `✅ Мин. балл: <b>${val}/10</b>`,
            { parse_mode: "HTML" },
          );
        } else if (text === "/setstop list") {
          const { stopWords } = await storage.getSettings();
          const list = stopWords
            .map((w, i) => `${i + 1}. ${esc(w)}`)
            .join("\n");
          await this.bot.api.sendMessage(
            chatId,
            `🚫 <b>Стоп-слова:</b>\n${list || "(список пуст)"}`,
            { parse_mode: "HTML" },
          );
        } else if (text.startsWith("/setstop add ")) {
          const word = text.slice(13).trim().toLowerCase();
          if (!word)
            throw new Error("Укажите слово. Пример: /setstop add реферат");
          const settings = await storage.getSettings();
          if (!settings.stopWords.includes(word)) {
            settings.stopWords.push(word);
            await storage.setSetting(
              "stopWords",
              JSON.stringify(settings.stopWords),
            );
          }
          await this.bot.api.sendMessage(
            chatId,
            `✅ Стоп-слово добавлено: <b>${esc(word)}</b>`,
            { parse_mode: "HTML" },
          );
        } else if (text.startsWith("/setstop remove ")) {
          const word = text.slice(16).trim().toLowerCase();
          if (!word)
            throw new Error("Укажите слово. Пример: /setstop remove реферат");
          const settings = await storage.getSettings();
          settings.stopWords = settings.stopWords.filter((w) => w !== word);
          await storage.setSetting(
            "stopWords",
            JSON.stringify(settings.stopWords),
          );
          await this.bot.api.sendMessage(
            chatId,
            `✅ Стоп-слово удалено: <b>${esc(word)}</b>`,
            { parse_mode: "HTML" },
          );
        }
      } catch (err) {
        const errMsg =
          err instanceof Error ? err.message : "Неизвестная ошибка";
        await this.bot.api
          .sendMessage(chatId, `❌ ${esc(errMsg)}`)
          .catch(() => {});
        logger.error({ err, text }, "Ошибка обработки команды");
      }
    });

    this.bot.on("callback_query:data", async (ctx) => {
      const storage = this.storage;
      const data = ctx.callbackQuery.data;
      if (!storage || !data) return;

      const parts = data.split(":");
      if (parts.length < 3) return;
      const [action, source, ...idParts] = parts;
      const orderId = idParts.join(":");

      if (action === "skip") {
        try {
          await storage.blacklist(orderId, source);
          await ctx.answerCallbackQuery({ text: "✅ Добавлен в blacklist" });

          if (ctx.callbackQuery.message) {
            const original = ctx.callbackQuery.message.text ?? "";
            await ctx
              .editMessageText(original + "\n\n❌ Пропущен")
              .catch(() => {});
          }
        } catch (err) {
          logger.error({ err, orderId, source }, "Ошибка обработки skip");
          await ctx
            .answerCallbackQuery({ text: "❌ Ошибка" })
            .catch(() => {});
        }
      } else if (action === "pick1" || action === "pick2") {
        try {
          const variant = action === "pick1" ? "a" : "b";
          await storage.choosePitch(orderId, source, variant);

          const label = action === "pick1" ? "Вариант 1" : "Вариант 2";
          await ctx.answerCallbackQuery({ text: `✅ Выбран ${label}` });

          if (ctx.callbackQuery.message) {
            await ctx
              .editMessageReplyMarkup({
                reply_markup: {
                  inline_keyboard: [
                    [{ text: `✅ Выбран ${label}`, callback_data: "noop" }],
                  ],
                },
              })
              .catch(() => {});
          }
        } catch (err) {
          logger.error(
            { err, orderId, source, action },
            "Ошибка обработки pick",
          );
          await ctx
            .answerCallbackQuery({ text: "❌ Ошибка" })
            .catch(() => {});
        }
      }
    });

    void this.bot
      .start({ drop_pending_updates: false })
      .catch((err) => logger.error({ err }, "Telegram polling остановлен"));
    logger.info("Telegram callback listener запущен");
  }

  stopCallbackListener(): void {
    this.bot.stop();
  }
}

function formatSettings(s: DynamicSettings): string {
  return [
    `⚙️ <b>Настройки агента</b>`,
    ``,
    `💰 Мин. бюджет: <b>${s.minPrice}₽</b>`,
    `⭐ Мин. балл: <b>${s.minScore}/10</b>`,
    `🔢 Макс. предложений: <b>${s.maxOffers}</b>`,
    `🚫 Стоп-слов: <b>${s.stopWords.length}</b>`,
    ``,
    `<i>Команды:</i>`,
    `/setrate &lt;сумма&gt;`,
    `/setscore &lt;0-10&gt;`,
    `/setstop list | add &lt;слово&gt; | remove &lt;слово&gt;`,
  ].join("\n");
}

function formatStats(s: StatsResult): string {
  return [
    `📊 <b>Статистика агента</b>`,
    ``,
    `📅 <b>Сегодня:</b>`,
    `  • Просканировано: ${s.today_total ?? 0}`,
    `  • Отправлено (score ≥ ${config.filter.minScore}): ${s.today_sent ?? 0}`,
    `  • Пропущено: ${s.today_skipped ?? 0}`,
    ``,
    `📆 <b>За неделю:</b>`,
    `  • Просканировано: ${s.week_total ?? 0}`,
    `  • Отправлено: ${s.week_sent ?? 0}`,
    `  • Пропущено: ${s.week_skipped ?? 0}`,
    `  • Средний скор: ${s.week_avg_score ?? "—"}`,
    ``,
    `💾 В базе: ${s.total_count} заказов`,
  ].join("\n");
}
