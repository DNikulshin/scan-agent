import { logger } from '../../utils/logger';
import { withStealthPage } from './browser';
import type { KworkProfilePayload } from './types';

const DESCRIPTION_LIMIT = 1000;
const SKILLS_LIMIT = 30;
const BADGES_LIMIT = 10;

interface KworkStateData {
  userRating?: string | number | null;
  totalReviewsCount?: number | null;
  userProfileName?: string | null;
  userProfileProfession?: string | null;
  userProfileDescription?: string | null;
  userSkills?: Array<{ id?: number; name?: string }> | null;
  userProfileBadges?: Array<unknown> | null;
  lastOnlineAsString?: string | null;
}

interface KworkRawSnapshot {
  url: string;
  stateData: KworkStateData | null;
  fallback: {
    displayName: string;
    profession: string;
    skills: string[];
  };
}

export async function fetchKworkProfile(url: string): Promise<KworkProfilePayload> {
  return withStealthPage('kwork', async (page) => {
    logger.info({ url }, '[profile/kwork] открываю профиль');

    const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    if (!resp || !resp.ok()) {
      throw new Error(`Kwork profile недоступен: status=${resp?.status() ?? 'no-response'}`);
    }
    await page.waitForTimeout(1_000);

    const raw = await page.evaluate((sourceUrl: string): KworkRawSnapshot => {
      const w = window as unknown as { stateData?: KworkStateData };
      const stateData = w.stateData ?? null;

      const text = (sel: string): string =>
        document.querySelector<HTMLElement>(sel)?.textContent?.trim() ?? '';
      const skillsFromDom: string[] = [];
      document
        .querySelectorAll<HTMLElement>('.user-skills__item')
        .forEach((el) => {
          const t = el.textContent?.trim();
          if (t) skillsFromDom.push(t);
        });

      return {
        url: sourceUrl,
        stateData,
        fallback: {
          displayName: text('h1.user-username'),
          profession: text('.user-profession'),
          skills: skillsFromDom,
        },
      };
    }, url);

    return mapSnapshot(raw);
  });
}

function mapSnapshot(raw: KworkRawSnapshot): KworkProfilePayload {
  const sd = raw.stateData;

  if (!sd) {
    logger.warn({ url: raw.url }, '[profile/kwork] window.stateData отсутствует, fallback на DOM');
    return {
      url: raw.url,
      rating: 0,
      reviewsCount: 0,
      displayName: emptyToUndef(raw.fallback.displayName),
      profession: emptyToUndef(raw.fallback.profession),
      skills: raw.fallback.skills.slice(0, SKILLS_LIMIT),
      badges: [],
    };
  }

  const rating = parseRating(sd.userRating);
  const reviewsCount = typeof sd.totalReviewsCount === 'number' ? sd.totalReviewsCount : 0;
  const displayName =
    typeof sd.userProfileName === 'string' && sd.userProfileName.trim()
      ? sd.userProfileName.trim()
      : emptyToUndef(raw.fallback.displayName);
  const profession =
    typeof sd.userProfileProfession === 'string' && sd.userProfileProfession.trim()
      ? sd.userProfileProfession.trim()
      : emptyToUndef(raw.fallback.profession);
  const description = sd.userProfileDescription
    ? stripHtml(sd.userProfileDescription).slice(0, DESCRIPTION_LIMIT)
    : undefined;
  const skills = Array.isArray(sd.userSkills)
    ? sd.userSkills
        .map((s) => (typeof s?.name === 'string' ? s.name.trim() : ''))
        .filter((s): s is string => s.length > 0)
        .slice(0, SKILLS_LIMIT)
    : raw.fallback.skills.slice(0, SKILLS_LIMIT);
  const badges = Array.isArray(sd.userProfileBadges)
    ? sd.userProfileBadges
        .map(badgeToString)
        .filter((s): s is string => s.length > 0)
        .slice(0, BADGES_LIMIT)
    : [];
  const lastOnline =
    typeof sd.lastOnlineAsString === 'string' && sd.lastOnlineAsString.trim()
      ? sd.lastOnlineAsString.trim()
      : undefined;

  logger.info(
    { rating, reviewsCount, skills: skills.length, badges: badges.length },
    '[profile/kwork] снимок собран',
  );

  return {
    url: raw.url,
    rating,
    reviewsCount,
    displayName,
    profession,
    description: description && description.length > 0 ? description : undefined,
    skills,
    badges,
    lastOnline,
  };
}

function parseRating(v: unknown): number {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const parsed = parseFloat(v.replace(',', '.'));
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function stripHtml(html: string): string {
  return decodeHtmlEntities(html.replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

const HTML_ENTITY_MAP: Record<string, string> = {
  '&laquo;': '«',
  '&raquo;': '»',
  '&mdash;': '—',
  '&ndash;': '–',
  '&nbsp;': ' ',
  '&amp;': '&',
  '&quot;': '"',
  '&apos;': "'",
  '&lt;': '<',
  '&gt;': '>',
  '&hellip;': '…',
};

function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&[a-z]+;/gi, (m) => HTML_ENTITY_MAP[m.toLowerCase()] ?? m)
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)));
}

function emptyToUndef(s: string): string | undefined {
  return s.length > 0 ? s : undefined;
}

function badgeToString(b: unknown): string {
  if (typeof b === 'string') return b.trim();
  if (b && typeof b === 'object') {
    const obj = b as Record<string, unknown>;
    for (const key of ['name', 'title', 'label', 'text']) {
      const v = obj[key];
      if (typeof v === 'string' && v.trim()) return v.trim();
    }
  }
  return '';
}
