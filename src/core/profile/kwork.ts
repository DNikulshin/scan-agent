import { logger } from '../../utils/logger';
import { withStealthPage } from './browser';
import type { KworkProfilePayload, KworkGigItem } from './types';

const GIGS_LIMIT = 10;

/**
 * Парсит публичный профиль продавца Kwork.ru (страница `/user/<login>`).
 * Возвращает рейтинг, кол-во отзывов и список услуг (gigs).
 */
export async function fetchKworkProfile(url: string): Promise<KworkProfilePayload> {
  return withStealthPage('kwork', async (page) => {
    logger.info({ url }, '[profile/kwork] открываю профиль');

    const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    if (!resp || !resp.ok()) {
      throw new Error(`Kwork profile недоступен: status=${resp?.status() ?? 'no-response'}`);
    }
    await page.waitForTimeout(1_500);

    const payload = await page.evaluate((sourceUrl: string) => {
      const num = (s: string): number => {
        const m = s.match(/[-+]?\d+(?:[.,]\d+)?/);
        return m ? Number(m[0].replace(',', '.')) : 0;
      };
      const text = (sel: string): string =>
        document.querySelector<HTMLElement>(sel)?.textContent?.trim() ?? '';
      const tryText = (selectors: string[]): string => {
        for (const s of selectors) {
          const v = text(s);
          if (v) return v;
        }
        return '';
      };

      const ratingRaw = tryText([
        '.user-header__rating',
        '[class*="rating"][class*="value"]',
        '[class*="rating"]',
      ]);
      const reviewsRaw = tryText([
        '.user-header__feedback-count',
        '[class*="feedback"][class*="count"]',
        '[class*="reviews"]',
      ]);

      const gigs: { title: string; price: string; reviewsCount: number; link: string }[] = [];
      const cards = document.querySelectorAll<HTMLElement>(
        '.want-card, .kwork-item, [class*="kwork"][class*="card"], [data-qa*="kwork-card"]',
      );
      cards.forEach((card) => {
        const linkEl = card.querySelector<HTMLAnchorElement>('a[href]');
        const link = linkEl?.href ?? '';
        const title =
          card.querySelector<HTMLElement>('.kwork-item__title, [class*="title"]')?.textContent?.trim() ??
          linkEl?.textContent?.trim() ??
          '';
        const price =
          card.querySelector<HTMLElement>('.kwork-item__price, [class*="price"]')?.textContent?.trim()?.replace(/\s+/g, ' ') ?? '';
        const reviewsRaw =
          card.querySelector<HTMLElement>('.kwork-item__reviews, [class*="reviews"]')?.textContent?.trim() ?? '';
        if (title && link) {
          gigs.push({ title, price, reviewsCount: num(reviewsRaw), link });
        }
      });

      return {
        url: sourceUrl,
        rating: num(ratingRaw),
        reviewsCount: num(reviewsRaw),
        gigs,
      };
    }, url);

    logger.info(
      { gigs: payload.gigs.length, rating: payload.rating },
      '[profile/kwork] снимок собран',
    );
    return {
      url: payload.url,
      rating: payload.rating,
      reviewsCount: payload.reviewsCount,
      gigs: payload.gigs.slice(0, GIGS_LIMIT) as KworkGigItem[],
    };
  });
}
