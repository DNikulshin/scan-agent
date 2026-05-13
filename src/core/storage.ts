import { Prisma, PrismaClient } from "@prisma/client";

import { config } from "../config";
import { logger } from "../utils/logger";
import { prisma as defaultPrisma } from "./prisma";

export interface DynamicSettings {
  minPrice: number;
  minScore: number;
  maxOffers: number;
  stopWords: string[];
}

export interface ReminderOrder {
  order_id: string;
  source: string;
  title: string;
  link: string;
  score: number;
  pitch: string;
}

export interface StatsResult {
  today_total: number;
  today_sent: number;
  today_skipped: number;
  week_total: number;
  week_sent: number;
  week_skipped: number;
  week_avg_score: number | null;
  total_count: number;
}

interface StatsRow {
  today_total: bigint | null;
  today_sent: bigint | null;
  today_skipped: bigint | null;
  week_total: bigint | null;
  week_sent: bigint | null;
  week_skipped: bigint | null;
  week_avg_score: Prisma.Decimal | number | null;
  total_count: bigint | null;
}

export interface OrderToEnrich {
  id: string;
  source: string;
  link: string;
}

const num = (v: bigint | null | undefined): number => Number(v ?? 0n);

/**
 * Хранилище заказов на Prisma Postgres.
 * Все методы async (Prisma client async-only).
 */
export class Storage {
  private prisma: PrismaClient;

  constructor(prisma?: PrismaClient) {
    this.prisma = prisma ?? defaultPrisma;
    logger.info("Prisma Postgres хранилище инициализировано");
  }

  async isProcessed(orderId: string, source: string): Promise<boolean> {
    const row = await this.prisma.order.findUnique({
      where: { orderId_source: { orderId, source } },
      select: { id: true },
    });
    return row !== null;
  }

  async isBlacklisted(orderId: string, source: string): Promise<boolean> {
    const row = await this.prisma.order.findUnique({
      where: { orderId_source: { orderId, source } },
      select: { blacklisted: true },
    });
    return row?.blacklisted === true;
  }

  async markProcessed(params: {
    orderId: string;
    source: string;
    title: string;
    score: number;
    link: string;
    pitch?: string;
    pitchB?: string;
    tags?: string[];
    status?: "new" | "skipped";
    employer?: string;
    city?: string;
    publishedAt?: string; // ISO‑строка
  }): Promise<void> {
    let publishedAtDate: Date | undefined;
    if (params.publishedAt) {
      const d = new Date(params.publishedAt);
      if (Number.isNaN(d.getTime())) {
        logger.warn(
          { raw: params.publishedAt, orderId: params.orderId, source: params.source },
          "Невалидная publishedAt — игнорируем",
        );
      } else {
        publishedAtDate = d;
      }
    }
    const data = {
      title: params.title,
      score: params.score,
      link: params.link,
      pitch: params.pitch ?? "",
      pitchB: params.pitchB ?? "",
      tags: (params.tags ?? []).join(","),
      processedAt: new Date(),
      ...(params.status ? { status: params.status } : {}),
      ...(params.employer ? { employer: params.employer } : {}),
      ...(params.city ? { city: params.city } : {}),
      ...(publishedAtDate ? { publishedAt: publishedAtDate } : {}),
    };
    await this.prisma.order.upsert({
      where: {
        orderId_source: { orderId: params.orderId, source: params.source },
      },
      create: { orderId: params.orderId, source: params.source, ...data },
      update: data,
    });
  }

  async getPitch(orderId: string, source: string): Promise<string> {
    const row = await this.prisma.order.findUnique({
      where: { orderId_source: { orderId, source } },
      select: { pitch: true },
    });
    return row?.pitch ?? "";
  }

  async blacklist(orderId: string, source: string): Promise<void> {
    await this.prisma.order.upsert({
      where: { orderId_source: { orderId, source } },
      create: { orderId, source, blacklisted: true, processedAt: new Date() },
      update: { blacklisted: true },
    });
    logger.info({ orderId, source }, "Заказ добавлен в blacklist");
  }

  async getSettings(): Promise<DynamicSettings> {
    const rows = await this.prisma.setting.findMany();
    const map = Object.fromEntries(rows.map((r) => [r.key, r.value]));
    return {
      minPrice: map["minPrice"]
        ? parseInt(map["minPrice"], 10)
        : config.filter.minPrice,
      minScore: map["minScore"]
        ? parseInt(map["minScore"], 10)
        : config.filter.minScore,
      maxOffers: map["maxOffers"]
        ? parseInt(map["maxOffers"], 10)
        : config.filter.maxOffers,
      stopWords: map["stopWords"]
        ? JSON.parse(map["stopWords"])
        : [...config.filter.stopWords],
    };
  }

  async setSetting(key: string, value: string): Promise<void> {
    await this.prisma.setting.upsert({
      where: { key },
      create: { key, value },
      update: { value },
    });
    logger.info({ key, value }, "Настройка обновлена");
  }

