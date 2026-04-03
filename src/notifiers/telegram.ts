import TelegramBot from 'node-telegram-bot-api';
import { config } from '../config';
import { logger } from '../utils/logger';
import type { Storage } from '../core/storage';
import type { ScoredOrder, Notifier } from '../types';

const SOURCE_LABEL: Record<string, string> = {
  kwork: 'Kwork',
  fl: 'FL.ru',
  freelanceru: 'Freelance.ru',
};

export class TelegramNotifier implements Notifier {
  name = 'telegram';
  private bot: TelegramBot;
  private storage: Storage | null;

  constructor(storage?: Storage) {
    this.bot = new TelegramBot(config.telegram.botToken, { polling: false });
    this.storage = storage ?? null;
  }

  async send(scored: ScoredOrder): Promise<void> {
    const { order, score, pitch } = scored;
    const source = SOURCE_LABEL[order.source] ?? order.source;
    const stars = '⭐'.repeat(Math.min(Math.round(score.score / 2), 5));

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
      `✍️ <b>Готовый отклик</b> <i>(тап — скопировать):</i>`,
      `<code>${esc(pitch.hook)}\n\n${esc(pitch.pitch)}</code>`,
      ``,
      `🔗 <a href="${order.link}">${esc(order.title)}</a>`,
    ];

    const callbackSkip = `skip:${order.source}:${order.id}`;

    await this.bot.sendMessage(config.telegram.chatId, lines.join('\n'), {
      parse_mode: 'HTML',
      link_preview_options: { is_disabled: true },
      reply_markup: {
        inline_keyboard: [
          [
            { text: '⏭ Пропустить', callback_data: callbackSkip },
          ],
        ],
      },
    });

    logger.info(
      { orderId: order.id, source: order.source, score: score.score },
      'Уведомление отправлено в Telegram',
    );
  }

  startCallbackListener(): void {
    if (!this.storage) {
      logger.warn('Storage не передан — callback-кнопки не будут работать');
      return;
    }

    this.bot.startPolling({ restart: true });

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

      }
    });

    logger.info('Telegram callback listener запущен');
  }

  stopCallbackListener(): void {
    this.bot.stopPolling();
  }
}

/** Экранирование для HTML parse_mode: только &, <, > */
function esc(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
