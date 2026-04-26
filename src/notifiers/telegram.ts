import TelegramBot from 'node-telegram-bot-api';
import { config } from '../config';
import { logger } from '../utils/logger';
import type { Storage, ReminderOrder, StatsResult, DynamicSettings } from '../core/storage';
import type { ScoredOrder, Notifier } from '../types';

const SOURCE_LABEL: Record<string, string> = {
  kwork: 'Kwork',
  fl: 'FL.ru',
  freelanceru: 'Freelance.ru',
  habr: 'Habr',
  hh: 'HH.ru',
};

type PitchChoosenCallback = (orderId: string, source: string, hook: string, pitch: string) => Promise<void>;

export class TelegramNotifier implements Notifier {
  name = 'telegram';
  private bot: TelegramBot;
  private storage: Storage | null;
  private onPitchChosen: PitchChoosenCallback | null;

  constructor(storage?: Storage, onPitchChosen?: PitchChoosenCallback) {
    this.bot = new TelegramBot(config.telegram.botToken, { polling: false });
    this.storage = storage ?? null;
    this.onPitchChosen = onPitchChosen ?? null;
  }

  async send(scored: ScoredOrder): Promise<void> {
    if (scored.order.source === 'hh') {
      return this.sendVacancy(scored);
    }

    const { order, score, pitch } = scored;
    const source = SOURCE_LABEL[order.source] ?? order.source;
    const stars = '⭐'.repeat(Math.min(Math.round(score.score / 2), 5));
    const hasPitchB = !!scored.pitchB;

    const lines = [
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
    const keyboard = hasPitchB
      ? [
          [
            { text: '✅ Вариант 1', callback_data: `pick1:${order.source}:${order.id}` },
            { text: '✅ Вариант 2', callback_data: `pick2:${order.source}:${order.id}` },
          ],
          [{ text: '⏭ Пропустить', callback_data: callbackSkip }],
        ]
      : [[{ text: '⏭ Пропустить', callback_data: callbackSkip }]];

    await this.bot.sendMessage(config.telegram.chatId, lines.join('\n'), {
      parse_mode: 'HTML',
      link_preview_options: { is_disabled: true },
      reply_markup: { inline_keyboard: keyboard },
    });

    logger.info(
      { orderId: order.id, source: order.source, score: score.score },
      'Уведомление отправлено в Telegram',
    );
  }

  async sendReminder(order: ReminderOrder): Promise<void> {
    const source = SOURCE_LABEL[order.source] ?? order.source;
    const stars = '⭐'.repeat(Math.min(Math.round(order.score / 2), 5));

    const lines = [
      `⏰ <b>Напоминание</b> — заказ ещё не рассмотрен`,
      ``,
      `🔥 <b>${esc(order.title)}</b>`,
      `${stars} Оценка: <b>${order.score}/10</b> | 🏪 ${source}`,
    ];

    if (order.pitch) {
      lines.push(``, `✍️ <code>${esc(order.pitch)}</code>`);
    }
    lines.push(``, `🔗 <a href="${order.link}">${esc(order.title)}</a>`);

    await this.bot.sendMessage(config.telegram.chatId, lines.join('\n'), {
      parse_mode: 'HTML',
      link_preview_options: { is_disabled: true },
      reply_markup: {
        inline_keyboard: [[{ text: '⏭ Пропустить', callback_data: `skip:${order.source}:${order.order_id}` }]],
      },
    });

    logger.info({ orderId: order.order_id, source: order.source }, 'Напоминание отправлено в Telegram');
  }

  startCallbackListener(): void {
    if (!this.storage) {
      logger.warn('Storage не передан — callback-кнопки не будут работать');
      return;
    }

    this.bot.startPolling({ restart: true });

    this.bot.on('message', async (msg) => {
      if (!this.storage) return;
      const text = msg.text?.trim() ?? '';
      if (!text.startsWith('/')) return;

      try {
        const storage = this.storage;

        if (text === '/stats') {
          const settings = storage.getSettings();
          const stats = storage.getStats(settings.minScore);
          await this.bot.sendMessage(config.telegram.chatId, formatStats(stats), { parse_mode: 'HTML' });

        } else if (text === '/settings') {
          const settings = storage.getSettings();
          await this.bot.sendMessage(config.telegram.chatId, formatSettings(settings), { parse_mode: 'HTML' });

        } else if (text.startsWith('/setrate ')) {
          const val = parseInt(text.slice(9).trim(), 10);
          if (isNaN(val) || val < 0) throw new Error('Неверное значение. Пример: /setrate 2000');
          storage.setSetting('minPrice', String(val));
          await this.bot.sendMessage(config.telegram.chatId, `✅ Мин. бюджет: <b>${val}₽</b>`, { parse_mode: 'HTML' });

        } else if (text.startsWith('/setscore ')) {
          const val = parseInt(text.slice(10).trim(), 10);
          if (isNaN(val) || val < 0 || val > 10) throw new Error('Неверное значение (0–10). Пример: /setscore 7');
          storage.setSetting('minScore', String(val));
          await this.bot.sendMessage(config.telegram.chatId, `✅ Мин. балл: <b>${val}/10</b>`, { parse_mode: 'HTML' });

        } else if (text === '/setstop list') {
          const { stopWords } = storage.getSettings();
          const list = stopWords.map((w, i) => `${i + 1}. ${esc(w)}`).join('\n');
          await this.bot.sendMessage(config.telegram.chatId, `🚫 <b>Стоп-слова:</b>\n${list || '(список пуст)'}`, { parse_mode: 'HTML' });

        } else if (text.startsWith('/setstop add ')) {
          const word = text.slice(13).trim().toLowerCase();
          if (!word) throw new Error('Укажите слово. Пример: /setstop add реферат');
          const settings = storage.getSettings();
          if (!settings.stopWords.includes(word)) {
            settings.stopWords.push(word);
            storage.setSetting('stopWords', JSON.stringify(settings.stopWords));
          }
          await this.bot.sendMessage(config.telegram.chatId, `✅ Стоп-слово добавлено: <b>${esc(word)}</b>`, { parse_mode: 'HTML' });

        } else if (text.startsWith('/setstop remove ')) {
          const word = text.slice(16).trim().toLowerCase();
          if (!word) throw new Error('Укажите слово. Пример: /setstop remove реферат');
          const settings = storage.getSettings();
          settings.stopWords = settings.stopWords.filter(w => w !== word);
          storage.setSetting('stopWords', JSON.stringify(settings.stopWords));
          await this.bot.sendMessage(config.telegram.chatId, `✅ Стоп-слово удалено: <b>${esc(word)}</b>`, { parse_mode: 'HTML' });
        }

      } catch (err) {
        const errMsg = err instanceof Error ? err.message : 'Неизвестная ошибка';
        await this.bot.sendMessage(config.telegram.chatId, `❌ ${esc(errMsg)}`).catch(() => {});
        logger.error({ err, text }, 'Ошибка обработки команды');
      }
    });

    this.bot.on('callback_query', async (query) => {
      const data = query.data;
      if (!data) return;

      const parts = data.split(':');
      if (parts.length < 3) return;
      const [action, source, ...idParts] = parts;
      const orderId = idParts.join(':');

      if (action === 'skip') {
        try {
          this.storage!.blacklist(orderId, source);
          await this.bot.answerCallbackQuery(query.id, { text: '✅ Добавлен в blacklist' });

          if (query.message) {
            const original = query.message.text ?? '';
            await this.bot.editMessageText(original + '\n\n❌ Пропущен', {
              chat_id: query.message.chat.id,
              message_id: query.message.message_id,
            }).catch(() => {});
          }
        } catch (err) {
          logger.error({ err, orderId, source }, 'Ошибка обработки skip');
          await this.bot.answerCallbackQuery(query.id, { text: '❌ Ошибка' }).catch(() => {});
        }

      } else if (action === 'pick1' || action === 'pick2') {
        try {
          const variant = action === 'pick1' ? 'a' : 'b';
          const chosen = this.storage!.choosePitch(orderId, source, variant);

          // Если выбран вариант B — обновляем Supabase
          if (chosen && this.onPitchChosen) {
            await this.onPitchChosen(orderId, source, chosen.hook, chosen.pitch).catch(() => {});
          }

          const label = action === 'pick1' ? 'Вариант 1' : 'Вариант 2';
          await this.bot.answerCallbackQuery(query.id, { text: `✅ Выбран ${label}` });

          if (query.message) {
            await this.bot.editMessageReplyMarkup(
              { inline_keyboard: [[{ text: `✅ Выбран ${label}`, callback_data: 'noop' }]] },
              { chat_id: query.message.chat.id, message_id: query.message.message_id },
            ).catch(() => {});
          }
        } catch (err) {
          logger.error({ err, orderId, source, action }, 'Ошибка обработки pick');
          await this.bot.answerCallbackQuery(query.id, { text: '❌ Ошибка' }).catch(() => {});
        }
      }
    });

    logger.info('Telegram callback listener запущен');
  }

  stopCallbackListener(): void {
    this.bot.stopPolling();
  }

  private async sendVacancy(scored: ScoredOrder): Promise<void> {
    const { order, score } = scored;
    const employer = order.meta?.employer ?? '';
    const city = order.meta?.city ?? '';

    const starCount = Math.min(5, Math.round(score.score / 2));
    const stars = starCount > 0 ? '⭐'.repeat(starCount) : '☆';

    const lines: (string | null)[] = [
      `💼 <b>${esc(order.title)}</b>`,
      ``,
      employer ? `🏢 ${esc(employer)}` : null,
      city     ? `📍 ${esc(city)}`     : null,
      `💰 Зарплата: ${esc(order.price)}`,
      ``,
      `${stars} Keyword score: <b>${score.score}/10</b>`,
      score.reason ? `🎯 <i>${esc(score.reason)}</i>` : null,
      ``,
      `🔗 <a href="${order.link}">Открыть вакансию на HH</a>`,
    ];

    const text = lines.filter(Boolean).join('\n');

    await this.bot.sendMessage(config.telegram.chatId, text, {
      parse_mode: 'HTML',
      link_preview_options: { is_disabled: true },
      reply_markup: {
        inline_keyboard: [[{ text: '⏭ Пропустить', callback_data: `skip:${order.source}:${order.id}` }]],
      },
    });

    logger.info(
      { orderId: order.id, source: 'hh', score: score.score },
      'HH вакансия отправлена в Telegram',
    );
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
  ].join('\n');
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
    `  • Средний скор: ${s.week_avg_score ?? '—'}`,
    ``,
    `💾 В базе: ${s.total_count} заказов`,
  ].join('\n');
}

/** Экранирование для HTML parse_mode: только &, <, > */
function esc(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
