import type { Page } from "playwright";
import { config } from "../config";
import { createBrowser, debugScreenshot } from "./browser";
import type { Order, Parser } from "../types";

/**
 * Парсер FL.ru — крупнейшая русскоязычная биржа фриланса.
 *
 * Стратегия:
 * - Страница 1: page.goto() + $$eval()
 * - Страницы 2+: fetch() внутри браузера (сессия сохраняется) + DOMParser
 * - Случайные задержки между страницами (fetchDelay из конфига)
 * - Ротация User-Agent (userAgents из конфига)
 * - Предфильтр: hardExclude + skillsWeight (до AI-вызовов)
 *
 * Если парсер сломался:
 * 1. Открой debug-fl-*.png
 * 2. Обнови config.fl.selectors
 */

const FL_PREFIX = "[FL]";

/** Вспомогательные функции */
function randomDelay(): number {
  const [min, max] = config.fl.fetchDelay;
  return Math.floor(Math.random() * (max - min) + min);
}

function randomUA(): string {
  const uas = config.fl.userAgents;
  return uas[Math.floor(Math.random() * uas.length)];
}

/**
 * Строит URL нужной страницы, сохраняя query-string базового URL.
 * Например: `https://www.fl.ru/projects/?kind=1` + page=2 →
 *           `https://www.fl.ru/projects/page-2/?kind=1`
 */
function buildPageUrl(baseUrl: string, page: number): string {
  const u = new URL(baseUrl);
  // Удаляем существующий /page-N/ из pathname
  u.pathname = u.pathname.replace(/\/page-\d+\/?$/, "");
  // Гарантируем trailing slash
  if (!u.pathname.endsWith("/")) u.pathname += "/";
  if (page > 1) u.pathname += `page-${page}/`;
  return u.toString();
}

/**
 * Нормализует строку для гибкого сравнения навыков.
 * Next.js → nextjs, React Native → reactnative, GitHub-Actions → githubactions
 */
function normalizeSkill(s: string): string {
  return s.toLowerCase().replace(/[\s\-\._]/g, "");
}

/**
 * Считает скор релевантности по skillsWeight.
 * Возвращает суммарный вес совпавших навыков.
 *
 * Улучшения:
 * - Нормализация для гибкого матча (Next.js / nextjs / next-js)
 * - Word-boundary проверка для защиты от ложных срабатываний (react ≠ reactive)
 * - Дедупликация в matched
 */
function calcSkillScore(text: string): { score: number; matched: string[] } {
  const textLower = text.toLowerCase();
  const textNormalized = normalizeSkill(textLower);

  let score = 0;
  const matched: string[] = [];

  for (const [skill, weight] of Object.entries(config.fl.skillsWeight)) {
    const skillLower = skill.toLowerCase();
    const skillNormalized = normalizeSkill(skillLower);
    const skillWords = skillLower.split(/[\s\-\._]+/).filter(Boolean);

    // Проверка 1: нормализованное включение (ловит вариации написания)
    const normalizedMatch = textNormalized.includes(skillNormalized);

    // Проверка 2: все слова навыка встречаются как отдельные слова (защита от ложных срабатываний)
    const wordsMatch = skillWords.every((word) =>
      new RegExp(
        `\\b${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`,
        "i",
      ).test(textLower),
    );

    // Совпадение только если оба условия + нет дублей
    if (normalizedMatch && wordsMatch && !matched.includes(skill)) {
      score += weight;
      matched.push(skill);
    }
  }

  return { score, matched };
}

/**
 * Проверяет попадание под hardExclude.
 * Возвращает слово-триггер или null.
 *
 * Улучшение: используем \b для точного совпадения слов
 * (исключаем "диплом", но не "дипломат")
 */
function checkHardExclude(text: string): string | null {
  const textLower = text.toLowerCase();
  for (const word of config.fl.hardExclude) {
    const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const regex = new RegExp(`\\b${escaped}\\b`, "i");
    if (regex.test(textLower)) return word;
  }
  return null;
}

/**
 * Кликает фильтр «Не требуется оплата отклика» на FL.ru.
 * Возвращает URL после применения фильтра (для использования как база пагинации).
 * Если чекбокс не найден / клик не сработал — возвращает null, парсер продолжит без фильтра.
 */
