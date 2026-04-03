import { config } from '../config';
import { createBrowser, debugScreenshot } from './browser';
import type { Order, Parser } from '../types';

/**
 * Парсер Freelance.ru — одна из крупнейших рунет-бирж.
 *
 * Страница заказов: https://freelance.ru/project/search/
 * Категории IT: .../pro/razrabotka-sajtov/, .../pro/programmirovanie/
 *
 * Как и FL.ru, рендерится через JS. Селекторы могут меняться.
 *
 * Если парсер сломался:
 * 1. Открой debug-freelanceru-*.png
 * 2. Обнови config.freelanceru.selectors
 */
export class FreelanceruParser implements Parser {
  name = 'freelanceru';

  async fetchOrders(): Promise<Order[]> {
    if (!config.freelanceru.enabled) {
      console.log('⏭️  [freelanceru] Парсер отключён (FREELANCERU_ENABLED != true)');
      return [];
    }

    const { context, close } = await createBrowser();
    const page = await context.newPage();
    const { selectors } = config.freelanceru;

    try {
      console.log(`🌐 [freelanceru] Открываю ${config.freelanceru.url}`);
      await page.goto(config.freelanceru.url, {
        waitUntil: 'load',
        timeout: 60_000,
      });

      await page.waitForTimeout(5_000);

      // Пробуем найти рабочий селектор карточек
      const cardSelector = await this.findWorkingSelector(page, selectors.card);
      if (!cardSelector) {
        await debugScreenshot(page, 'freelanceru-no-cards');
        console.warn('⚠️  [freelanceru] Не найдены карточки заказов');
        return [];
      }

      const raw = await page.$$eval(
        cardSelector,
        (cards) => {
          return cards.map(card => {
            // Ссылка и заголовок: h2.title a
            const linkEl = card.querySelector('h2.title a, .box-title a') as HTMLAnchorElement | null;
            const href = linkEl?.getAttribute('href') ?? '';
            const link = href.startsWith('http') ? href : `https://freelance.ru${href}`;

            // Заголовок — из атрибута title h2 (чище, без текста вложенных span)
            const h2 = card.querySelector('h2.title') as HTMLElement | null;
            const title = h2?.getAttribute('title') ?? linkEl?.textContent?.trim() ?? '';

            // ID из href: /projects/slug-1665040.html → 1665040
            const idMatch = href.match(/[-_](\d+)\.html$/) || href.match(/\/(\d+)\/?$/);
            const id = idMatch?.[1] ?? '';

            // Описание
            const descEl = card.querySelector('a.description, .description');
            const desc = descEl?.textContent?.trim() ?? '';

            // Цена
            const priceEl = card.querySelector('.cost');
            const price = priceEl?.textContent?.trim() ?? 'Договорная';

            // Откликов нет на карточке — ставим 0
            const offersCount = 0;

            return { id, title, desc, price, link, offersCount, source: 'freelanceru' as const };
          }).filter(o => o.id !== '' && o.title !== '');
        },
      );

      if (raw.length === 0) {
        await debugScreenshot(page, 'freelanceru-empty');
        console.warn('⚠️  [freelanceru] 0 заказов найдено');
      } else {
        console.log(`📋 [freelanceru] Найдено: ${raw.length}`);
      }

      return raw;
    } catch (err) {
      await debugScreenshot(page, 'freelanceru-error');
      console.error('❌ [freelanceru] Ошибка:', (err as Error).message);
      return [];
    } finally {
      await close();
    }
  }

  private async findWorkingSelector(
    page: Awaited<ReturnType<Awaited<ReturnType<typeof createBrowser>>['context']['newPage']>>,
    selectorList: string,
  ): Promise<string | null> {
    const candidates = selectorList.split(',').map(s => s.trim());

    for (const sel of candidates) {
      try {
        const count = await page.$$eval(sel, els => els.length);
        if (count > 0) {
          console.log(`✅ [freelanceru] Селектор работает: "${sel}" (${count} элементов)`);
          return sel;
        }
      } catch {
        // невалидный селектор
      }
    }

    return null;
  }
}
