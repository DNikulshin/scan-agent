// Профиль (Блок 2): чтение последних ProfileSnapshot per source + рендер MD.
// Источник правды для /profile, /api/profile/export, /api/profile/refresh.

import { ProfileSource } from '@prisma/client';
import { prisma } from './db';
import type { RepoSnapshot, GithubSnapshotInput } from './profile-fetch';
import { fetchGithubProfile } from './profile-fetch';
import type {
  HhResumePayload,
  FlProfilePayload,
  KworkProfilePayload,
  FreelanceruProfilePayload,
} from './profile-types';

export interface ProfileSnapshotShape {
  id: string;
  githubLogin: string;
  fetchedAt: string;
  languagesAgg: Record<string, number>;
  repos: RepoSnapshot[];
}

export async function getLatestSnapshot(): Promise<ProfileSnapshotShape | null> {
  const row = await prisma.profileSnapshot.findFirst({
    where: { source: ProfileSource.github },
    orderBy: { fetchedAt: 'desc' },
  });
  if (!row || !row.githubLogin) return null;
  return {
    id: row.id,
    githubLogin: row.githubLogin,
    fetchedAt: row.fetchedAt.toISOString(),
    languagesAgg: (row.languagesAgg as unknown as Record<string, number>) ?? {},
    repos: (row.repos as unknown as RepoSnapshot[]) ?? [],
  };
}

export interface SourceSnapshot<T> {
  fetchedAt: string;
  payload: T;
}

export interface AllSnapshots {
  github: ProfileSnapshotShape | null;
  hh: SourceSnapshot<HhResumePayload> | null;
  fl: SourceSnapshot<FlProfilePayload> | null;
  kwork: SourceSnapshot<KworkProfilePayload> | null;
  freelanceru: SourceSnapshot<FreelanceruProfilePayload> | null;
}

async function loadOne<T>(source: ProfileSource): Promise<SourceSnapshot<T> | null> {
  const row = await prisma.profileSnapshot.findFirst({
    where: { source },
    orderBy: { fetchedAt: 'desc' },
    select: { fetchedAt: true, payload: true },
  });
  if (!row) return null;
  return {
    fetchedAt: row.fetchedAt.toISOString(),
    payload: row.payload as unknown as T,
  };
}

export async function getAllSnapshots(): Promise<AllSnapshots> {
  const [github, hh, fl, kwork, freelanceru] = await Promise.all([
    getLatestSnapshot(),
    loadOne<HhResumePayload>(ProfileSource.hh),
    loadOne<FlProfilePayload>(ProfileSource.fl),
    loadOne<KworkProfilePayload>(ProfileSource.kwork),
    loadOne<FreelanceruProfilePayload>(ProfileSource.freelanceru),
  ]);
  return { github, hh, fl, kwork, freelanceru };
}

export async function refreshSnapshot(login: string, token?: string): Promise<ProfileSnapshotShape> {
  const input: GithubSnapshotInput = await fetchGithubProfile(login, token);
  const row = await prisma.profileSnapshot.create({
    data: {
      source: ProfileSource.github,
      githubLogin: input.githubLogin,
      languagesAgg: input.languagesAgg,
      repos: input.repos as unknown as object[],
    },
  });
  return {
    id: row.id,
    githubLogin: row.githubLogin ?? input.githubLogin,
    fetchedAt: row.fetchedAt.toISOString(),
    languagesAgg: input.languagesAgg,
    repos: input.repos,
  };
}

/** Топ-N языков по bytes — для рендера и для derived stack. */
export function languagesByPct(agg: Record<string, number>): Array<{ lang: string; bytes: number; pct: number }> {
  const total = Object.values(agg).reduce((a, b) => a + b, 0);
  if (total === 0) return [];
  return Object.entries(agg)
    .sort(([, a], [, b]) => b - a)
    .map(([lang, bytes]) => ({ lang, bytes, pct: bytes / total }));
}

function fmtDate(iso: string): string {
  return new Date(iso).toISOString().slice(0, 19).replace('T', ' ');
}

function renderGithubSection(snap: ProfileSnapshotShape): string[] {
  const lines: string[] = [];
  lines.push(`# Profile snapshot — github.com/${snap.githubLogin}`);
  lines.push('');
  lines.push(`Снимок собран: ${fmtDate(snap.fetchedAt)} UTC`);
  lines.push('');
  lines.push('## Стек по языкам (bytes)');
  lines.push('');
  const langs = languagesByPct(snap.languagesAgg);
  if (langs.length === 0) {
    lines.push('_нет данных_');
  } else {
    lines.push('| Язык | Bytes | % |');
    lines.push('|---|---:|---:|');
    for (const { lang, bytes, pct } of langs) {
      lines.push(`| ${lang} | ${bytes.toLocaleString('en-US')} | ${(pct * 100).toFixed(1)}% |`);
    }
  }
  lines.push('');
  lines.push(`## Репозитории (${snap.repos.length})`);
  lines.push('');
  for (const r of snap.repos) {
    const stars = r.stars > 0 ? ` ⭐${r.stars}` : '';
    const lang = r.language ? ` _[${r.language}]_` : '';
    lines.push(`### [${r.name}](${r.url})${lang}${stars}`);
    if (r.description) lines.push(`> ${r.description}`);
    if (r.readmeExcerpt) {
      lines.push('');
      lines.push('```');
      lines.push(r.readmeExcerpt);
      lines.push('```');
    }
    lines.push('');
    lines.push(`_pushed: ${r.pushedAt.slice(0, 10)}_`);
    lines.push('');
  }
  return lines;
}