async function applyFreeResponsesFilter(page: Page): Promise<string | null> {
  try {
    const label = page
      .locator('label[for="ui-checkbox-check-for-all"]')
      .first();
    if ((await label.count()) === 0) {
      console.warn(
        `⚠️  ${FL_PREFIX} Чекбокс "Не требуется оплата отклика" не найден — вёрстка изменилась?`,
      );
      return null;
    }

    const urlBefore = page.url();
    await label.scrollIntoViewIfNeeded().catch(() => {});
    await label.click({ timeout: 5_000 });

    // Фильтр может либо перезагрузить страницу (URL меняется), либо обновить через AJAX
    await page
      .waitForLoadState("domcontentloaded", { timeout: 10_000 })
      .catch(() => {});
    await page.waitForTimeout(2_000);

    const urlAfter = page.url();
    if (urlAfter !== urlBefore) {
      console.log(
        `✅ ${FL_PREFIX} Фильтр "бесплатные отклики" → ${urlAfter}`,
      );
    } else {
      console.log(
        `✅ ${FL_PREFIX} Фильтр "бесплатные отклики" применён (без смены URL)`,
      );
    }
    return urlAfter;
  } catch (err) {
    console.warn(
      `⚠️  ${FL_PREFIX} Не удалось применить фильтр "бесплатные отклики":`,
      (err as Error).message,
    );
    return null;
  }
}

/** Тип сырой карточки — используется внутри page.evaluate */
interface RawCard {
  id: string;
  title: string;
  desc: string;
  price: string;
  link: string;
  offersCount: number;
}

/**
 * Парсит карточки из переданного документа.
 * Если html === null — берём текущий document (page 1).
 * Иначе — парсим HTML через DOMParser (page 2+).
 *
 * Передаётся в page.evaluate как обычная стрелочная функция —
 * это надёжнее, чем new Function() (Playwright корректно сериализует).
 */
function parseCardsInBrowser(html: string | null): RawCard[] {
  const doc: Document = html
    ? new DOMParser().parseFromString(html, "text/html")
    : document;

  const CARD_SELECTORS = ['[data-qa="project-item"]', ".b-post"];
  const TITLE_SELECTORS = [
    '[data-qa="project-item-title"] a',
    ".b-post__title a",
    "h2 a",
    "h3 a",
    '[class*="title"] a',
  ];
  const DESC_SELECTORS = [
    '[data-qa="project-item-description"]',
    ".b-post__body",
    ".b-post__txt",
    '[class*="description"]',
    '[class*="body"]',
    "p",
  ];
  const PRICE_SELECTORS = [
    '[data-qa="project-item-budget"]',
    ".b-post__price",
    ".text-6",
    '[class*="price"]',
    '[class*="budget"]',
  ];
  const OFFERS_SELECTORS = [
    '[data-qa="project-item-responses"]',
    ".b-post__count",
    ".text-5",
    '[class*="response"]',
    '[class*="count"]',
    '[class*="offers"]',
  ];

  const qs = <T extends Element = Element>(
    el: Element | Document,
    selectors: string[],
  ): T | null => {
    for (const s of selectors) {
      try {
        const found = el.querySelector<T>(s);
        if (found) return found;
      } catch {}
    }
    return null;
  };

  let cards: Element[] = [];
  for (const s of CARD_SELECTORS) {
    try {
      const found = doc.querySelectorAll(s);
      if (found && found.length) {
        cards = Array.from(found);
        break;
      }
    } catch {}
  }

  return cards
    .map((card) => {
      const linkEl = qs<HTMLAnchorElement>(card, TITLE_SELECTORS);
      const link = linkEl?.href || linkEl?.getAttribute("href") || "";
      const title = (linkEl?.textContent ?? "").trim();
      const idMatch = link.match(/\/projects?\/(\d+)/);
      const id = idMatch?.[1] ?? "";

      const descEl = qs(card, DESC_SELECTORS);
      const desc = (descEl?.textContent ?? "").trim().slice(0, 300);

      const priceEl = qs(card, PRICE_SELECTORS);
      const price = (priceEl?.textContent ?? "").trim() || "Договорная";

      const offersEl = qs(card, OFFERS_SELECTORS);
      const offersMatch = (offersEl?.textContent ?? "").trim().match(/\d+/);
      const offersCount = offersMatch ? parseInt(offersMatch[0], 10) : 0;

      return { id, title, desc, price, link, offersCount };
    })
    .filter((o): o is RawCard => o.id !== "" && o.title !== "");
}

export class FlParser implements Parser {
  name = "fl";

