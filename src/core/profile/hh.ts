import { logger } from '../../utils/logger';
import { withStealthPage } from './browser';
import type { HhResumePayload, HhExperienceItem } from './types';

/**
 * Парсит публичный share-link резюме HH.ru.
 * URL формата `https://hh.ru/resume/<hash>`. Приватный URL аккаунта парсить нельзя — 403.
 *
 * Селекторы — максимально терпимые с фоллбэками. Если вёрстка изменится,
 * парсер вернёт частичные данные + debug-screenshot осядет рядом.
 */
export async function fetchHhResume(url: string): Promise<HhResumePayload> {
  if (!/^https?:\/\/[^/]*hh\.ru\/resume\/[a-f0-9]+/i.test(url)) {
    throw new Error(`fetchHhResume: ожидается публичный share-link hh.ru/resume/<hash>, получено: ${url}`);
  }

  return withStealthPage('hh', async (page) => {
    logger.info({ url }, '[profile/hh] открываю резюме');

    const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    if (!resp || !resp.ok()) {
      throw new Error(`HH share-link недоступен: status=${resp?.status() ?? 'no-response'}`);
    }
    await page.waitForTimeout(1_500);

    const payload = await page.evaluate((sourceUrl: string) => {
      const text = (sel: string): string => {
        const el = document.querySelector<HTMLElement>(sel);
        return el?.textContent?.trim() ?? '';
      };
      const tryText = (selectors: string[]): string => {
        for (const s of selectors) {
          const v = text(s);
          if (v) return v;
        }
        return '';
      };

      const title = tryText([
        '[data-qa="resume-block-title-position"]',
        'h1.resume-block-title',
        'h1[data-qa="resume-personal-name"]',
        'h1',
      ]);
      const area = tryText([
        '[data-qa="resume-personal-address"]',
        '[data-qa="resume-personal-area"]',
        '[data-qa="resume-personal-metro"]',
      ]);
      const salary = tryText([
        '[data-qa="resume-block-salary"]',
        '[data-qa="resume-salary"]',
      ]);

      // ── Опыт работы ──
      const expContainer = document.querySelector<HTMLElement>(
        '[data-qa="resume-block-experience"]',
      ) ?? document.querySelector<HTMLElement>('.resume-block-experience');
      const experience: { period: string; company: string; position: string; summary: string }[] = [];
      if (expContainer) {
        const items = expContainer.querySelectorAll<HTMLElement>(
          '.resume-block-item-gap, [data-qa="resume-block-experience-item"]',
        );
        items.forEach((it) => {
          const period =
            it.querySelector<HTMLElement>('.bloko-column_xs-4')?.textContent?.trim() ??
            it.querySelector<HTMLElement>('[data-qa="resume-block-experience-period"]')?.textContent?.trim() ??
            '';
          const company =
            it.querySelector<HTMLElement>('[data-qa="resume-block-experience-company"]')?.textContent?.trim() ??
            it.querySelector<HTMLElement>('.bloko-text_strong')?.textContent?.trim() ??
            '';
          const position =
            it.querySelector<HTMLElement>('[data-qa="resume-block-experience-position"]')?.textContent?.trim() ??
            it.querySelector<HTMLElement>('.resume-block__sub-title')?.textContent?.trim() ??
            '';
          const summary =
            it.querySelector<HTMLElement>('[data-qa="resume-block-experience-description"]')?.textContent?.trim() ??
            it.querySelector<HTMLElement>('.resume-block__experience-description')?.textContent?.trim() ??
            '';
          if (company || position) {
            experience.push({
              period: period.replace(/\s+/g, ' '),
              company: company.replace(/\s+/g, ' '),
              position: position.replace(/\s+/g, ' '),
              summary: summary.replace(/\s+/g, ' ').slice(0, 400),
            });
          }
        });
      }

      // ── Ключевые навыки ──
      const skills: string[] = [];
      const skillsContainer =
        document.querySelector<HTMLElement>('[data-qa="skills-table"]') ??
        document.querySelector<HTMLElement>('[data-qa="bloko-tag-list"]') ??
        document.querySelector<HTMLElement>('.resume-block-skills');
      if (skillsContainer) {
        skillsContainer.querySelectorAll<HTMLElement>('.bloko-tag, [data-qa="bloko-tag__text"]').forEach((tag) => {
          const t = tag.textContent?.trim();
          if (t && !skills.includes(t)) skills.push(t);
        });
      }

      return {
        url: sourceUrl,
        title,
        area,
        salary,
        experience,
        skills,
      };
    }, url);

    logger.info(
      { experience: payload.experience.length, skills: payload.skills.length },
      '[profile/hh] снимок собран',
    );
    return payload as HhResumePayload;
  });
}

export function summarizeHhExperience(experience: HhExperienceItem[], maxChars = 800): string {
  // Переводим таймлайн в компактный текстовый блок для AI-промпта.
  // Останавливаемся когда упёрлись в лимит, чтобы не раздуть context window.
  const lines: string[] = [];
  let used = 0;
  for (const item of experience) {
    const head = `- ${item.period}: ${item.company} — ${item.position}`;
    const body = item.summary ? `\n  ${item.summary}` : '';
    const candidate = head + body;
    if (used + candidate.length > maxChars) break;
    lines.push(candidate);
    used += candidate.length + 1;
  }
  return lines.join('\n');
}
