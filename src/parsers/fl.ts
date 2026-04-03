import { config } from '../config';
import { createBrowser, parseOffersCount, debugScreenshot } from './browser';
import type { Order, Parser } from '../types';

/**
 * Парсер FL.ru — крупнейшая русскоязычная биржа фриланса.
 *
 * FL.ru рендерит страницу через JavaScript (SPA), поэтому нужен Playwright.
 * Страница заказов: https://www.fl.ru/projects/
 *
 * ВАЖНО: FL.ru часто меняет вёрстку. Если парсер сломался:
 * 1. Открой debug-fl-error.png или debug-fl-empty.png
 * 2. Запусти в headless: false (раскомментируй в browser.ts)
 * 3. Через DevTools найди новые селекторы карточек
 * 4. Обнови config.fl.selectors
 *
 * Для доступа ко всем заказам может потребоваться PRO-аккаунт.
 * Без него видны только заказы с пометкой «Доступно без PRO».
 */
export class FlParser implements Parser {
  name = 'fl';

  async fetchOrders(): Promise<Order[]> {
    if (!config.fl.enabled) {
      console.log('⏭️  [fl] Парсер отключён (FL_ENABLED != true)');
      return [];
    }

    const { context, close } = await createBrowser();
    const page = await context.newPage();
    const { selectors } = config.fl;

    try {
      console.log(`🌐 [fl] Открываю ${config.fl.url}`);
      await page.goto(config.fl.url, {
        waitUntil: 'networkidle',
        timeout: 60_000,
      });

      // FL.ru может показать попап авторизации — закроем если есть
      await page.click('[class*="close"], [data-qa="close"]').catch(() => {});
      await page.waitForTimeout(2_000);

      // Ждём карточки заказов — пробуем несколько селекторов
      const cardSelector = await this.findWorkingSelector(page, selectors.card);
      if (!cardSelector) {
        await debugScreenshot(page, 'fl-no-cards');
        console.warn('⚠️  [fl] Не найдены карточки заказов — вёрстка могла измениться');
        return [];
      }

      // Скроллим вниз чтобы подгрузить lazy-loaded карточки
      await autoScroll(page);

      const raw = await page.$$eval(
        cardSelector,
        (cards) => {
          return cards.map(card => {
            // Ищем ссылку и title — FL.ru часто кладёт их в <a> внутри <h2>
            const linkEl =
              card.querySelector('h2 a, h3 a, [class*="title"] a') as HTMLAnchorElement | null;

            const link = linkEl?.href ?? '';
            const title = linkEl?.textContent?.trim() ?? '';

            // ID: FL.ru использует числовые ID в URL /projects/XXXXX/
            const idMatch = link.match(/\/projects?\/(\d+)/);
            const id = idMatch?.[1] ?? '';

            // Описание
            const descEl = card.querySelector(
              '[class*="description"], [class*="body"], [class*="txt"], p'
            );
            const desc = descEl?.textContent?.trim() ?? '';

            // Цена — FL.ru пишет "Договорная" или "от XX XXX руб."
            const priceEl = card.querySelector(
              '[class*="price"], [class*="budget"], .cost'
            );
            const price = priceEl?.textContent?.trim() ?? 'Договорная';

            // Количество откликов
            const offersEl = card.querySelector(
              '[class*="response"], [class*="count"], [class*="offers"]'
            );
            const offersText = offersEl?.textContent?.trim() ?? '';
            const offersMatch = offersText.match(/\d+/);
            const offersCount = offersMatch ? parseInt(offersMatch[0], 10) : 999;

            return { id, title, desc, price, link, offersCount, source: 'fl' as const };
          }).filter(o => o.id !== '' && o.title !== '');
        },
      );

      if (raw.length === 0) {
        await debugScreenshot(page, 'fl-empty');
        console.warn('⚠️  [fl] 0 заказов найдено');
      } else {
        console.log(`📋 [fl] Найдено: ${raw.length}`);
      }

      return raw;
    } catch (err) {
      await debugScreenshot(page, 'fl-error');
      console.error('❌ [fl] Ошибка:', (err as Error).message);
      return [];
    } finally {
      await close();
    }
  }

  /**
   * FL.ru периодически меняет CSS-классы.
   * Пробуем несколько селекторов и возвращаем первый рабочий.
   */
  private async findWorkingSelector(
    page: Awaited<ReturnType<Awaited<ReturnType<typeof createBrowser>>['context']['newPage']>>,
    selectorList: string,
  ): Promise<string | null> {
    const candidates = selectorList.split(',').map(s => s.trim());

    for (const sel of candidates) {
      try {
        const count = await page.$$eval(sel, els => els.length);
        if (count > 0) {
          console.log(`✅ [fl] Селектор работает: "${sel}" (${count} элементов)`);
          return sel;
        }
      } catch {
        // селектор невалиден — пропускаем
      }
    }

    return null;
  }
}

/** Плавный скролл для подгрузки lazy-loaded контента */
async function autoScroll(
  page: Awaited<ReturnType<Awaited<ReturnType<typeof createBrowser>>['context']['newPage']>>,
): Promise<void> {
  await page.evaluate(async () => {
    await new Promise<void>(resolve => {
      let totalHeight = 0;
      const distance = 400;
      const timer = setInterval(() => {
        window.scrollBy(0, distance);
        totalHeight += distance;
        if (totalHeight >= document.body.scrollHeight || totalHeight > 5000) {
          clearInterval(timer);
          resolve();
        }
      }, 200);
    });
  });
  await page.waitForTimeout(1_000);
}
