import { validateConfig, config } from "./config";
import { Storage } from "./core/storage";
import { getTrashReason } from "./core/filter";
import { analyzeOrder, scoreOrder } from "./core/analyzer";
import { extractTags } from "./core/tagger";
import { RunMetrics } from "./core/metrics";
import {
  refreshProfileIfStale,
  loadProfileContext,
} from "./core/profile-context";
import { refreshAllProfiles, cleanupProfileSnapshots } from "./core/profile";
import {
  KworkParser,
  FlParser,
  FreelanceruParser,
  HabrParser,
  HhParser,
} from "./parsers";
import { calcKeywordScore, FULLSTACK_SCORING } from "./core/keyword-scorer";
import { TelegramNotifier } from "./notifiers/telegram";
import { enqueueNotifications, enqueueReminder } from "./core/notifications";
import { logger } from "./utils/logger";
import type { Order, Parser, ScoredOrder } from "./types";
import { enrichOrders } from "./enrich";

const parsers: Parser[] = [
  new KworkParser(),
  new FlParser(),
  new FreelanceruParser(),
  new HabrParser(),
  new HhParser(),
];

async function run(): Promise<void> {
  validateConfig();

  const storage = new Storage();
  // Pitch B выбирается через Storage.choosePitch (см. notifiers/telegram.ts) —
  // запись идёт напрямую в Prisma, без HTTP/Supabase каналов.
  const telegram = new TelegramNotifier(storage);

  telegram.startCallbackListener();
  await storage.cleanup(30);

  // Profile (GitHub) — обновляем снимок раз в N часов и прогреваем кэш для AI промптов
  await refreshProfileIfStale({
    maxAgeHours: config.github.snapshotMaxAgeHours,
    login: config.github.login,
    token: config.github.token,
  });
  // Profile (FL/Kwork/Freelance.ru) — параллельно, best-effort.
  // HH заливается вручную через /profile, см. POST /api/profile/hh.
  await refreshAllProfiles({
    flUrl: config.profile.flUrl,
    kworkUrl: config.profile.kworkUrl,
    freelanceruUrl: config.profile.freelanceruUrl,
    maxAgeHours: config.profile.snapshotMaxAgeHours,
  });
  await cleanupProfileSnapshots();
  await loadProfileContext();

  const settings = await storage.getSettings();
  logger.info({ settings }, "Запуск агента");
  const metrics = new RunMetrics();
  let totalNew = 0;
  let totalEnqueued = 0;

  try {
    for (const parser of parsers) {
      let orders: Order[];
      const parserStart = Date.now();
      try {
        orders = await parser.fetchOrders();
      } catch (err) {
        metrics.incError("parser");
        metrics.setParserDuration(parser.name, Date.now() - parserStart);
        logger.error(
          { err, parser: parser.name },
          "Ошибка парсера — пропускаем",
        );
        continue;
      }
      metrics.setParserDuration(parser.name, Date.now() - parserStart);
      metrics.incParsed(parser.name, orders.length);

      for (const order of orders) {
        if (await storage.isProcessed(order.id, order.source)) continue;

        totalNew++;

        const trashReason = getTrashReason(order, settings);
        if (trashReason) {
          metrics.incFiltered();
          logger.debug(
            { orderId: order.id, parser: parser.name, reason: trashReason },
            "Мусор",
          );
          await storage.markProcessed({
            orderId: order.id,
            source: order.source,
            title: order.title,
            score: 0,
            link: order.link,
            status: "skipped",
            employer: order.meta?.employer,
            city: order.meta?.city,
            publishedAt: order.meta?.publishedAt,
          });
          continue;
        }

        logger.info(
          { orderId: order.id, parser: parser.name, offers: order.offersCount },
          `Анализирую: ${order.title}`,
        );

        let scored: ScoredOrder;

        if (order.source === "hh") {
          // ── HH: keyword pre-filter + AI score, без питча ──
          const kw = calcKeywordScore(
            order.title,
            order.desc,
            FULLSTACK_SCORING,
          );
          if (kw.excluded || kw.rawScore < config.hh.minKeywordScore) {
            metrics.incLowScoreKeyword();
            logger.debug(
              {
                orderId: order.id,
                rawScore: kw.rawScore,
                match: kw.matches[0],
              },
              "[hh] pre-filter — пропускаем",
            );
            await storage.markProcessed({
              orderId: order.id,
              source: order.source,
              title: order.title,
              score: 0,
              link: order.link,
              status: "skipped",
              employer: order.meta?.employer,
              city: order.meta?.city,
              publishedAt: order.meta?.publishedAt,
            });
            continue;
          }

          metrics.incScoringCall();
          const { result: score, usage } = await scoreOrder(order);
          metrics.addAiUsage(usage);
          if (!score) {
            metrics.incError("scoring");
            continue;
          }
          metrics.recordScore(score.score);

          if (score.score < settings.minScore) {
            metrics.incLowScoreAi();
            logger.info(
              { orderId: order.id, score: score.score },
              "[hh] Ниже порога — пропускаем",
            );
            await storage.markProcessed({
              orderId: order.id,
              source: order.source,
              title: order.title,
              score: score.score,
              link: order.link,
              status: "skipped",
              employer: order.meta?.employer,
              city: order.meta?.city,
              publishedAt: order.meta?.publishedAt,
            });
            continue;
          }

          scored = {
            order,
            score,
            pitch: { hook: "", pitch: "" },
            tags: extractTags(order),
          };
        } else if (order.source === "fl" && !config.fl.generatePitch) {
          // ── FL: AI score только, pitchGeneration отключён ──
          // Предфильтрация (hardExclude + skillsWeight) уже выполнена в FlParser
          metrics.incScoringCall();
          const { result: score, usage } = await scoreOrder(order);
          metrics.addAiUsage(usage);
          if (!score) {
            metrics.incError("scoring");
            continue;
          }
          metrics.recordScore(score.score);

          if (score.score < settings.minScore) {
            metrics.incLowScoreAi();
            logger.info(
              { orderId: order.id, score: score.score },
              "[FL] Ниже порога — пропускаем",
            );
            await storage.markProcessed({
              orderId: order.id,
              source: order.source,
              title: order.title,
              score: score.score,
              link: order.link,
              status: "skipped",
            });
            continue;
          }

          scored = {
            order,
            score,
            pitch: { hook: "", pitch: "" }, // пустой — не ломает БД (NOT NULL не выставлен)
            tags: extractTags(order),
          };
        } else {
          // ── Все остальные биржи: полный AI pipeline (score + pitch×2) ──
          metrics.incScoringCall();
          const result = await analyzeOrder(order, settings.minScore);
          if (!result) {
            // analyzeOrder сам логирует причину; на стороне метрик считаем
            // как low-score-ai (он отсёк до pitch'а либо pitch упал).
            metrics.incLowScoreAi();
            continue;
          }
          metrics.recordScore(result.score.score);
          metrics.incPitchCall(result.pitchCalls);
          metrics.addAiUsage(result.usage);

          scored = {
            order,
            score: result.score,
            pitch: result.pitch,
            pitchB: result.pitchB,
            tags: extractTags(order),
          };
        }

        // markProcessed + enqueue в outbox: если хоть один шаг упадёт,
        // заказ останется без processed и попадёт в следующий cron-прогон.
        // Доставка (Telegram, push) идёт асинхронно через dashboard worker
        // с retry/backoff — см. dashboard/lib/notifications/dispatcher.ts.
        try {
          await storage.markProcessed({
            orderId: order.id,
            source: order.source,
            title: order.title,
            score: scored.score.score,
            link: order.link,
            pitch: scored.pitch.hook
              ? `${scored.pitch.hook}\n\n${scored.pitch.pitch}`
              : "",
            pitchB: scored.pitchB ? JSON.stringify(scored.pitchB) : undefined,
            tags: scored.tags,
            employer: order.meta?.employer,
            city: order.meta?.city,
            publishedAt: order.meta?.publishedAt,
          });
          await enqueueNotifications(scored);
          totalEnqueued++;
          metrics.incEnqueued();
        } catch (err) {
          metrics.incError("enqueue");
          logger.error(
            { err, orderId: order.id },
            "Ошибка enqueue уведомлений (заказ не помечен processed — повторим в следующем прогоне)",
          );
          continue;
        }

        await new Promise((r) => setTimeout(r, config.delays.betweenOrders));
      }
    }
  } finally {
    const unreminded = await storage.getUnremindedOrders(
      config.filter.minScore,
      2,
    );
    for (const order of unreminded) {
      try {
        await enqueueReminder(order);
        await storage.markReminded(order.order_id, order.source);
      } catch (err) {
        logger.error(
          { err, orderId: order.order_id },
          "Ошибка enqueue напоминания",
        );
      }
    }
    if (unreminded.length > 0) {
      logger.info(
        { count: unreminded.length },
        "Напоминания поставлены в outbox",
      );
    }

    const dbSize = await storage.count();
    logger.info({ totalNew, totalEnqueued, dbSize }, "Цикл завершён");

    await metrics.flush();

    // Обогащение датами публикации (enrich worker)
    try {
      await enrichOrders(storage, 20);
    } catch (err) {
      logger.error({ err }, "Ошибка enrich-воркера");
    }

    if (!process.env.KEEP_ALIVE) {
      setTimeout(async () => {
        telegram.stopCallbackListener();
        await storage.close();
        process.exit(0);
      }, 30_000);
    }
  }
}

run().catch((err) => {
  logger.fatal({ err }, "Критическая ошибка");
  process.exit(1);
});
