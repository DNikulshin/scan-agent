import { ProfileSource } from '@prisma/client';
import { prisma } from './prisma';
import { profile } from '../profile';
import { fetchGithubProfile, type GithubSnapshotInput, type RepoSnapshot } from './github-profile';
import { summarizeHhExperience, summarizeRawText } from './profile/hh';
import type { HhResumePayload } from './profile/types';
import { logger } from '../utils/logger';

const TOP_LANGS_FOR_STACK = 8;
const TOP_REPOS_FOR_PORTFOLIO = 5;

interface SnapshotShape {
  githubLogin: string;
  fetchedAt: Date;
  languagesAgg: Record<string, number>;
  repos: RepoSnapshot[];
}

let cachedContext: string | null = null;
let cachedSnapshot: SnapshotShape | null = null;
let cachedExperience: string | null = null;

function snapshotFromDb(row: {
  githubLogin: string;
  fetchedAt: Date;
  languagesAgg: unknown;
  repos: unknown;
}): SnapshotShape {
  return {
    githubLogin: row.githubLogin,
    fetchedAt: row.fetchedAt,
    languagesAgg: (row.languagesAgg as Record<string, number>) ?? {},
    repos: (row.repos as RepoSnapshot[]) ?? [],
  };
}

async function loadLatestSnapshot(): Promise<SnapshotShape | null> {
  const row = await prisma.profileSnapshot.findFirst({
    where: { source: ProfileSource.github },
    orderBy: { fetchedAt: 'desc' },
  });
  if (!row || !row.githubLogin) return null;
  return snapshotFromDb({
    githubLogin: row.githubLogin,
    fetchedAt: row.fetchedAt,
    languagesAgg: row.languagesAgg,
    repos: row.repos,
  });
}

async function loadHhExperience(): Promise<string | null> {
  const row = await prisma.profileSnapshot.findFirst({
    where: { source: ProfileSource.hh },
    orderBy: { fetchedAt: 'desc' },
    select: { payload: true },
  });
  if (!row) return null;
  const payload = row.payload as unknown as HhResumePayload | null;
  if (!payload) return null;
  // Приоритет: rawText (ручная заливка через /profile) → legacy structured experience[].
  if (payload.rawText && payload.rawText.trim().length > 0) {
    const text = summarizeRawText(payload.rawText);
    return text || null;
  }
  if (payload.experience && payload.experience.length > 0) {
    const text = summarizeHhExperience(payload.experience);
    return text || null;
  }
  return null;
}

async function saveSnapshot(input: GithubSnapshotInput): Promise<SnapshotShape> {
  const row = await prisma.profileSnapshot.create({
    data: {
      source: ProfileSource.github,
      githubLogin: input.githubLogin,
      languagesAgg: input.languagesAgg,
      repos: input.repos as object[],
    },
  });
  return snapshotFromDb({
    githubLogin: row.githubLogin ?? input.githubLogin,
    fetchedAt: row.fetchedAt,
    languagesAgg: row.languagesAgg,
    repos: row.repos,
  });
}

/** Топ-N языков по bytes — derived stack. */
function topLanguages(agg: Record<string, number>, n: number): string[] {
  return Object.entries(agg)
    .sort(([, a], [, b]) => b - a)
    .slice(0, n)
    .map(([lang]) => lang);
}

/** Сборка stack: топ-языки из GH + hand-pick из profile.stack (фреймворки/инструменты). */
function mergeStack(snapshot: SnapshotShape | null): string[] {
  if (!snapshot) return [...profile.stack];

  const fromGh = topLanguages(snapshot.languagesAgg, TOP_LANGS_FOR_STACK);
  const seen = new Set(fromGh.map((s) => s.toLowerCase()));
  const handPicked = profile.stack.filter((s) => !seen.has(s.toLowerCase()));
  return [...fromGh, ...handPicked];
}

