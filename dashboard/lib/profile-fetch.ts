// Минимальный GitHub-fetcher для dashboard worker'а (кнопка «Обновить» на /profile).
// Дублирует src/core/github-profile.ts (агент пользует свою копию) — это меньший diff,
// чем shared package, и матчит практику dashboard/lib/notifications/* (не шарит код с агентом).

const GH_API = 'https://api.github.com';
const TOP_LANGS_REPOS = 15;
const TOP_README_REPOS = 5;
const README_EXCERPT_LIMIT = 500;

export interface RepoSnapshot {
  name: string;
  description: string | null;
  language: string | null;
  stars: number;
  url: string;
  pushedAt: string;
  readmeExcerpt?: string;
}

export interface GithubSnapshotInput {
  githubLogin: string;
  languagesAgg: Record<string, number>;
  repos: RepoSnapshot[];
}

interface GhRepo {
  name: string;
  full_name: string;
  description: string | null;
  language: string | null;
  stargazers_count: number;
  html_url: string;
  pushed_at: string;
  fork: boolean;
  archived: boolean;
  private: boolean;
}

function makeHeaders(token: string | undefined, accept = 'application/vnd.github+json'): HeadersInit {
  const h: Record<string, string> = {
    Accept: accept,
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'scan-agent-dashboard',
  };
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

async function ghJson<T>(url: string, token?: string): Promise<T> {
  const res = await fetch(url, { headers: makeHeaders(token) });
  if (!res.ok) throw new Error(`GH ${res.status}: ${await res.text().catch(() => '')}`);
  return res.json() as Promise<T>;
}

async function ghRaw(url: string, token?: string): Promise<string> {
  const res = await fetch(url, { headers: makeHeaders(token, 'application/vnd.github.raw') });
  if (!res.ok) throw new Error(`GH ${res.status}`);
  return res.text();
}

export async function fetchGithubProfile(login: string, token?: string): Promise<GithubSnapshotInput> {
  if (!login) throw new Error('fetchGithubProfile: пустой login');

  const allRepos = await ghJson<GhRepo[]>(
    `${GH_API}/users/${encodeURIComponent(login)}/repos?per_page=100&sort=pushed&type=owner`,
    token,
  );
  const repos = allRepos.filter((r) => !r.fork && !r.archived && !r.private);
  const reposForLang = repos.slice(0, TOP_LANGS_REPOS);

  const languagesAgg: Record<string, number> = {};
  for (const repo of reposForLang) {
    try {
      const langs = await ghJson<Record<string, number>>(
        `${GH_API}/repos/${repo.full_name}/languages`,
        token,
      );
      for (const [lang, bytes] of Object.entries(langs)) {
        languagesAgg[lang] = (languagesAgg[lang] ?? 0) + bytes;
      }
    } catch {
      // skip — частично-собранный снимок лучше отсутствия
    }
  }

  const reposForReadme = repos.slice(0, TOP_README_REPOS);
  const readmeMap = new Map<string, string | undefined>();
  for (const repo of reposForReadme) {
    try {
      const raw = await ghRaw(`${GH_API}/repos/${repo.full_name}/readme`, token);
      readmeMap.set(repo.full_name, raw.slice(0, README_EXCERPT_LIMIT).trim());
    } catch {
      readmeMap.set(repo.full_name, undefined);
    }
  }

  return {
    githubLogin: login,
    languagesAgg,
    repos: reposForLang.map((r) => ({
      name: r.name,
      description: r.description,
      language: r.language,
      stars: r.stargazers_count,
      url: r.html_url,
      pushedAt: r.pushed_at,
      readmeExcerpt: readmeMap.get(r.full_name),
    })),
  };
}
