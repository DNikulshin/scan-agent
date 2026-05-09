import { logger } from '../../utils/logger';
import { withStealthPage } from './browser';
import type { FreelanceruProfilePayload, FreelanceruServiceItem } from './types';

const SERVICES_LIMIT = 10;

/**
 * Парсит публичный профиль на freelance.ru (страница `/<login>`).
 * Антибот мягкий, но используем тот же stealth-helper для единообразия.
 */
export async function fetchFreelanceruProfile(url: string): Promise<FreelanceruProfilePayload> {
  return withStealthPage('freelanceru', async (page) => {
    logger.info({ url }, '[profile/freelanceru] открываю профиль');

    const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    if (!resp || !resp.ok()) {
      throw new Error(`Freelance.ru profile недоступен: status=${resp?.status() ?? 'no-response'}`);
    }
    await page.waitForTimeout(1_500);

    const payload = await page.evaluate((sourceUrl: string) => {
      const num = (s: string): number => {
        const m = s.match(/[-+]?\d+(?:[.,]\d+)?/);
        return m ? Number(m[0].replace(',', '.')) : 0;
      };
      const tryText = (selectors: string[]): string => {
        for (const s of selectors) {
          const el = document.querySelector<HTMLElement>(s);
          const v = el?.textContent?.trim();
          if (v) return v;
        }
        return '';
      };

      const ratingRaw = tryText([
        '.profile-rating',
        '[class*="rating"][class*="value"]',
        '[class*="rating"]',
      ]);

      const services: { title: string; description: string }[] = [];
      const items = document.querySelectorAll<HTMLElement>(
        '.profile-services .service-item, .services-list .service, [class*="service"][class*="item"]',
      );
      items.forEach((item) => {
        const title =
          item.querySelector<HTMLElement>('.service-title, [class*="title"]')?.textContent?.trim() ??
          item.querySelector<HTMLElement>('h3, h4')?.textContent?.trim() ??
          '';
        const description =
          item.querySelector<HTMLElement>('.service-desc, [class*="description"], p')?.textContent?.trim()
            ?.replace(/\s+/g, ' ')?.slice(0, 200) ?? '';
        if (title) services.push({ title, description });
      });

      return {
        url: sourceUrl,
        rating: num(ratingRaw),
        services,
      };
    }, url);

    logger.info(
      { services: payload.services.length, rating: payload.rating },
      '[profile/freelanceru] снимок собран',
    );
    return {
      url: payload.url,
      rating: payload.rating,
      services: payload.services.slice(0, SERVICES_LIMIT) as FreelanceruServiceItem[],
    };
  });
}