  async fetchOrders(): Promise<Order[]> {
    if (!config.fl.enabled) {
      console.log(`⏭️  ${FL_PREFIX} Парсер отключён (FL_ENABLED != true)`);
      return [];
    }

    const ua = randomUA();
    console.log(`🤖 ${FL_PREFIX} User-Agent: ${ua.slice(0, 60)}...`);

    const { context, close } = await createBrowser({ userAgent: ua });
    const page = await context.newPage();
    const baseUrl = config.fl.url;
    const allRaw: RawCard[] = [];

    try {
      // ── Страница 1: полная навигация ──
      const page1Url = buildPageUrl(baseUrl, 1);
      console.log(`🌐 ${FL_PREFIX} Открываю ${page1Url}`);

      await page.goto(page1Url, {
        waitUntil: "domcontentloaded", // ← быстрее, стабильнее
        timeout: 30_000,
      });

      // Закрываем попап авторизации если есть
      await page.click('[class*="close"], [data-qa="close"]').catch(() => {});
      await page.waitForTimeout(1_500);

      // Применяем фильтр «Не требуется оплата отклика» (если включено)
      let paginationBaseUrl = baseUrl;
      if (config.fl.onlyFreeResponses) {
        const filteredUrl = await applyFreeResponsesFilter(page);
        if (filteredUrl) paginationBaseUrl = filteredUrl;
      }

      // Проверяем наличие карточек
      const hasCards = await page.evaluate(() => {
        const sels = ['[data-qa="project-item"]', ".b-post"];
        for (const s of sels) {
          if (document.querySelectorAll(s).length > 0) return true;
        }
        return false;
      });

      if (!hasCards) {
        await debugScreenshot(page, "fl-no-cards");
        console.warn(
          `⚠️  ${FL_PREFIX} Не найдены карточки на странице 1 — вёрстка могла измениться`,
        );
        return [];
      }

      const page1Cards = await page.evaluate(parseCardsInBrowser, null);
      console.log(`✅ ${FL_PREFIX} Страница 1: ${page1Cards.length} проектов`);
      allRaw.push(...page1Cards);

      // ── Страницы 2..maxPages: fetch() внутри браузера ──
      for (let pageNum = 2; pageNum <= config.fl.maxPages; pageNum++) {
        const delay = randomDelay();
        await page.waitForTimeout(delay);

        const pageUrl = buildPageUrl(paginationBaseUrl, pageNum);

        const result = await page.evaluate(async (url: string) => {
          try {
            const resp = await fetch(url, {
              credentials: "include",
              headers: { Accept: "text/html,application/xhtml+xml" },
            });
            if (!resp.ok || resp.status === 404) return null;
            return await resp.text();
          } catch {
            return null;
          }
        }, pageUrl);

        if (result === null) {
          console.log(
            `⛔ ${FL_PREFIX} Остановка на странице ${pageNum} (пустой ответ или 404)`,
          );
          break;
        }

        // Парсим HTML в браузерном контексте
        const pageCards = await page.evaluate(parseCardsInBrowser, result);

        if (pageCards.length === 0) {
          console.log(
            `⛔ ${FL_PREFIX} Пустая страница ${pageNum} — останавливаемся`,
          );
          break;
        }

        console.log(
          `✅ ${FL_PREFIX} Страница ${pageNum}: +${pageCards.length} (всего ${allRaw.length + pageCards.length})`,
        );
        allRaw.push(...pageCards);
      }

      console.log(`📋 ${FL_PREFIX} Собрано всего: ${allRaw.length} проектов`);

      // ── Предфильтрация: hardExclude + skillsWeight ──
      const filtered: Order[] = [];
      let excludedCount = 0;
      let lowScoreCount = 0;

      for (const raw of allRaw) {
        const text = `${raw.title} ${raw.desc}`;

        // 1. hardExclude (с word-boundary)
        const excludeTrigger = checkHardExclude(text);
        if (excludeTrigger) {
          console.log(
            `🚫 ${FL_PREFIX} hardExclude [${excludeTrigger}]: ${raw.title.slice(0, 60)}`,
          );
          excludedCount++;
          continue;
        }

        // 2. skillsWeight — фильтруем нерелевантные до AI
        const { score, matched } = calcSkillScore(text);
        if (score === 0) {
          console.log(
            `⏭️  ${FL_PREFIX} Нет релевантных навыков: ${raw.title.slice(0, 60)}`,
          );
          lowScoreCount++;
          continue;
        }

        console.log(
          `✅ ${FL_PREFIX} Релевантно (skill_score=${score}, [${matched.slice(0, 3).join(", ")}]): ${raw.title.slice(0, 50)}`,
        );

        filtered.push({
          id: raw.id,
          title: raw.title,
          desc: raw.desc,
          price: raw.price,
          link: raw.link,
          offersCount: raw.offersCount, // ← теперь корректный 0 вместо 999
          source: "fl",
        });
      }

      console.log(
        `📊 ${FL_PREFIX} Итого: ${allRaw.length} собрано → ` +
          `${excludedCount} hardExclude → ` +
          `${lowScoreCount} нет навыков → ` +
          `${filtered.length} передано в pipeline`,
      );

      if (filtered.length === 0) {
        await debugScreenshot(page, "fl-empty-filtered");
        console.warn(`⚠️  ${FL_PREFIX} 0 заказов после фильтрации`);
      }

      return filtered;
    } catch (err) {
      await debugScreenshot(page, "fl-error");
      console.error(`❌ ${FL_PREFIX} Ошибка:`, (err as Error).message);
      return [];
    } finally {
      await close();
    }
  }
}