  async choosePitch(
    orderId: string,
    source: string,
    variant: "a" | "b",
  ): Promise<{ hook: string; pitch: string } | null> {
    if (variant === "a") return null;

    const row = await this.prisma.order.findUnique({
      where: { orderId_source: { orderId, source } },
      select: { pitchB: true },
    });
    if (!row?.pitchB) return null;

    try {
      const parsed = JSON.parse(row.pitchB) as { hook: string; pitch: string };
      await this.prisma.order.update({
        where: { orderId_source: { orderId, source } },
        data: { pitch: `${parsed.hook}\n\n${parsed.pitch}` },
      });
      logger.info({ orderId, source }, "Выбран вариант B");
      return parsed;
    } catch {
      return null;
    }
  }

  async getUnremindedOrders(
    minScore: number,
    afterHours: number = 2,
  ): Promise<ReminderOrder[]> {
    const cutoff = new Date(Date.now() - afterHours * 60 * 60 * 1000);
    const rows = await this.prisma.order.findMany({
      where: {
        score: { gte: minScore },
        blacklisted: false,
        remindedAt: null,
        processedAt: { lte: cutoff },
      },
      select: {
        orderId: true,
        source: true,
        title: true,
        link: true,
        score: true,
        pitch: true,
      },
    });
    return rows.map((r) => ({
      order_id: r.orderId,
      source: r.source,
      title: r.title,
      link: r.link,
      score: r.score,
      pitch: r.pitch,
    }));
  }

  async markReminded(orderId: string, source: string): Promise<void> {
    await this.prisma.order.update({
      where: { orderId_source: { orderId, source } },
      data: { remindedAt: new Date() },
    });
  }

  async getStats(minScore: number): Promise<StatsResult> {
    const rows = await this.prisma.$queryRaw<StatsRow[]>`
      SELECT
        COUNT(*) FILTER (WHERE processed_at >= NOW() - INTERVAL '1 day')                                                     AS today_total,
        COUNT(*) FILTER (WHERE processed_at >= NOW() - INTERVAL '1 day' AND score >= ${minScore} AND blacklisted = false)    AS today_sent,
        COUNT(*) FILTER (WHERE processed_at >= NOW() - INTERVAL '1 day' AND blacklisted = true)                              AS today_skipped,
        COUNT(*) FILTER (WHERE processed_at >= NOW() - INTERVAL '7 days')                                                    AS week_total,
        COUNT(*) FILTER (WHERE processed_at >= NOW() - INTERVAL '7 days' AND score >= ${minScore} AND blacklisted = false)   AS week_sent,
        COUNT(*) FILTER (WHERE processed_at >= NOW() - INTERVAL '7 days' AND blacklisted = true)                             AS week_skipped,
        ROUND(AVG(CASE WHEN processed_at >= NOW() - INTERVAL '7 days' AND score > 0 THEN score::numeric END), 1)             AS week_avg_score,
        COUNT(*)                                                                                                              AS total_count
      FROM orders
    `;
    const r = rows[0];
    return {
      today_total: num(r.today_total),
      today_sent: num(r.today_sent),
      today_skipped: num(r.today_skipped),
      week_total: num(r.week_total),
      week_sent: num(r.week_sent),
      week_skipped: num(r.week_skipped),
      week_avg_score:
        r.week_avg_score === null ? null : Number(r.week_avg_score),
      total_count: num(r.total_count),
    };
  }

  async count(): Promise<number> {
    return this.prisma.order.count();
  }

  async cleanup(daysOld: number = 30): Promise<number> {
    const cutoff = new Date(Date.now() - daysOld * 24 * 60 * 60 * 1000);
    const result = await this.prisma.order.deleteMany({
      where: { processedAt: { lt: cutoff } },
    });
    if (result.count > 0) {
      logger.info({ deleted: result.count, daysOld }, "Очищены старые записи");
    }
    return result.count;
  }

  async getOrdersWithoutPublishedAt(
    limit: number = 20,
  ): Promise<OrderToEnrich[]> {
    // 7-дневное окно: не зависит от того, что для части заказов дата так и не
    // вытащится (404, изменилась вёрстка) — иначе они залипают в выборке навсегда
    // и блокируют enrich остальных. После 7 дней — просто забываем.
    const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const rows = await this.prisma.order.findMany({
      where: {
        publishedAt: null,
        processedAt: { gte: cutoff },
        status: "new",
        blacklisted: false,
      },
      select: { id: true, source: true, link: true },
      orderBy: { processedAt: "desc" },
      take: limit,
    });
    return rows.map((r) => ({ id: r.id, source: r.source, link: r.link }));
  }

  async setPublishedAt(id: string, publishedAt: Date): Promise<void> {
    await this.prisma.order.update({
      where: { id },
      data: { publishedAt },
    });
  }

  async close(): Promise<void> {
    await this.prisma.$disconnect();
  }
}