/** Портфолио: либо из снимка (топ репов с описанием), либо static fallback. */
function buildPortfolioLines(snapshot: SnapshotShape | null): string[] {
  if (!snapshot || snapshot.repos.length === 0) {
    return profile.portfolio.map((p) => `  • ${p.title} → ${p.result}`);
  }

  return snapshot.repos.slice(0, TOP_REPOS_FOR_PORTFOLIO).map((r) => {
    const desc = r.description?.trim() || r.readmeExcerpt?.split('\n')[0]?.trim() || 'без описания';
    const lang = r.language ? ` [${r.language}]` : '';
    return `  • ${r.name}${lang} — ${desc}`;
  });
}

function buildContext(snapshot: SnapshotShape | null): string {
  const stack = mergeStack(snapshot);
  const portfolio = buildPortfolioLines(snapshot);
  const strengths = profile.strengths.map((s) => `  • ${s}`).join('\n');

  const sourceNote = snapshot
    ? `\n(Профиль сгенерирован из github.com/${snapshot.githubLogin}, обновлён ${snapshot.fetchedAt.toISOString()})`
    : '\n(Профиль static — GitHub-снимка ещё нет)';

  return [
    `Имя: ${profile.name}`,
    `Специализация: ${profile.headline}`,
    `Стек: ${stack.join(', ')}`,
    `\nПортфолио:`,
    portfolio.join('\n'),
    `\nСильные стороны:`,
    strengths,
    `\nСроки: ${profile.typicalTimeline}`,
    `Стиль: ${profile.communicationStyle}`,
    sourceNote,
  ].join('\n');
}

/** Прогревает кэш — читает последний снимок (или fallback на static) и собирает контекст. */
export async function loadProfileContext(): Promise<string> {
  cachedSnapshot = await loadLatestSnapshot();
  cachedContext = buildContext(cachedSnapshot);
  try {
    cachedExperience = await loadHhExperience();
  } catch (err) {
    logger.warn({ err }, '[profile] не удалось прогреть HH-experience, продолжаем без него');
    cachedExperience = null;
  }
  return cachedContext;
}

/** Sync-версия для analyzer. Бросает если loadProfileContext не вызывали. */
export function getCachedProfileContext(): string {
  if (cachedContext === null) {
    throw new Error('getCachedProfileContext: вызвать loadProfileContext() в начале процесса');
  }
  return cachedContext;
}

/** Sync stack для scoreOrder (отдельный slot чтобы не парсить контекст). */
export function getCachedStack(): string[] {
  return mergeStack(cachedSnapshot);
}

/** HH-таймлайн опыта в текстовом формате — `null`, если HH-снимка ещё нет. */
export function getCachedExperienceContext(): string | null {
  return cachedExperience;
}

interface RefreshOpts {
  maxAgeHours: number;
  login: string;
  token?: string;
}

/**
 * Обновляет ProfileSnapshot если он старше maxAgeHours (или его нет).
 * Best-effort: ошибки логируются, но не пробрасываются — fallback на старый/static.
 */
export async function refreshProfileIfStale(opts: RefreshOpts): Promise<void> {
  if (!opts.login) {
    logger.debug('[profile] login пуст — refresh пропущен');
    return;
  }

  try {
    const latest = await loadLatestSnapshot();
    const ageMs = latest ? Date.now() - latest.fetchedAt.getTime() : Infinity;
    const maxAgeMs = opts.maxAgeHours * 3600_000;

    if (latest && ageMs < maxAgeMs) {
      logger.debug(
        { ageHours: Math.round(ageMs / 3600_000) },
        '[profile] снимок свежий, refresh не нужен',
      );
      return;
    }

    const input = await fetchGithubProfile(opts.login, opts.token);
    const saved = await saveSnapshot(input);
    cachedSnapshot = saved;
    cachedContext = buildContext(saved);
    logger.info(
      { repos: input.repos.length, langs: Object.keys(input.languagesAgg).length },
      '[profile] snapshot обновлён',
    );
  } catch (err) {
    logger.error({ err }, '[profile] refresh упал — продолжаем со старым/static контекстом');
  }
}
