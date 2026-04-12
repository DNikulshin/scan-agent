import { validateConfig, config } from './config';
import { Storage } from './core/storage';
import { getTrashReason } from './core/filter';
import { analyzeOrder } from './core/analyzer';
import { extractTags } from './core/tagger';
import { KworkParser, FlParser, FreelanceruParser, HabrParser } from './parsers';
import { TelegramNotifier } from './notifiers/telegram';
import { SupabaseNotifier } from './notifiers/supabase';
import { DashboardNotifier } from './notifiers/dashboard';
import { PushNotifier } from './notifiers/push';
import { logger } from './utils/logger';
import type { Parser } from './types';

// ── Конфигурация pipeline ──

const parsers: Parser[] = [
  new KworkParser(),
  new FlParser(),
  new FreelanceruParser(),
  new HabrParser(),
];

// ── Главная функция ──

async function run(): Promise<void> {
  validateConfig();

  const storage = new Storage();
  const supabase = new SupabaseNotifier();
  const dashboard = new DashboardNotifier();
  const telegram = new TelegramNotifier(storage, async (orderId, source, hook, pitch) => {
    await supabase.updatePitch(orderId, source, hook, pitch);
    await dashboard.updatePitch(orderId, source, hook, pitch);
  });
  const push = new PushNotifier();

  // Запуск listener для inline-кнопок (polling)
  telegram.startCallbackListener();

  // Очистка записей старше 30 дней
  storage.cleanup(30);

  const settings = storage.getSettings();
  logger.info({ settings }, 'Запуск агента');
  let totalNew = 0;
  let totalSent = 0;

  try {
    for (const parser of parsers) {
      const orders = await parser.fetchOrders();

      for (const order of orders) {
        if (storage.isProcessed(order.id, order.source)) continue;

        totalNew++;

        const trashReason = getTrashReason(order, settings);
        if (trashReason) {
          logger.debug({ orderId: order.id, parser: parser.name, reason: trashReason }, 'Мусор');
          storage.markProcessed({
            orderId: order.id,
            source: order.source,
            title: order.title,
            score: 0,
            link: order.link,
          });
          continue;
        }

        logger.info(
          { orderId: order.id, parser: parser.name, offers: order.offersCount },
          `Анализирую: ${order.title}`,
        );

        const result = await analyzeOrder(order, settings.minScore);

        if (!result) {
          // null = ошибка AI → НЕ сохраняем, повторим в следующем запуске
          continue;
        }

        const scored = { order, score: result.score, pitch: result.pitch, pitchB: result.pitchB, tags: extractTags(order) };
        let sent = false;

        try {
          await telegram.send(scored);
          sent = true;
          totalSent++;
          // Отправить push-уведомление
          await push.sendToAll({
            title: `Новый заказ: ${scored.order.title}`,
            body: `Оценка: ${scored.score.score}/10`,
            icon: '/icons/icon-192.svg',
            data: { orderId: scored.order.id },
          });
        } catch (err) {
          logger.error({ err, orderId: order.id }, 'Ошибка отправки в Telegram');
        }

        try {
          await supabase.send(scored);
        } catch (err) {
          logger.error({ err, orderId: order.id }, 'Ошибка отправки в Supabase');
        }

        try {
          await dashboard.send(scored);
        } catch (err) {
          logger.error({ err, orderId: order.id }, 'Ошибка отправки в Dashboard');
        }

        // Помечаем обработанным только если хотя бы один канал сработал
        if (sent) {
          storage.markProcessed({
            orderId: order.id,
            source: order.source,
            title: order.title,
            score: result.score.score,
            link: order.link,
            pitch: `${result.pitch.hook}\n\n${result.pitch.pitch}`,
            pitchB: result.pitchB ? JSON.stringify(result.pitchB) : undefined,
            tags: scored.tags,
          });
        }

        // Пауза между заказами
        await new Promise(r => setTimeout(r, config.delays.betweenOrders));
      }
    }
  } finally {
    // Напоминания о заказах, которые не рассмотрели > 2 часов назад
    const unreminded = storage.getUnremindedOrders(config.filter.minScore, 2);
    for (const order of unreminded) {
      try {
        await telegram.sendReminder(order);
        storage.markReminded(order.order_id, order.source);
      } catch (err) {
        logger.error({ err, orderId: order.order_id }, 'Ошибка отправки напоминания');
      }
    }
    if (unreminded.length > 0) {
      logger.info({ count: unreminded.length }, 'Напоминания отправлены');
    }

    logger.info({ totalNew, totalSent, dbSize: storage.count }, 'Цикл завершён');
    // Не закрываем storage и polling — они нужны для callback-кнопок.
    // При одноразовом запуске через cron — даём 30 сек на обработку callback,
    // потом процесс завершается.
    if (!process.env.KEEP_ALIVE) {
      setTimeout(() => {
        telegram.stopCallbackListener();
        storage.close();
        process.exit(0);
      }, 30_000);
    }
  }
}

run().catch(err => {
  logger.fatal({ err }, 'Критическая ошибка');
  process.exit(1);
});
