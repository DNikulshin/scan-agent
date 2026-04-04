import Database from 'better-sqlite3';
import path from 'path';

import { logger } from '../utils/logger';

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

/**
 * SQLite-хранилище для обработанных заказов.
 *
 * Преимущества перед JSON-кэшем:
 * - Атомарные записи, нет гонки данных
 * - Blacklist для заказов (кнопка "Пропустить" в Telegram)
 * - История с оценками — база для будущего веб-интерфейса
 * - Быстрый поиск по ID
 */
export class Storage {
  private db: Database.Database;

  constructor() {
    const dbPath = process.env.DB_PATH ?? path.join(process.cwd(), 'agent.db');
    this.db = new Database(dbPath);

    // WAL-mode для лучшей производительности при конкурентном доступе
    this.db.pragma('journal_mode = WAL');

    this.migrate();
    logger.info({ dbPath }, 'SQLite хранилище инициализировано');
  }

  /** Проверяет, был ли заказ уже обработан */
  isProcessed(orderId: string, source: string): boolean {
    const row = this.db
      .prepare('SELECT 1 FROM orders WHERE order_id = ? AND source = ?')
      .get(orderId, source);
    return !!row;
  }

  /** Проверяет, в чёрном ли списке заказ */
  isBlacklisted(orderId: string, source: string): boolean {
    const row = this.db
      .prepare('SELECT 1 FROM orders WHERE order_id = ? AND source = ? AND blacklisted = 1')
      .get(orderId, source);
    return !!row;
  }

  /** Сохраняет обработанный заказ */
  markProcessed(params: {
    orderId: string;
    source: string;
    title: string;
    score: number;
    link: string;
    pitch?: string;
  }): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO orders (order_id, source, title, score, link, pitch, processed_at)
         VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`,
      )
      .run(params.orderId, params.source, params.title, params.score, params.link, params.pitch ?? '');
  }

  /** Возвращает сохранённый питч для заказа */
  getPitch(orderId: string, source: string): string {
    const row = this.db
      .prepare('SELECT pitch FROM orders WHERE order_id = ? AND source = ?')
      .get(orderId, source) as { pitch: string } | undefined;
    return row?.pitch ?? '';
  }

  /** Добавляет заказ в чёрный список (кнопка "Пропустить" в Telegram) */
  blacklist(orderId: string, source: string): void {
    const result = this.db
      .prepare(
        `UPDATE orders SET blacklisted = 1 WHERE order_id = ? AND source = ?`,
      )
      .run(orderId, source);

    // Если заказа ещё нет — создаём запись сразу с blacklist
    if (result.changes === 0) {
      this.db
        .prepare(
          `INSERT INTO orders (order_id, source, blacklisted, processed_at)
           VALUES (?, ?, 1, datetime('now'))`,
        )
        .run(orderId, source);
    }

    logger.info({ orderId, source }, 'Заказ добавлен в blacklist');
  }

  /** Заказы, которым нужно отправить напоминание */
  getUnremindedOrders(minScore: number, afterHours: number = 2): ReminderOrder[] {
    const interval = `-${afterHours} hours`;
    return this.db.prepare(`
      SELECT order_id, source, title, link, score, pitch
      FROM orders
      WHERE score >= ?
        AND blacklisted = 0
        AND reminded_at IS NULL
        AND processed_at <= datetime('now', ?)
    `).all(minScore, interval) as ReminderOrder[];
  }

  /** Помечает заказ как напомненный */
  markReminded(orderId: string, source: string): void {
    this.db
      .prepare(`UPDATE orders SET reminded_at = datetime('now') WHERE order_id = ? AND source = ?`)
      .run(orderId, source);
  }

  /** Статистика агента */
  getStats(minScore: number): StatsResult {
    return this.db.prepare(`
      SELECT
        SUM(CASE WHEN processed_at >= datetime('now', '-1 day') THEN 1 ELSE 0 END) AS today_total,
        SUM(CASE WHEN processed_at >= datetime('now', '-1 day') AND score >= ? AND blacklisted = 0 THEN 1 ELSE 0 END) AS today_sent,
        SUM(CASE WHEN processed_at >= datetime('now', '-1 day') AND blacklisted = 1 THEN 1 ELSE 0 END) AS today_skipped,
        SUM(CASE WHEN processed_at >= datetime('now', '-7 days') THEN 1 ELSE 0 END) AS week_total,
        SUM(CASE WHEN processed_at >= datetime('now', '-7 days') AND score >= ? AND blacklisted = 0 THEN 1 ELSE 0 END) AS week_sent,
        SUM(CASE WHEN processed_at >= datetime('now', '-7 days') AND blacklisted = 1 THEN 1 ELSE 0 END) AS week_skipped,
        ROUND(AVG(CASE WHEN processed_at >= datetime('now', '-7 days') AND score > 0 THEN CAST(score AS REAL) END), 1) AS week_avg_score,
        COUNT(*) AS total_count
      FROM orders
    `).get(minScore, minScore) as StatsResult;
  }

  /** Количество обработанных заказов */
  get count(): number {
    const row = this.db.prepare('SELECT COUNT(*) as cnt FROM orders').get() as { cnt: number };
    return row.cnt;
  }

  /** Очистка старых записей (старше N дней) */
  cleanup(daysOld: number = 30): number {
    const result = this.db
      .prepare(`DELETE FROM orders WHERE processed_at < datetime('now', ?)`)
      .run(`-${daysOld} days`);
    if (result.changes > 0) {
      logger.info({ deleted: result.changes, daysOld }, 'Очищены старые записи');
    }
    return result.changes;
  }

  close(): void {
    this.db.close();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS orders (
        order_id    TEXT NOT NULL,
        source      TEXT NOT NULL DEFAULT '',
        title       TEXT DEFAULT '',
        score       INTEGER DEFAULT 0,
        link        TEXT DEFAULT '',
        pitch       TEXT DEFAULT '',
        blacklisted INTEGER DEFAULT 0,
        processed_at TEXT DEFAULT (datetime('now')),
        PRIMARY KEY (order_id, source)
      );
      CREATE INDEX IF NOT EXISTS idx_orders_processed ON orders(processed_at);
    `);
    // Миграции для существующих БД
    for (const sql of [
      `ALTER TABLE orders ADD COLUMN pitch TEXT DEFAULT ''`,
      `ALTER TABLE orders ADD COLUMN reminded_at TEXT DEFAULT NULL`,
    ]) {
      try { this.db.exec(sql); } catch { /* колонка уже есть */ }
    }
  }
}
