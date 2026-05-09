import { logger } from '../../utils/logger';
import { withStealthPage } from './browser';
import type { FlProfilePayload, FlPortfolioItem } from './types';

const PORTFOLIO_LIMIT = 8;
const SPECIALIZATIONS_LIMIT = 12;

export async function fetchFlProfile(url: string): Promise<FlProfilePayload> {
  const base = normalizeBase(url);

  return withStealthPage('fl', async (page) => {
    logger.info({ base }, '[profile/fl] открываю профиль');

    const ratingUrl = `${base}/rating/`;
    let rating = 0;
    let reviewsCount = 0;

    const ratingResp = await page.goto(ratingUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    if (ratingResp && ratingResp.ok()) {
      await page.waitForTimeout(800);
      const ratingData = await page.evaluate(() => {
        const num = (s: string | null | undefined): number => {
          if (!s) return 0;
          const m = s.match(/[-+]?\d+(?:[.,]\d+)?/);
          return m ? Number(m[0].replace(',', '.')) : 0;
        };
        const ratingText = document
          .querySelector<HTMLElement>('div.rating p.b-text__bold')
          ?.textContent?.trim();
        const reviewsText = document
          .querySelector<HTMLElement>('div.rating .b-rating__numb, div.rating [class*="reviews"]')
          ?.textContent?.trim();
        return { rating: num(ratingText), reviewsCount: num(reviewsText) };
      });
      rating = ratingData.rating;
      reviewsCount = ratingData.reviewsCount;
    } else {
      logger.warn({ ratingUrl, status: ratingResp?.status() }, '[profile/fl] /rating/ недоступна');
    }

    const portfolioUrl = `${base}/portfolio/`;
    const portfolioResp = await page.goto(portfolioUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    if (!portfolioResp || !portfolioResp.ok()) {
      throw new Error(`FL portfolio недоступен: status=${portfolioResp?.status() ?? 'no-response'}`);
    }
    await page.click('[class*="close"], [data-qa="close"]').catch(() => {});
    await page.waitForTimeout(1_000);

    const portfolioData = await page.evaluate(() => {
      const specializations: string[] = [];
      const specContainer = document.querySelector<HTMLElement>('.user-categories');
      if (specContainer) {
        specContainer.querySelectorAll<HTMLAnchorElement>('a').forEach((el) => {
          const t = el.textContent?.trim();
          if (t && t.length > 1 && t.length < 80 && !specializations.includes(t)) {
            specializations.push(t);
          }
        });
      }

      const portfolio: { title: string; description: string; link: string }[] = [];
      const cards = document.querySelectorAll<HTMLElement>('.b-portfolio__item');
      cards.forEach((card) => {
        const linkEl = card.querySelector<HTMLAnchorElement>('a[href]');
        const link = linkEl?.href ?? '';
        const title =
          linkEl?.getAttribute('title')?.trim() ??
          card.querySelector<HTMLElement>('.b-portfolio__title')?.textContent?.trim() ??
          linkEl?.textContent?.trim() ??
          '';
        const description =
          card
            .querySelector<HTMLElement>('.b-portfolio__desc')
            ?.textContent?.trim()
            ?.replace(/\s+/g, ' ')
            ?.slice(0, 200) ?? '';
        if (title && link) {
          portfolio.push({ title, description, link });
        }
      });

      return { specializations, portfolio };
    });

    const payload: FlProfilePayload = {
      url: base,
      rating,
      reviewsCount,
      specializations: portfolioData.specializations.slice(0, SPECIALIZATIONS_LIMIT),
      portfolio: portfolioData.portfolio.slice(0, PORTFOLIO_LIMIT) as FlPortfolioItem[],
    };

    logger.info(
      { rating, reviewsCount, specializations: payload.specializations.length, portfolio: payload.portfolio.length },
      '[profile/fl] снимок собран',
    );
    return payload;
  });
}

function normalizeBase(url: string): string {
  const m = url.match(/\/users\/([^/?#]+)/);
  if (!m) {
    return url.replace(/\/(rating|portfolio|reviews)\/?$/i, '').replace(/\/$/, '');
  }
  return `https://www.fl.ru/users/${m[1]}`;
}
