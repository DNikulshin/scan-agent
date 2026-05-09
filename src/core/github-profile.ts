import axios from 'axios';
import { logger } from '../utils/logger';
import { withRetry, isRetryableHttpError } from '../utils/retry';

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

function makeHeaders(token?: string): Record<string, string> {
  const h: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'scan-agent',
  };
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

async function ghGet<T>(url: string, token?: string, accept?: string): Promise<T> {
  const headers = makeHeaders(token);
  if (accept) headers.Accept = accept;

  const res = await withRetry(
    () =>
      axios.get<T>(url, {
        headers,
        proxy: false,
        timeout: 15_000,
        // raw README endpoint возвращает text/plain — пусть axios не падает
        responseType: accept?.includes('raw') ? 'text' : 'json',
        transformResponse: accept?.includes('raw') ? (d) => d : undefined,
      }),
    { maxAttempts: 2, label: `gh:${url}`, shouldRetry: isRetryableHttpError },
  );

  return res.data;
}

async function fetchRepos(login: string, token?: string): Promise<GhRepo[]> {
  const url = `${GH_API}/users/${encodeURIComponent(login)}/repos?per_page=100&sort=pushed&type=owner`;
  const data = await ghGet<GhRepo[]>(url, token);
  return data.filter((r) => !r.fork && !r.archived && !r.private);
}

async function fetchLanguages(
  fullName: string,
  token?: string,
): Promise<Record<string, number>> {
  try {
    return await ghGet<Record<string, number>>(`${GH_API}/repos/${fullName}/languages`, token);
  } catch (err) {
    logger.warn({ err, repo: fullName }, '[gh] languages недоступны');
    return {};
  }
}

async function fetchReadmeExcerpt(
  fullName: string,
  token?: string,
): Promise<string | undefined> {
  try {
    const raw = await ghGet<string>(
      `${GH_API}/repos/${fullName}/readme`,
      token,
      'application/vnd.github.raw',
    );
    if (typeof raw !== 'string' || raw.length === 0) return undefined;
    return raw.slice(0, README_EXCERPT_LIMIT).trim();
  } catch (err) {
    logger.debug({ err, repo: fullName }, '[gh] README отсутствует или приватный');
    return undefined;
  }
}

/**
 * Собирает снимок профиля из публичных репозиториев GitHub.
 * Используется в src/core/profile-context.ts для refresh каждые N часов.
 *
 * Бросает только если /users/.../repos упал — это означает невалидный login
 * или жёсткий 401/403. Ошибки на repos languages/readme не валят весь fetch.
 */
export async function fetchGithubProfile(
  login: string,
  token?: string,
): Promise<GithubSnapshotInput> {
  if (!login) throw new Error('fetchGithubProfile: пустой login');

  logger.info({ login, hasToken: Boolean(token) }, '[gh] fetching profile');

  const allRepos = await fetchRepos(login, token);
  const reposForLang = allRepos.slice(0, TOP_LANGS_REPOS);

  const languagesAgg: Record<string, number> = {};
  for (const repo of reposForLang) {
    const langs = await fetchLanguages(repo.full_name, token);
    for (const [lang, bytes] of Object.entries(langs)) {
      languagesAgg[lang] = (languagesAgg[lang] ?? 0) + bytes;
    }
  }

  const reposForReadme = allRepos.slice(0, TOP_README_REPOS);
  const readmeMap = new Map<string, string | undefined>();
  for (const repo of reposForReadme) {
    readmeMap.set(repo.full_name, await fetchReadmeExcerpt(repo.full_name, token));
  }

  const repos: RepoSnapshot[] = reposForLang.map((r) => ({
    name: r.name,
    description: r.description,
    language: r.language,
    stars: r.stargazers_count,
    url: r.html_url,
    pushedAt: r.pushed_at,
    readmeExcerpt: readmeMap.get(r.full_name),
  }));

  logger.info(
    { login, repos: repos.length, languages: Object.keys(languagesAgg).length },
    '[gh] profile snapshot ready',
  );

  return { githubLogin: login, languagesAgg, repos };
}
