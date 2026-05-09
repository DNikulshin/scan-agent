import { logger } from '../../utils/logger';
import { withStealthPage } from './browser';
import type { FlProfilePayload, FlPortfolioItem } from './types';

const PORTFOLIO_LIMIT = 8;

/**
 * Парсит публичный профиль фрилансера на FL.ru (страница `/users/<login>/portfolio/`).
 * Селекторы — с фоллбэками: FL часто меняет вёрстку (см. парсер заказов).
 */
export async function fetchFlProfile(url: string): Promise<FlProfilePayload> {
  return withStealthPage('fl', async (page) => {
    logger.info({ url }, '[profile/fl] открываю профиль');

    const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    if (!resp || !resp.ok()) {
      throw new Error(`FL profile недоступен: status=${resp?.status() ?? 'no-response'}`);
    }
    await page.click('[class*="close"], [data-qa="close"]').catch(() => {});
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
        '.b-rating__count',
        '.user-rating-circle__num',
        '[class*="rating"][class*="count"]',
        '[class*="rating"]',
      ]);
      const reviewsRaw = tryText([
        '.b-rating__numb',
        '.user-rating-reviews-count',
        '[class*="reviews"][class*="count"]',
        '[class*="feedback"][class*="count"]',
      ]);

      const specializations: string[] = [];
      const specContainer =
        document.querySelector<HTMLElement>('.user-categories') ??
        document.querySelector<HTMLElement>('.user-specializations') ??
        document.querySelector<HTMLElement>('[class*="categor"]');
      if (specContainer) {
        specContainer.querySelectorAll<HTMLElement>('a, li, span').forEach((el) => {
          const t = el.textContent?.trim();
          if (t && t.length > 1 && t.length < 80 && !specializations.includes(t)) {
            specializations.push(t);
          }
        });
      }

      const portfolio: { title: string; description: string; link: string }[] = [];
      const cards = document.querySelectorAll<HTMLElement>(
        '.b-portfolio__item, .portfolio-item, [class*="portfolio"][class*="item"], [data-qa*="portfolio"]',
      );
      cards.forEach((card) => {
        const linkEl = card.querySelector<HTMLAnchorElement>('a[href]');
        const link = linkEl?.href ?? '';
        const title =
          linkEl?.getAttribute('title')?.trim() ??
          card.querySelector<HTMLElement>('.b-portfolio__title, [class*="title"]')?.textContent?.trim() ??
          linkEl?.textContent?.trim() ??
          '';
        const description =
          card.querySelector<HTMLElement>('.b-portfolio__desc, [class*="description"], [class*="text"]')?.textContent?.trim()
            ?.replace(/\s+/g, ' ')
            ?.slice(0, 200) ?? '';
        if (title && link) {
          portfolio.push({ title, description, link });
        }
      });

      return {
        url: sourceUrl,
        rating: num(ratingRaw),
        reviewsCount: num(reviewsRaw),
        specializations: specializations.slice(0, 12),
        portfolio: portfolio.slice(0, 8),
      };
    }, url);

    logger.info(
      { portfolio: payload.portfolio.length, rating: payload.rating },
      '[profile/fl] снимок собран',
    );
    return {
      url: payload.url,
      rating: payload.rating,
      reviewsCount: payload.reviewsCount,
      specializations: payload.specializations,
      portfolio: payload.portfolio.slice(0, PORTFOLIO_LIMIT) as FlPortfolioItem[],
    };
  });
}
