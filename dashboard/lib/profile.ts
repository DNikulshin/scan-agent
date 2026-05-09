// Профиль (Блок 2): чтение последнего ProfileSnapshot + рендер MD.
// Источник правды для /profile, /api/profile/export, /api/profile/refresh.

import { prisma } from './db';
import type { RepoSnapshot, GithubSnapshotInput } from './profile-fetch';
import { fetchGithubProfile } from './profile-fetch';

export interface ProfileSnapshotShape {
  id: string;
  githubLogin: string;
  fetchedAt: string;
  languagesAgg: Record<string, number>;
  repos: RepoSnapshot[];
}

export async function getLatestSnapshot(): Promise<ProfileSnapshotShape | null> {
  const row = await prisma.profileSnapshot.findFirst({
    orderBy: { fetchedAt: 'desc' },
  });
  if (!row) return null;
  return {
    id: row.id,
    githubLogin: row.githubLogin,
    fetchedAt: row.fetchedAt.toISOString(),
    languagesAgg: (row.languagesAgg as unknown as Record<string, number>) ?? {},
    repos: (row.repos as unknown as RepoSnapshot[]) ?? [],
  };
}

export async function refreshSnapshot(login: string, token?: string): Promise<ProfileSnapshotShape> {
  const input: GithubSnapshotInput = await fetchGithubProfile(login, token);
  const row = await prisma.profileSnapshot.create({
    data: {
      githubLogin: input.githubLogin,
      languagesAgg: input.languagesAgg,
      repos: input.repos as unknown as object[],
    },
  });
  return {
    id: row.id,
    githubLogin: row.githubLogin,
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

export function formatProfileMd(snap: ProfileSnapshotShape): string {
  const lines: string[] = [];
  const dateStr = new Date(snap.fetchedAt).toISOString().slice(0, 19).replace('T', ' ');

  lines.push(`# Profile snapshot — github.com/${snap.githubLogin}`);
  lines.push('');
  lines.push(`Снимок собран: ${dateStr} UTC`);
  lines.push('');

  // Языки
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

  // Топ-репозитории
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

  return lines.join('\n');
}
