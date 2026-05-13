import { createBrowser } from "../parsers/browser";
import type { Storage } from "../core/storage";
import type { OrderToEnrich } from "../core/storage";
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
  page: any,
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
  page: any,
  link: string,
): Promise<Date | null> {
  await page.goto(link, { waitUntil: "domcontentloaded", timeout: 20_000 });
  const dateStr = await page.evaluate(() => {
    const script = document.querySelector('script[type="application/ld+json"]');
    if (!script) return null;
    try {
      const data = JSON.parse(script.textContent);
      return data.datePosted || null;
    } catch {
      return null;
    }
  });
  return dateStr ? new Date(dateStr) : null;
}

async function fetchFlPublishedDate(page: any, link: string): Promise<Date | null> {
  await page.goto(link, { waitUntil: 'domcontentloaded', timeout: 20_000 });
  await page.waitForSelector('.fl-project-content', { timeout: 5000 }).catch(() => null);
  const text = await page.evaluate(() => {
    const el = document.querySelector('.fl-project-content');
    return el?.textContent?.trim() ?? null;
  });
  if (!text) return null;
  const match = text.match(/Опубликован\s+(\d{2}\.\d{2}\.\d{4})\s+в\s+(\d{2}:\d{2})/);
  if (!match) return null;
  const [day, month, year] = match[1].split('.').map(Number);
  const [hours, minutes] = match[2].split(':').map(Number);
  return new Date(year, month - 1, day, hours, minutes);
}

async function fetchKworkPublishedDate(
  page: any,
  link: string,
): Promise<Date | null> {
  await page.goto(link, { waitUntil: "domcontentloaded", timeout: 20_000 });
  // Ждём блок с «Осталось»
  await page
    .waitForSelector(".want-card__informers-row span", { timeout: 5000 })
    .catch(() => null);
  const remainText = await page.evaluate(() => {
    const el = document.querySelector(".want-card__informers-row span");
    return el?.textContent?.trim() ?? null;
  });
  if (!remainText) return null;
  const match = remainText.match(/Осталось:\s*(\d+)\s*ч\.?\s*(\d+)\s*мин\.?/);
  if (!match) return null;
  const hours = parseInt(match[1], 10);
  const minutes = parseInt(match[2], 10);
  return new Date(Date.now() - (hours * 60 + minutes) * 60 * 1000);
}

async function fetchFreelanceruPublishedDate(
  page: any,
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
