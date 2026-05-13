import type { Page } from "playwright";
import { createBrowser } from "../parsers/browser";
import type { Storage } from "../core/storage";
import type { OrderToEnrich } from "../core/storage";
import { config } from "../config";
import { logger } from "../utils/logger";

export async function enrichOrders(storage: Storage, limit = 10) {
  const orders = await storage.getOrdersWithoutPublishedAt(limit);
  if (!orders.length) {
    logger.info("[enrich] Нет заказов для обогащения");
    return;
  }
  logger.info(`[enrich] Обогащаем ${orders.length} заказов...`);

  const { context, close } = await createBrowser();
  const page = await context.newPage();

  try {
    for (const order of orders) {
      try {
        const date = await fetchPublishedDate(page, order);
        if (date) {
          await storage.setPublishedAt(order.id, date);
          logger.info({ orderId: order.id }, "[enrich] published_at обновлен");
        } else {
          logger.debug(
            { orderId: order.id, source: order.source },
            "[enrich] Дата не найдена",
          );
        }
      } catch (err) {
        logger.error(
          { err, orderId: order.id },
          "[enrich] Ошибка обработки заказа",
        );
      }
      await new Promise((r) => setTimeout(r, 2_000));
    }
  } finally {
    await close();
  }
}

async function fetchPublishedDate(
  page: Page,
  order: OrderToEnrich,
): Promise<Date | null> {
  if (order.source === "hh") {
    return fetchHhPublishedDate(page, order.link);
  }
  if (order.source === "fl") {
    return fetchFlPublishedDate(page, order.link);
  }
  if (order.source === "kwork") {
    return fetchKworkPublishedDate(page, order.link);
  }
  if (order.source === "freelanceru") {
    return fetchFreelanceruPublishedDate(page, order.link);
  }
  return null;
}

async function fetchHhPublishedDate(
  page: Page,
  link: string,
): Promise<Date | null> {
  await page.goto(link, { waitUntil: "domcontentloaded", timeout: 20_000 });
  const dateStr = await page.evaluate(() => {
    const scripts = Array.from(
      document.querySelectorAll('script[type="application/ld+json"]'),
    );
    for (const s of scripts) {
      const raw = s.textContent;
      if (!raw) continue;
      try {
        const data = JSON.parse(raw);
        // На HH иногда массив JSON-LD; выбираем именно JobPosting.
        const candidates = Array.isArray(data) ? data : [data];
        for (const c of candidates) {
          if (c && c["@type"] === "JobPosting" && c.datePosted) {
            return c.datePosted as string;
          }
        }
      } catch {
        // пропускаем битый JSON
      }
    }
    return null;
  });
  return dateStr ? new Date(dateStr) : null;
}

async function fetchFlPublishedDate(
  page: Page,
  link: string,
): Promise<Date | null> {
  await page.goto(link, { waitUntil: "domcontentloaded", timeout: 20_000 });
  await page
    .waitForSelector(".fl-project-content", { timeout: 5000 })
    .catch(() => null);
  const text = await page.evaluate(() => {
    const el = document.querySelector(".fl-project-content");
    return el?.textContent?.trim() ?? null;
  });
  if (!text) return null;
  const match = text.match(/Опубликован\s+(\d{2}\.\d{2}\.\d{4})\s+в\s+(\d{2}:\d{2})/);
  if (!match) {
    logger.warn({ link }, "[enrich.fl] regex не нашёл дату — изменилась вёрстка?");
    return null;
  }
  const [day, month, year] = match[1].split(".").map(Number);
  const [hours, minutes] = match[2].split(":").map(Number);
  return new Date(year, month - 1, day, hours, minutes);
}

// Kwork не отдаёт явный timestamp публикации (проверено 2026-05-13: нет
// JobPosting JSON-LD, нет <time>, нет og-meta/itemprop=datePublished).
// Единственный сигнал — счётчик «Осталось», поэтому считаем
// published ≈ now - (TTL - remaining). TTL настраивается через
// KWORK_ENRICH_TTL_HOURS (дефолт 48ч).
//
// Форматы счётчика:
//   больше суток:  «Осталось: 1 д. 23 ч.»
//   меньше суток:  «Осталось: 5 ч. 12 мин.»
async function fetchKworkPublishedDate(
  page: Page,
  link: string,
): Promise<Date | null> {
  await page.goto(link, { waitUntil: "domcontentloaded", timeout: 20_000 });
  await page
    .waitForSelector(".want-card__informers-row span", { timeout: 5000 })
    .catch(() => null);
  const remainText = await page.evaluate(() => {
    const el = document.querySelector(".want-card__informers-row span");
    return el?.textContent?.trim() ?? null;
  });
  if (!remainText) {
    logger.warn({ link }, "[enrich.kwork] селектор .want-card__informers-row span пуст");
    return null;
  }

  let remainingMinutes: number | null = null;
  // «Осталось: 1 д. 23 ч.»
  const daysMatch = remainText.match(/Осталось:\s*(\d+)\s*д\.?\s*(\d+)?\s*ч\.?/);
  if (daysMatch) {
    const d = parseInt(daysMatch[1], 10);
    const h = daysMatch[2] ? parseInt(daysMatch[2], 10) : 0;
    remainingMinutes = (d * 24 + h) * 60;
  } else {
    // «Осталось: 5 ч. 12 мин.»
    const hoursMatch = remainText.match(/Осталось:\s*(\d+)\s*ч\.?\s*(\d+)?\s*мин\.?/);
    if (hoursMatch) {
      const h = parseInt(hoursMatch[1], 10);
      const m = hoursMatch[2] ? parseInt(hoursMatch[2], 10) : 0;
      remainingMinutes = h * 60 + m;
    }
  }

  if (remainingMinutes === null) {
    logger.warn(
      { link, remainText },
      "[enrich.kwork] не распознан формат «Осталось»",
    );
    return null;
  }

  const ttlMinutes = config.kwork.enrichTtlHours * 60;
  const elapsedMinutes = Math.max(0, ttlMinutes - remainingMinutes);
  logger.debug(
    {
      link,
      remainText,
      remainingMinutes,
      ttlMinutes,
      elapsedMinutes,
      source_path: "ttl-fallback",
    },
    "[enrich.kwork] published ≈ now - (TTL - remaining)",
  );
  return new Date(Date.now() - elapsedMinutes * 60 * 1000);
}

async function fetchFreelanceruPublishedDate(
  page: Page,
  link: string,
): Promise<Date | null> {
  await page.goto(link, { waitUntil: "domcontentloaded", timeout: 20_000 });
  const dateStr = await page.evaluate(() => {
    const rows = document.querySelectorAll("table tr");
    for (const row of rows) {
      const cells = row.querySelectorAll("td");
      if (
        cells.length >= 2 &&
        cells[0].textContent?.trim() === "Дата публикации:"
      ) {
        return cells[1].textContent?.trim() ?? null;
      }
    }
    return null;
  });
  return dateStr ? new Date(dateStr) : null;
}
