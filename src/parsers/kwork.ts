import { config } from '../config';
import { createBrowser, debugScreenshot } from './browser';
import type { Order, Parser } from '../types';

const { selectors } = config.kwork;

export class KworkParser implements Parser {
  name = 'kwork';

  async fetchOrders(): Promise<Order[]> {
    const { context, close } = await createBrowser();
    const page = await context.newPage();

    try {
      console.log(`🌐 [kwork] Открываю ${config.kwork.url}`);
      await page.goto(config.kwork.url, {
        waitUntil: 'networkidle',
        timeout: 60_000,
      });

      await page.waitForSelector(selectors.card, { timeout: 15_000 });

      const raw = await page.$$eval(
        selectors.card,
        (cards, sel) =>
          cards.map(c => {
            const linkEl = c.querySelector('a') as HTMLAnchorElement | null;
            const link = linkEl?.href ?? '';
            const idMatch = link.match(/\/projects\/(\d+)/);

            let offersCount = 999;
            c.querySelectorAll(sel.offersContainer).forEach((el: Element) => {
              const t = el.textContent?.trim() ?? '';
              if (t.includes('Предложений')) {
                const m = t.match(/\d+/);
                if (m) offersCount = parseInt(m[0], 10);
              }
            });

            return {
              id: idMatch?.[1] ?? '',
              title: c.querySelector(sel.title)?.textContent?.trim() ?? '',
              desc: c.querySelector(sel.description)?.textContent?.trim() ?? '',
              price: c.querySelector(sel.price)?.textContent?.trim() ?? '',
              link,
              offersCount,
              source: 'kwork' as const,
            };
          }).filter(o => o.id !== ''),
        selectors,
      );

      if (raw.length === 0) {
        await debugScreenshot(page, 'kwork-empty');
        console.warn('⚠️  [kwork] 0 заказов — возможно, изменилась вёрстка');
      } else {
        console.log(`📋 [kwork] Найдено: ${raw.length}`);
      }

      return raw;
    } catch (err) {
      await debugScreenshot(page, 'kwork-error');
      console.error('❌ [kwork] Ошибка:', (err as Error).message);
      return [];
    } finally {
      await close();
    }
  }
}
