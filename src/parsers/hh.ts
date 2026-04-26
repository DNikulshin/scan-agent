import { config } from '../config';
import { createBrowser } from './browser';
import type { Order, Parser } from '../types';

interface RawHhVacancy {
  id: string;
  title: string;
  desc: string;
  price: string;
  link: string;
  employer: string;
  city: string;
}

export class HhParser implements Parser {
  name = 'hh';

  async fetchOrders(): Promise<Order[]> {
    if (!config.hh.enabled) {
      console.log('⏭️  [hh] Парсер отключён — установи HH_ENABLED=true');
      return [];
    }

    const { context, close } = await createBrowser();
    const page = await context.newPage();
    const allVacancies: RawHhVacancy[] = [];

    try {
      for (let pageNum = 0; pageNum < config.hh.maxPages; pageNum++) {
        const url = buildPageUrl(config.hh.url, pageNum);
        console.log(`🌐 [hh] Страница ${pageNum + 1}/${config.hh.maxPages} → ${url}`);

        await page.goto(url, { waitUntil: 'networkidle', timeout: 60_000 });

        const hasVacancies = await page
          .waitForSelector('[data-qa="vacancy-serp__vacancy"]', { timeout: 15_000 })
          .then(() => true)
          .catch(() => false);

        if (!hasVacancies) {
          console.log(`[hh] Нет вакансий на странице ${pageNum + 1} — завершаем`);
          break;
        }

        const vacancies = await page.$$eval(
          '[data-qa="vacancy-serp__vacancy"]',
          (cards): (RawHhVacancy | null)[] =>
            cards.map(card => {
              const linkEl = card.querySelector(
                '[data-qa="serp-item__title"]',
              ) as HTMLAnchorElement | null;
              const link = linkEl?.href?.split('?')[0] ?? null;
              if (!link) return null;

              const idMatch = link.match(/vacancy\/(\d+)/);
              const id = idMatch?.[1] ?? null;
              if (!id) return null;

              const title =
                card
                  .querySelector('[data-qa="serp-item__title-text"]')
                  ?.textContent?.trim() ?? null;
              if (!title) return null;

              let price = 'не указана';
              for (const span of card.querySelectorAll('span')) {
                const t = span.textContent?.trim() ?? '';
                if (/([\d\s]+[₽$€]|от\s*\d|до\s*\d)/i.test(t) && t.length < 80) {
                  price = t.replace(/\s+/g, ' ');
                  break;
                }
              }

              const employer =
                card
                  .querySelector('[data-qa="vacancy-serp__vacancy-employer-text"]')
                  ?.textContent?.trim() ?? '';

              const city =
                card
                  .querySelector('[data-qa="vacancy-serp__vacancy-address"]')
                  ?.textContent?.trim() ?? '';

              const tagEls = card.querySelectorAll(
                '[data-qa^="vacancy-label"], [data-qa^="vacancy-serp__vacancy-work-experience"]',
              );
              const tags = [...tagEls]
                .map(el => el.textContent?.trim())
                .filter(Boolean)
                .join(' ');

              const desc = tags;

              return { id, title, desc, price, link, employer, city };
            }),
        );

        const valid = vacancies.filter((v): v is RawHhVacancy => v !== null);
        allVacancies.push(...valid);

        console.log(`  ✅ Страница ${pageNum + 1}: ${valid.length} вакансий`);

        if (pageNum < config.hh.maxPages - 1) {
          await new Promise(r => setTimeout(r, 2_500));
        }
      }

      console.log(`🏁 [hh] Итого: ${allVacancies.length} вакансий`);

      return allVacancies.map(v => ({
        id: v.id,
        title: v.title,
        desc: v.desc,
        price: v.price,
        link: v.link,
        offersCount: 0,
        source: 'hh' as const,
        meta: {
          employer: v.employer,
          city: v.city,
        },
      }));
    } finally {
      await close();
    }
  }
}

function buildPageUrl(baseUrl: string, page: number): string {
  const url = new URL(baseUrl);
  if (page > 0) {
    url.searchParams.set('page', String(page));
  } else {
    url.searchParams.delete('page');
  }
  return url.toString();
}
