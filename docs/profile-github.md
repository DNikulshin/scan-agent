# Блок 2 — динамический профиль из GitHub (2026-05-09)

`src/profile.ts` больше не единственный источник стека. Раз в N часов агент тащит публичные репы из GitHub REST API, агрегирует языки (bytes), берёт топ-репы с README excerpt'ами и сохраняет в `ProfileSnapshot`. AI-промпты (`scoreOrder`, `generatePitch`) читают «derived stack» (топ-N языков) + hand-pick из `profile.stack` (фреймворки/инструменты, которые GH classifies как TypeScript) + рендеренный портфолио из снимка. Static fields (name, headline, strengths, communicationStyle) остаются в `profile.ts` — это «характер».

## Карта кода

- БД: модель `ProfileSnapshot` в [prisma/schema.prisma](../prisma/schema.prisma); миграция `20260509081445_add_profile_snapshot`.
- Backend: [src/core/github-profile.ts](../src/core/github-profile.ts) — `fetchGithubProfile(login, token?)` через axios + `withRetry`; собирает топ-15 репов (languages) + топ-5 README excerpt'ов. [src/core/profile-context.ts](../src/core/profile-context.ts) — module-level кэш + `loadProfileContext` / `getCachedProfileContext` / `getCachedStack` / `refreshProfileIfStale`. [src/index.ts](../src/index.ts) — refresh + load в начале `main()` (best-effort, ошибки логируются). [src/core/analyzer.ts](../src/core/analyzer.ts) — переключён на `getCachedStack()` / `getCachedProfileContext()`.
- Config: [src/config.ts](../src/config.ts) — секция `github { login, token, snapshotMaxAgeHours }` (env'ы `GH_PROFILE_LOGIN`, `GH_PROFILE_TOKEN`, `GH_PROFILE_MAX_AGE_HOURS`). **Префикс `GH_` а не `GITHUB_`** — GitHub блокирует user-defined vars/secrets с `GITHUB_*`.
- Dashboard: [dashboard/lib/profile-fetch.ts](../dashboard/lib/profile-fetch.ts) (минимальная копия GH-fetcher'а через `fetch`, без axios — паттерн как `notifications/*`). [dashboard/lib/profile.ts](../dashboard/lib/profile.ts) — `getLatestSnapshot`, `refreshSnapshot`, `formatProfileMd`, `languagesByPct`. [dashboard/app/profile/page.tsx](../dashboard/app/profile/page.tsx) (Server Component, `dynamic='force-dynamic'`) + [dashboard/app/profile/RefreshButton.tsx](../dashboard/app/profile/RefreshButton.tsx) (client). [dashboard/app/api/profile/refresh/route.ts](../dashboard/app/api/profile/refresh/route.ts) (POST, Bearer `DASHBOARD_API_KEY`); [dashboard/app/api/profile/export/route.ts](../dashboard/app/api/profile/export/route.ts) (GET MD). Линк «👤 Профиль» в [dashboard/app/page.tsx](../dashboard/app/page.tsx).
- GHA: в [.github/workflows/scan-agent.yml](../.github/workflows/scan-agent.yml) проброшены `GH_PROFILE_LOGIN: ${{ vars.GH_PROFILE_LOGIN }}` и `GH_PROFILE_TOKEN: ${{ secrets.GITHUB_TOKEN }}` (встроенный GHA-токен — 5000 req/час; имя `GITHUB_TOKEN` валидно — это builtin).

## Решения

- Stack-merge: топ-N языков из снимка по bytes (не имена фреймворков!) + hand-pick из `profile.stack` дополняет фреймворки/инструменты. Так Next.js/NestJS/Prisma не теряются (GH classifies их как TypeScript).
- Refresh — best-effort: ошибка GH API не валит pipeline, fallback на старый снимок (или static `profile.ts` если снимка ещё нет).
- Module-level кэш в `profile-context.ts` — analyzer.ts остаётся sync (`getCachedStack`, `getCachedProfileContext`). Прогрев через `loadProfileContext()` в `main()`.
- Dashboard fetcher'у нужен отдельный модуль (`dashboard/lib/profile-fetch.ts` через нативный `fetch`) — `src/core/*` лежит вне `dashboard/` build-context. Дублирование <100 строк, как в `dashboard/lib/notifications/*`.

## Шаги для активации в проде

1. Добавить GitHub variable `GH_PROFILE_LOGIN` в Settings → Secrets and variables → Actions → **Variables** (нельзя префикс `GITHUB_*` — зарезервировано). На VPS — в `/opt/home-codespaces/.env` + `dashboard.environment` в `docker-compose.yml`.
2. Опционально на VPS — `GH_PROFILE_TOKEN` (PAT с `public_repo`, для большего rate limit'а кнопки «Обновить»).
3. Прогон через `workflow_dispatch` — должна появиться запись в `profile_snapshots` (проверить через `prisma studio` или `/profile`).
4. Открыть `/profile` — должны быть KPI, таблица языков, топ-репы. Кнопка «📥 Скачать MD» отдаёт `text/markdown`.
