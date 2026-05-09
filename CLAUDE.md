# CLAUDE.md — scan-agent

## 🔗 Глобальный контекст

Роль, стиль, система памяти — `~/.claude/CLAUDE.md` (загружается автоматически).
**Приоритет:** глобальный → этот файл → RAG (`codebase-rag` MCP).

## 📚 Дополнительные файлы

Подгружай по мере необходимости, не держи в контексте по умолчанию:
- [docs/plans/postgres-migration.md](docs/plans/postgres-migration.md) — план миграции БД (Шаги 1–4 ✅, 5–9 ⏳).
- `~/.claude/plans/sunny-drifting-token.md` — план надёжной доставки уведомлений (outbox + worker + SSE). Все 4 фазы ✅, итог в [docs/CHANGELOG.md](docs/CHANGELOG.md) (2026-05-08).
- [docs/CHANGELOG.md](docs/CHANGELOG.md) — лог изменений (только при поиске исторического контекста).
- [docs/DEPLOY.md](docs/DEPLOY.md) — VPS-стек, CI/CD, инфра-нюансы (только при работе с деплоем).

---

## ✅ Завершено: безупречная доставка уведомлений (outbox + worker + SSE)

Все 4 фазы плана `~/.claude/plans/sunny-drifting-token.md` закрыты. Подробный лог — в [docs/CHANGELOG.md](docs/CHANGELOG.md) (запись 2026-05-08). Ниже — карта кода и принятых решений.

**Архитектура.** Агент пишет `NotificationJob` записи в outbox синхронно с `markProcessed`; dashboard-контейнер 24/7 крутит dispatcher с `SELECT FOR UPDATE SKIP LOCKED`, retry-backoff `[30s, 1m, 5m, 15m, 1h, 6h, 24h]`, изоляция per-channel; для real-time в открытой вкладке — SSE через `pg_notify('order_new')`.

**Карта кода:**
- Outbox: модель `NotificationJob` в [prisma/schema.prisma](prisma/schema.prisma); миграция `20260505225113_add_notification_jobs` с `pg_notify`-триггерами `order_new` и `notification_job_new`.
- Агент: [src/core/notifications.ts](src/core/notifications.ts) (`enqueueNotifications` 1 telegram + N push, `enqueueReminder`); pure-форматтеры в [src/notifiers/telegram-format.ts](src/notifiers/telegram-format.ts); общий [src/core/prisma.ts](src/core/prisma.ts). [src/index.ts](src/index.ts) больше не отправляет уведомления напрямую.
- Worker: [dashboard/lib/notifications/dispatcher.ts](dashboard/lib/notifications/dispatcher.ts) — singleton через `globalThis`, poll `NOTIFICATIONS_POLL_INTERVAL_MS` (def 5000), batch `NOTIFICATIONS_BATCH_LIMIT` (def 20), атомарный `claimBatch` с подбором зависших `sending` >15мин, `Promise.allSettled` per-job. Каналы [telegram.ts](dashboard/lib/notifications/channels/telegram.ts) (прямой `fetch` Bot API; 429→Retryable(retry_after), 5xx→Retryable, 4xx→Fatal) и [push.ts](dashboard/lib/notifications/channels/push.ts) (`web-push` + TTL `2592000` + Urgency `high` + Topic per orderId; 410/404/403 → `pushSubscription.deleteMany` + Fatal). Ошибки: [errors.ts](dashboard/lib/notifications/errors.ts).
- Старт worker'а: [dashboard/instrumentation.ts](dashboard/instrumentation.ts) (Next.js 16 `register()`, edge-guard `NEXT_RUNTIME==='nodejs'`, kill-switch `NOTIFICATIONS_DISPATCHER_DISABLED=true`).
- Health: [dashboard/app/api/health/notifications/route.ts](dashboard/app/api/health/notifications/route.ts) — `GET` (Bearer `DASHBOARD_API_KEY`): counts по статусу за 24ч + oldest pending + last 10 failed.
- SSE: [dashboard/app/api/orders/stream/route.ts](dashboard/app/api/orders/stream/route.ts) — `runtime='nodejs'`, прямой `pg.Client` на `DATABASE_URL_DIRECT` (fallback `DATABASE_URL`), `LISTEN order_new`, heartbeat 25с, `X-Accel-Buffering: no`. [dashboard/components/RealtimeOrdersListener.tsx](dashboard/components/RealtimeOrdersListener.tsx) — `EventSource`, на `order_new` → invalidate `['orders']`, auto-reconnect 1s→30s, reset на `event: ready`. Подключён в [dashboard/app/layout.tsx](dashboard/app/layout.tsx) внутри `ClientProviders` (нужен `QueryClientProvider`).
- Service Worker: [dashboard/public/sw.js](dashboard/public/sw.js) — `tag: orderId, renotify: true` (повторный push по тому же заказу схлопывается, но звук/вибро срабатывают); `notificationclick` фокусирует существующую вкладку dashboard вместо повторного `openWindow`.