function renderHhSection(snap: SourceSnapshot<HhResumePayload>): string[] {
  const p = snap.payload;
  const lines: string[] = [];
  lines.push(`## HH.ru — резюме`);
  lines.push('');
  const sourceLabel = p.url === 'manual' ? 'ручная заливка' : `[открыть резюме](${p.url})`;
  lines.push(`Снимок: ${fmtDate(snap.fetchedAt)} UTC · ${sourceLabel}`);
  lines.push('');

  if (p.rawText) {
    lines.push('```');
    lines.push(p.rawText);
    lines.push('```');
    lines.push('');
    return lines;
  }

  if (p.title) lines.push(`**Должность:** ${p.title}`);
  if (p.area) lines.push(`**Локация:** ${p.area}`);
  if (p.salary) lines.push(`**Желаемая зарплата:** ${p.salary}`);
  lines.push('');
  const experience = p.experience ?? [];
  if (experience.length > 0) {
    lines.push('### Опыт работы');
    lines.push('');
    for (const e of experience) {
      lines.push(`- **${e.period}** — ${e.company} · ${e.position}`);
      if (e.summary) lines.push(`  > ${e.summary}`);
    }
    lines.push('');
  }
  const skills = p.skills ?? [];
  if (skills.length > 0) {
    lines.push('### Ключевые навыки');
    lines.push('');
    lines.push(skills.join(', '));
    lines.push('');
  }
  return lines;
}

function renderFlSection(snap: SourceSnapshot<FlProfilePayload>): string[] {
  const p = snap.payload;
  const lines: string[] = [];
  lines.push('## FL.ru — портфолио');
  lines.push('');
  lines.push(`Снимок: ${fmtDate(snap.fetchedAt)} UTC · [открыть профиль](${p.url})`);
  lines.push('');
  if (p.rating > 0) lines.push(`**Рейтинг:** ${p.rating} · **Отзывов:** ${p.reviewsCount}`);
  if (p.specializations.length > 0) {
    lines.push(`**Специализации:** ${p.specializations.join(', ')}`);
  }
  lines.push('');
  if (p.portfolio.length > 0) {
    lines.push('### Работы');
    lines.push('');
    for (const w of p.portfolio) {
      lines.push(`- [${w.title}](${w.link})${w.description ? ` — ${w.description}` : ''}`);
    }
    lines.push('');
  }
  return lines;
}

function renderKworkSection(snap: SourceSnapshot<KworkProfilePayload>): string[] {
  const p = snap.payload;
  const skills = p.skills ?? [];
  const badges = p.badges ?? [];
  const lines: string[] = [];
  const heading = p.displayName ? `## Kwork — ${p.displayName}` : '## Kwork';
  lines.push(heading);
  lines.push('');
  lines.push(`Снимок: ${fmtDate(snap.fetchedAt)} UTC · [открыть профиль](${p.url})`);
  lines.push('');
  if (p.profession) lines.push(`**Профессия:** ${p.profession}`);
  if (p.rating > 0 || p.reviewsCount > 0) {
    lines.push(`**Рейтинг:** ${p.rating} · **Отзывов:** ${p.reviewsCount}`);
  }
  if (p.lastOnline) lines.push(`_${p.lastOnline}_`);
  if (badges.length > 0) lines.push(`**Бейджи:** ${badges.join(', ')}`);
  lines.push('');
  if (p.description) {
    const excerpt = p.description.length > 300 ? `${p.description.slice(0, 300)}…` : p.description;
    lines.push('### О себе');
    lines.push('');
    lines.push(excerpt);
    lines.push('');
  }
  if (skills.length > 0) {
    lines.push('### Навыки');
    lines.push('');
    lines.push(skills.join(', '));
    lines.push('');
  }
  return lines;
}

function renderFreelanceruSection(snap: SourceSnapshot<FreelanceruProfilePayload>): string[] {
  const p = snap.payload;
  const lines: string[] = [];
  lines.push('## Freelance.ru');
  lines.push('');
  lines.push(`Снимок: ${fmtDate(snap.fetchedAt)} UTC · [открыть профиль](${p.url})`);
  lines.push('');
  if (p.rating > 0) lines.push(`**Рейтинг:** ${p.rating}`);
  lines.push('');
  if (p.services.length > 0) {
    lines.push('### Услуги');
    lines.push('');
    for (const s of p.services) {
      lines.push(`- **${s.title}**${s.description ? ` — ${s.description}` : ''}`);
    }
    lines.push('');
  }
  return lines;
}

export function formatProfileMd(snap: ProfileSnapshotShape | null, all?: AllSnapshots): string {
  const sections: string[][] = [];
  if (snap) sections.push(renderGithubSection(snap));
  if (all?.hh) sections.push(renderHhSection(all.hh));
  if (all?.fl) sections.push(renderFlSection(all.fl));
  if (all?.kwork) sections.push(renderKworkSection(all.kwork));
  if (all?.freelanceru) sections.push(renderFreelanceruSection(all.freelanceru));
  if (sections.length === 0) return '# Profile snapshot\n\n_нет данных_\n';
  return sections.map((s) => s.join('\n')).join('\n---\n\n');
}