**Prod-разворот (2026-05-08, end-to-end проверено: `done=30, failed=0`):**
- Dashboard переехал с локального `postgres-scan` контейнера на Prisma Postgres (одна БД источник правды для агента и UI). Live-данные мигрированы (190 orders + 5 push_subs) через `pg_dump --data-only --column-inserts`. Перед dump'ом — `UPDATE orders SET col = COALESCE(col, '')` для text-полей, иначе Prisma DDL `NOT NULL DEFAULT ''` отвергает legacy NULL'ы.
- Контейнер `postgres-scan` оставлен на VPS как страховка/legacy backup; через ~неделю снесём, если всё стабильно.
- В `/opt/home-codespaces/.env` добавлены: `DATABASE_URL` (pooled), `DATABASE_URL_DIRECT` (direct), `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`. Блок `dashboard.environment` в `/opt/home-codespaces/docker-compose.yml` переписан на `${...}` через эти env'ы; `depends_on: postgres-scan` удалён.
- В GitHub Secrets добавлен `DATABASE_URL` (тот же pooled URL) — для cron-агента.

**Critical нюансы из prod-rollout (для будущих правок):**
- **`$queryRaw` в Prisma Postgres pooled URL** требует префикса `public.` — иначе `42P01 relation "X" does not exist`. Pooled даёт `current_schema = null`, ORM-запросы (`prisma.X.findMany`) сами шлют `"public"."X"` и работают, raw — нет. Параметр `&schema=public` в URL Prisma 6.19 НЕ обрабатывает (отвечает `Can't reach database server`). См. fix в [dashboard/lib/notifications/dispatcher.ts:114-129](dashboard/lib/notifications/dispatcher.ts#L114-L129).
- **Docker build dashboard в монорепо**: workflow [`.github/workflows/deploy-dashboard.yml`](.github/workflows/deploy-dashboard.yml) использует `context: .` (repo root) + `file: ./dashboard/Dockerfile`. Если оставить `context: ./dashboard` — `npm ci` падает, потому что `dashboard/postinstall = prisma generate --schema ../prisma/schema.prisma` смотрит за пределы build context'а. Dockerfile многоступенчатый: deps-стадия ставит и корневые deps (с `npx prisma generate` для `@prisma/client`), и dashboard-deps. Standalone структура: `/app/dashboard/server.js + /app/node_modules/`, запуск `node dashboard/server.js`. Корневой [.dockerignore](.dockerignore) отсекает `.git/.next/node_modules/docs`.
- **Next.js 16 standalone в монорепо** требует и `turbopack.root: '..'`, и `outputFileTracingRoot: '..'` в [dashboard/next.config.ts](dashboard/next.config.ts). Без `outputFileTracingRoot` standalone-bundle не подхватывает `@prisma/client` из корневого `node_modules`.

**Параллельный трек — Postgres-миграция (план `docs/plans/postgres-migration.md`):**
- ✅ Шаги 1–3 — Prisma Postgres + storage переписан, `better-sqlite3` удалён.
- ✅ Шаг 4 — dashboard на Prisma: [dashboard/lib/db.ts](dashboard/lib/db.ts) (singleton + `serializeOrder` для snake_case API), все API routes (`orders`, `pitch`, `reset`, `push-subscriptions`), `actions.ts`. **`@prisma/client` намеренно НЕ в `dashboard/package.json`** — иначе ставится заглушка с `PrismaClient = any`; резолвится из корневого `node_modules` через Node module resolution. Это критично для type-check и Next.js standalone.
- ⏳ Шаги 5–9 — отложены, переосмыслены после внедрения outbox (удаление `src/notifiers/dashboard.ts` потеряло актуальность).

**Принятые решения:**
- БД очереди: Postgres (выбран вместо Redis/BullMQ — для 10–15 push/день overkill; `pg_notify` + `SKIP LOCKED` дают всё нужное без новой инфры).
- Real-time: SSE с подпиской на `pg_notify`. **LISTEN/NOTIFY требует non-pooled `DATABASE_URL`** через прямой `pg.Client` — Prisma Postgres даёт оба URL.
- Push fan-out: одна job на endpoint (а не одна общая) — потеря одной не влияет на остальные.
- Worker singleton — через `instrumentation.ts` + `globalThis` guard. Если когда-то 2 реплики dashboard — `SKIP LOCKED` всё равно атомарен.

**Нюансы:**
- `HTTP_PROXY` в dev ломает `prisma migrate`/`generate` — запускать с `env -u HTTP_PROXY -u HTTPS_PROXY -u http_proxy -u https_proxy npx prisma ...`.
- Telegram polling **остаётся в агенте** (callback-кнопки `/setrate`, `/setscore`, `pick1/pick2/skip`). Перенос polling'а в dashboard — отдельная задача.
- `migrations/001_add_hh_fields.sql` и `supabase/migration.sql` — реликты pre-Prisma эпохи, можно удалить вместе со следующим cleanup'ом БД.
- `web-push` остаётся в корневом `package.json` ради `scripts/test-push.ts` (sanity-check доставки на проде); `src/notifiers/push.ts` удалён в Фазе 4.

---

## ✅ Завершено: Блок 1 — метрики прогона + `/stats` + MD-экспорт (2026-05-08)

Воронка (parsed → filtered → AI-scored → enqueued → applied → won/lost), AI tokens/cost, гистограмма score'ов и история прогонов пишутся в `RunMetric` каждым запуском агента. Доступны на `/stats` (KPI + recharts) и как скачиваемый MD-отчёт.

**Карта кода:**
- Backend: [src/types.ts](src/types.ts) (`AiUsage`); [src/core/analyzer.ts](src/core/analyzer.ts) — `callOpenRouter` отдаёт `{text, usage}`, `fetchGenerationCost(id)` через `GET /api/v1/generation`; `scoreOrder/generatePitch/analyzeOrder` возвращают usage. [src/core/metrics.ts](src/core/metrics.ts) — класс `RunMetrics` (counters + `flush`), runId через `randomUUID`. [src/index.ts](src/index.ts) инструментирован, `metrics.flush()` в `finally` перед exit.
- Dashboard: [dashboard/lib/stats.ts](dashboard/lib/stats.ts) — единый `getStats()` для page и MD-экспорта. [dashboard/app/stats/page.tsx](dashboard/app/stats/page.tsx) (Server Component, `dynamic='force-dynamic'`) + [dashboard/app/stats/StatsCharts.tsx](dashboard/app/stats/StatsCharts.tsx) (recharts). [dashboard/app/api/metrics/export/route.ts](dashboard/app/api/metrics/export/route.ts) — `text/markdown` отчёт. Линк «📊 Статистика» в [dashboard/app/page.tsx](dashboard/app/page.tsx).
- Зависимости: `recharts^3.8.1` в [dashboard/package.json](dashboard/package.json).

**Решения:**
- "sent" в `RunMetric` после миграции на outbox **= enqueued**. Реальная доставка (telegram/push) считается отдельно в [`/api/health/notifications`](dashboard/app/api/health/notifications/route.ts).
- AI-cost — best-effort: `GET /api/v1/generation?id={id}` через `withRetry({maxAttempts: 2})`; на 404/timeout → 0, не ломает pipeline.
- Score histogram — статичные buckets `["0-2", "3-4", "5-6", "7-8", "9-10"]`.

**Утилита для будущей работы:** [scripts/mobile-shot.mjs](scripts/mobile-shot.mjs) — playwright-снимок страницы в iPhone-вьюпорте. Запуск из code-server-контейнера через docker-network к `http://dashboard:3000` (минуя Caddy/Authelia).

---

## ✅ Реализовано: Блок 2 — динамический профиль из GitHub (2026-05-09)

`src/profile.ts` больше не единственный источник стека. Раз в N часов агент тащит публичные репы из GitHub REST API, агрегирует языки (bytes), берёт топ-репы с README excerpt'ами и сохраняет в `ProfileSnapshot`. AI-промпты (`scoreOrder`, `generatePitch`) читают «derived stack» (топ-N языков) + hand-pick из `profile.stack` (фреймворки/инструменты, которые GH classifies как TypeScript) + рендеренный портфолио из снимка. Static fields (name, headline, strengths, communicationStyle) остаются в `profile.ts` — это «характер».

**Карта кода:**
- БД: модель `ProfileSnapshot` в [prisma/schema.prisma](prisma/schema.prisma); миграция `20260509081445_add_profile_snapshot`.
- Backend: [src/core/github-profile.ts](src/core/github-profile.ts) — `fetchGithubProfile(login, token?)` через axios + `withRetry`; собирает топ-15 репов (languages) + топ-5 README excerpt'ов. [src/core/profile-context.ts](src/core/profile-context.ts) — module-level кэш + `loadProfileContext` / `getCachedProfileContext` / `getCachedStack` / `refreshProfileIfStale`. [src/index.ts](src/index.ts) — refresh + load в начале `main()` (best-effort, ошибки логируются). [src/core/analyzer.ts](src/core/analyzer.ts) — переключён на `getCachedStack()` / `getCachedProfileContext()`.
- Config: [src/config.ts](src/config.ts) — секция `github { login, token, snapshotMaxAgeHours }` (env'ы `GH_PROFILE_LOGIN`, `GH_PROFILE_TOKEN`, `GH_PROFILE_MAX_AGE_HOURS`). **Префикс `GH_` а не `GITHUB_`** — GitHub блокирует user-defined vars/secrets с `GITHUB_*`.
- Dashboard: [dashboard/lib/profile-fetch.ts](dashboard/lib/profile-fetch.ts) (минимальная копия GH-fetcher'а через `fetch`, без axios — паттерн как `notifications/*`). [dashboard/lib/profile.ts](dashboard/lib/profile.ts) — `getLatestSnapshot`, `refreshSnapshot`, `formatProfileMd`, `languagesByPct`. [dashboard/app/profile/page.tsx](dashboard/app/profile/page.tsx) (Server Component, `dynamic='force-dynamic'`) + [dashboard/app/profile/RefreshButton.tsx](dashboard/app/profile/RefreshButton.tsx) (client). [dashboard/app/api/profile/refresh/route.ts](dashboard/app/api/profile/refresh/route.ts) (POST, Bearer `DASHBOARD_API_KEY`); [dashboard/app/api/profile/export/route.ts](dashboard/app/api/profile/export/route.ts) (GET MD). Линк «👤 Профиль» в [dashboard/app/page.tsx](dashboard/app/page.tsx).
- GHA: в [.github/workflows/scan-agent.yml](.github/workflows/scan-agent.yml) проброшены `GH_PROFILE_LOGIN: ${{ vars.GH_PROFILE_LOGIN }}` и `GH_PROFILE_TOKEN: ${{ secrets.GITHUB_TOKEN }}` (встроенный GHA-токен — 5000 req/час; имя `GITHUB_TOKEN` валидно — это builtin).

**Решения:**
- Stack-merge: топ-N языков из снимка по bytes (не имена фреймворков!) + hand-pick из `profile.stack` дополняет фреймворки/инструменты. Так Next.js/NestJS/Prisma не теряются (GH classifies их как TypeScript).
- Refresh — best-effort: ошибка GH API не валит pipeline, fallback на старый снимок (или static `profile.ts` если снимка ещё нет).
- Module-level кэш в `profile-context.ts` — analyzer.ts остаётся sync (`getCachedStack`, `getCachedProfileContext`). Прогрев через `loadProfileContext()` в `main()`.
- Dashboard fetcher'у нужен отдельный модуль (`dashboard/lib/profile-fetch.ts` через нативный `fetch`) — `src/core/*` лежит вне `dashboard/` build-context. Дублирование <100 строк, как в `dashboard/lib/notifications/*`.

**Шаги для активации в проде:**
1. Добавить GitHub variable `GH_PROFILE_LOGIN` в Settings → Secrets and variables → Actions → **Variables** (нельзя префикс `GITHUB_*` — зарезервировано). На VPS — в `/opt/home-codespaces/.env` + `dashboard.environment` в `docker-compose.yml`.
2. Опционально на VPS — `GH_PROFILE_TOKEN` (PAT с `public_repo`, для большего rate limit'а кнопки «Обновить»).
3. Прогон через `workflow_dispatch` — должна появиться запись в `profile_snapshots` (проверить через `prisma studio` или `/profile`).
4. Открыть `/profile` — должны быть KPI, таблица языков, топ-репы. Кнопка «📥 Скачать MD» отдаёт `text/markdown`.

---

## ⚠️ Частично реализовано: Блок 2 расширение — парсеры FL/Kwork/HH/Freelance.ru + housekeeping (2026-05-09)

**Инфраструктура задеплоена и работает.** GitHub-снимок дополнен 4 источниками: FL.ru / Kwork.ru / HH.ru (public share-link резюме) / Freelance.ru. **В AI-промпт льётся только HH-таймлайн опыта** (`scoreOrder` + `generatePitch`); FL/Kwork/Freelance.ru хранятся для UI на `/profile` и MD-экспорта. Введён housekeeping: keep last 30 per source + delete `fetchedAt < now - 90d`.

**Селекторы парсеров требуют живой настройки** (см. backlog ниже). Smoke-прогон 2026-05-09: HH = 403 (антибот), FL/Kwork/Freelance.ru = снимки записались, но поля частично пустые/кривые. Pipeline не падает.

**Карта кода:**
- БД: `ProfileSnapshot` дополнен `source ProfileSource` (enum github/fl/kwork/hh/freelanceru, default `github`) + `payload Json`. `githubLogin` стал nullable. Индекс `(source, fetched_at desc)`. Миграция `20260509100000_add_profile_snapshot_source` (existing rows backfilled через DEFAULT).
- Парсеры: [src/core/profile/](src/core/profile/) — `types.ts` (узкие payload-ы), `browser.ts` (`withStealthPage` поверх существующего `parsers/browser.ts`), `hh.ts` / `fl.ts` / `kwork.ts` / `freelanceru.ts`, `housekeeping.ts`, фасад `index.ts` (`refreshAllProfiles` через `Promise.allSettled`, ошибка одного источника не валит остальные).
- Profile-context: [src/core/profile-context.ts](src/core/profile-context.ts) теперь читает `source=github` для GitHub-снимка и `source=hh` для опыта; новый экспорт `getCachedExperienceContext()`.
- Analyzer: [src/core/analyzer.ts](src/core/analyzer.ts) пробрасывает HH-experience в оба промпта (если снимка нет — блок не вставляется).
- Pipeline: [src/index.ts](src/index.ts) после `refreshProfileIfStale` вызывает `refreshAllProfiles` + `cleanupProfileSnapshots`.
- Config: [src/config.ts](src/config.ts) секция `profile` (`flUrl`, `kworkUrl`, `hhResumeUrl`, `freelanceruUrl`, `snapshotMaxAgeHours`).
- Dashboard: [dashboard/lib/profile.ts](dashboard/lib/profile.ts) → `getAllSnapshots()` per source + расширенный `formatProfileMd`. [dashboard/lib/profile-types.ts](dashboard/lib/profile-types.ts) — копия payload-ов (dashboard не делит код с агентом, паттерн как `lib/notifications/*`). [dashboard/app/profile/page.tsx](dashboard/app/profile/page.tsx) — секции HH/FL/Kwork/Freelance.ru с пометкой «обновляется по cron агента».
- GHA: 4 новых vars (`HH_RESUME_PUBLIC_URL`, `FL_PROFILE_URL`, `KWORK_PROFILE_URL`, `FREELANCERU_PROFILE_URL`) в [.github/workflows/scan-agent.yml](.github/workflows/scan-agent.yml).

**Решения:**
- Унификация: одна таблица `ProfileSnapshot` с дискриминатором `source`. Меньше моделей, один cleanup. GitHub продолжает писать в legacy `languagesAgg`/`repos` (бэкуордно), новые источники — в `payload`.
- AI: только HH в промпт (опыт работы — то, чего GitHub не даёт). FL/Kwork/Freelance.ru — социальное доказательство, но в питч не льём, чтобы не раздувать context window.
- Refresh-кнопка `/profile` остаётся **GitHub-only** — Playwright не тащим в dashboard-контейнер. Не-GitHub источники обновляются по cron агента.
- Housekeeping вызывается раз за прогон сразу после refresh, best-effort.

**Critical-нюансы:**
- HH share-link обязан быть **публичным** (формат `hh.ru/resume/<hash>`), а не приватный URL аккаунта — иначе 403. Парсер валидирует regex'ом до `goto`.
- Селекторы FL/Kwork/HH-резюме могут устареть (как у парсеров заказов). При смене вёрстки парсер вернёт частичный снимок + `debug-profile-<source>.png` рядом.
- `dashboard/lib/profile-types.ts` дублирует `src/core/profile/types.ts` — это намеренно, чтобы dashboard не зависел от `src/`.

**Шаги для активации в проде:**
1. `npx prisma migrate deploy` (мигрирует existing GitHub-снимки → `source='github'` через DEFAULT).
2. Добавить GitHub vars: `HH_RESUME_PUBLIC_URL`, `FL_PROFILE_URL`, `KWORK_PROFILE_URL`, `FREELANCERU_PROFILE_URL`. Значения — из `.env.example`.
3. На VPS — те же URL'ы в `/opt/home-codespaces/.env`.
4. `workflow_dispatch` — должны появиться 4 новых ProfileSnapshot, проверить через `prisma studio` или `/profile`.

**Backlog (приоритет = подкрутка селекторов):**
- **HH 403** — public share-link под антиботом Cloudflare/hh.ru. Решение: OAuth API через `hh.ru/oauth/authorize` + регистрация app, доступ к `/me/resumes`. Альтернатива — прокси.
- **FL селектор** — `[class*="portfolio"]` слишком широкий, ловит nav-ссылки `#profile-nav` («Портфолио», «Прайс-лист») вместо реальных работ. Нужен скоп до основного контента (например, исключить `nav` и `header`).
- **Kwork** — `.want-card`/`.kwork-item` это селекторы для страницы заказов, не для профиля продавца. Нужно открыть реальный markup `kwork.ru/user/<login>` через headful Playwright и найти контейнер услуг.
- **Freelance.ru** — `rating=61` пойман через `tryText` наугад, это шум. Селектор реального рейтинга найти на живой странице или признать что его нет в публичном виде.
- Опционально: флаг `enabled` в `config.profile.{fl,kwork,hh,freelanceru}` чтобы выключать источник env'ом без удаления URL.
- Ручной refresh не-GitHub источников из dashboard (через outbox-job).
- FL/Kwork few-shot для `generatePitch`.
- Алёрт в Telegram при падении парсера профиля 3+ раз подряд.

---

## 🛠️ Инфра

- **Dev-сабдомены через Caddy** (Prisma Studio и любые dev-порты наружу): [docs/dev-subdomains.md](docs/dev-subdomains.md).
- **Деплой / CI/CD / VPS**: [docs/DEPLOY.md](docs/DEPLOY.md).

---

## What This Project Does

AI-агент скрапит фриланс-биржи (Kwork, FL.ru, Freelance.ru, Habr Freelance) и вакансии с HH.ru, оценивает проекты LLM (0–10), генерирует 2 варианта питча и шлёт уведомления в Telegram + Next.js dashboard. Запускается cron'ом GitHub Actions.

**Pipeline (фриланс)**: Parse → Pre-filter (no AI) → AI Score → Pitch (×2, parallel) → Notify → Save
**Pipeline (FL.ru)**: Parse → Pre-filter → AI Score → Notify (без AI-питча, отклик пишется вручную) → Save
**Pipeline (HH.ru)**: Parse → hardExclude (keyword) → AI Score → Notify (без питча) → Save

## Commands

### Backend (root)
```bash
npm run dev       # Run agent с pretty-логами (tsx, PRETTY_LOGS=true)
npm run build     # Compile TypeScript → dist/
npm start         # Run dist/index.js
npm run lint      # TypeScript type-check (no emit)
npm run test-push # Тест push-уведомлений
```

### Dashboard (Next.js 16)
```bash
cd dashboard
npm run dev    # Dev на :3000
npm run build  # Production build
npm run lint   # ESLint
```

## Architecture

### Core Pipeline (`src/index.ts`)
1. Init: Storage (Prisma Postgres), Telegram, Push, Dashboard notifiers
2. Telegram callback polling (inline-кнопки)
3. Parsers → merge → для каждого нового заказа: filter → AI score → (pitch×2 если фриланс/Kwork/Habr) → notify → save
4. Reminders для high-score заказов через 2+ часа
5. С `KEEP_ALIVE=false` (cron) — exit через 30 сек

### Key Design Decisions
- **Pre-AI filter** (`src/core/filter.ts`): стоп-слова, мин. цена, макс. офферы — отсекает мусор до LLM
- **Two pitch temperatures**: A=0.5 (focused), B=0.9 (creative), параллельно
- **Prisma Postgres as source of truth** ([src/core/storage.ts](src/core/storage.ts)): дедуп по `(orderId, source)`, все методы async
- **Dynamic settings**: minPrice/minScore/maxOffers/stopWords хранятся в БД, меняются через Telegram (`/setrate`, `/setscore`, `/setstop`)
- **Notifier independence**: каждый канал падает независимо
- **Retry with backoff** (`src/utils/retry.ts`): exponential для OpenRouter / Telegram / Supabase

### Configuration (`src/config.ts`)
Все env с дефолтами. CSS-селекторы парсеров здесь же — обновлять при смене вёрстки маркетплейсов. Профиль разработчика для AI-питча — `src/profile.ts`.

### AI Integration (`src/core/analyzer.ts`)
- Модель: DeepSeek через OpenRouter
- Scoring: temp 0.3, JSON `{score, reason}`, Zod-валидация. Промпт использует `profile.stack`
- Pitching: temp 0.5/0.9, JSON `{hook, pitch}`, RU only, hook ≤100, pitch ≤1000
- Max 2 попытки на заказ
- Для HH/FL: только `scoreOrder()`, без `generatePitch()`

### Keyword Scorer (`src/core/keyword-scorer.ts`)
Pre-filter для HH: hardExclude (PHP/Java/1С/gamedev) + positive score.
- `kw.excluded` → пропустить без AI
- `kw.rawScore < config.hh.minKeywordScore` → пропустить без AI
- `FULLSTACK_SCORING` / `DEVOPS_SCORING` конфиги
- `minKeywordScore=10` ≈ минимум 1 core keyword (TypeScript/React/Node.js)

### Parsers (`src/parsers/`)
Каждый реализует `Parser` interface (`fetch() → Order[]`). Playwright + puppeteer-extra-stealth. FL.ru имеет `findWorkingSelector()` fallback. Debug screenshots при ошибках.

**HH.ru** (`src/parsers/hh.ts`): включается через `HH_ENABLED=true`. `offersCount=0`, `meta.employer/city`, пагинация `config.hh.maxPages` (def 3), `waitUntil: 'domcontentloaded'`.

**Добавить маркетплейс**: реализовать `Parser`, добавить в `src/config.ts`, экспортнуть из `src/parsers/index.ts`.

### Dashboard (`dashboard/`)
Next.js 16 App Router + React 19 + Tailwind 4 + TanStack Query. Данные из VPS Postgres через `pg` (мигрирует на Prisma). `OrderCard` показывает оба варианта питча с copy-on-tap.
**⚠️ Next.js 16** — breaking changes; читать `node_modules/next/dist/docs/` до правок фронта.

#### Service Worker (PWA + Push)
`dashboard/public/sw.js` — **статичный**, коммитится в git, не генерируется при сборке (т.к. `@ducanh2912/next-pwa` несовместим с Next.js 16, удалён). `Cache-Control: no-store` на `/sw.js` в `next.config.ts`.

#### Push Subscriptions
- VAPID public key через `GET /api/vapid-public-key` (runtime), **не** `NEXT_PUBLIC_*` (build-time хрупко в standalone Docker)
- `PushNotificationManager` авто-переподписывает при `granted` + нет подписки
- Подписки на 410/404/403 авто-удаляются worker'ом ([dashboard/lib/notifications/channels/push.ts](dashboard/lib/notifications/channels/push.ts))

#### API Routes
- `GET/POST/DELETE /api/push-subscriptions` (GET/DELETE — `DASHBOARD_API_KEY`)
- `GET /api/vapid-public-key`
- `GET/POST /api/orders`, `POST /api/orders/pitch`

## Environment Variables

**Backend** (`.env` в `/opt/home-codespaces/` на VPS):
- `OPENROUTER_API_KEY`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`
- `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`
- `DASHBOARD_URL`, `DASHBOARD_API_KEY` (после миграции на Prisma — частично уйдёт)
- `DATABASE_URL` — Prisma Postgres (после миграции)
- `SUPABASE_URL`, `SUPABASE_ANON_KEY` — опционально
- `HH_ENABLED`, `HH_SEARCH_URL`, `HH_MAX_PAGES` (def 3), `HH_MIN_KEYWORD_SCORE` (def 10)

**Dashboard** (env в `docker-compose.yml`):
- `DATABASE_URL`, `VAPID_PRIVATE_KEY`, `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `DASHBOARD_API_KEY`
- **Для notifications worker'а:** `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`; опционально `VAPID_SUBJECT` (def `mailto:admin@example.com`), `NOTIFICATIONS_POLL_INTERVAL_MS` (def 5000), `NOTIFICATIONS_BATCH_LIMIT` (def 20), kill-switch `NOTIFICATIONS_DISPATCHER_DISABLED=true`.
- **Для SSE-роута** (`/api/orders/stream`): `DATABASE_URL_DIRECT` — non-pooled URL для прямого `pg.Client` (LISTEN/NOTIFY требует постоянной сессии, pgBouncer/Accelerate ломает подписку). Если не задан — fallback на `DATABASE_URL` (для локального dev на голом Postgres). Prisma Postgres даёт оба URL.

## Деплой и инфра

См. [docs/DEPLOY.md](docs/DEPLOY.md) — VPS-стек, CI/CD pipeline, нюансы webhook/прокси/build-cache.

## История изменений

См. [docs/CHANGELOG.md](docs/CHANGELOG.md) — все значимые изменения с датами и контекстом.
