# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Project Does

An AI-powered agent that scrapes freelance marketplaces (Kwork, FL.ru, Freelance.ru, Habr Freelance) **и вакансии с HH.ru**, scores projects with an LLM (0–10), generates two pitch variants per project, and sends notifications via Telegram and/or a Next.js dashboard. Runs as a GitHub Actions cron job every 30 minutes.

**Pipeline (фриланс)**: Parse → Pre-filter (no AI) → AI Score → Pitch (×2, parallel) → Notify (Telegram + Supabase/Dashboard + Push) → Save to SQLite

**Pipeline (HH.ru)**: Parse → hardExclude (keyword, без AI) → AI Score → Notify (Telegram, без питча) → Save to SQLite

## Commands

### Backend (root)
```bash
npm run dev       # Run agent with pretty logs (tsx, PRETTY_LOGS=true)
npm run build     # Compile TypeScript to dist/
npm start         # Run compiled dist/index.js
npm run lint      # TypeScript type-check (no emit)
npm run test-push # Тест push-уведомлений (на VPS: .env лежит в /opt/home-codespaces/)
```

### Dashboard (Next.js 16)
```bash
cd dashboard
npm run dev    # Dev server на порту 3000
npm run build  # Production build
npm run lint   # ESLint
```

## Architecture

### Core Pipeline (`src/index.ts`)
1. Initializes Storage (SQLite), Supabase, Dashboard, Telegram, Push notifiers
2. Starts Telegram callback polling (inline button interactions)
3. Runs each parser → merges orders
4. For each new order: fast filter → AI score → if score ≥ minScore, generate 2 pitches in parallel → notify all channels → save
5. Sends reminders for high-score orders ignored for 2+ hours
6. With `KEEP_ALIVE=false` (cron mode), exits after 30 seconds

### Key Design Decisions
- **Pre-AI filter** (`src/core/filter.ts`): Stop-words, min price, max offers — eliminates cheap/spam orders before paying for LLM
- **Two pitch temperatures**: Variant A at 0.5 (focused), Variant B at 0.9 (creative), generated concurrently
- **SQLite as source of truth** (`src/core/storage.ts`): Deduplication by `(order_id, source)` composite key; DB is cached between GitHub Actions runs
- **Dynamic settings**: minPrice, minScore, maxOffers, stopWords stored in DB, adjustable live via Telegram commands (`/setrate`, `/setscore`, `/setstop`)
- **Notifier independence**: Telegram, Supabase, Dashboard, Push each fail independently — one failure doesn't block others
- **Retry with backoff** (`src/utils/retry.ts`): Exponential backoff for OpenRouter, Telegram, Supabase API calls

### Configuration (`src/config.ts`)
All env vars flow through here with defaults. Parser selectors (CSS) are in config — update here when marketplace layouts change. The developer profile that feeds AI pitch generation is in `src/profile.ts`.

### AI Integration (`src/core/analyzer.ts`)
- Model: DeepSeek via OpenRouter (cheap, fast)
- Scoring: temp 0.3, JSON output `{score, reason}`, Zod-validated. Промпт использует `profile.stack` (реальный стек из `src/profile.ts`)
- Pitching: temp 0.5/0.9, JSON output `{hook, pitch}`, Russian only, hook ≤100 chars, pitch ≤1000 chars
- Max 2 attempts per order before skipping
- Для HH: вызывается только `scoreOrder()`, `generatePitch()` не вызывается

### Keyword Scorer (`src/core/keyword-scorer.ts`)
Используется только как pre-filter для HH (hardExclude) — убирает PHP/Java/1С/gamedev до AI-вызова.
Содержит `FULLSTACK_SCORING` и `DEVOPS_SCORING` конфиги.

### Parsers (`src/parsers/`)
Each parser implements the `Parser` interface from `src/types.ts` — a `fetch()` method returning `Order[]`. Uses Playwright + puppeteer-extra-stealth. FL.ru parser has a `findWorkingSelector()` fallback method for layout changes. Debug screenshots are saved on parse errors.

**HH.ru parser** (`src/parsers/hh.ts`): отдельный парсер для вакансий. Включается через `HH_ENABLED=true`. Особенности:
- `offersCount` всегда 0 (фильтр по конкуренции не применяется)
- `meta.employer` / `meta.city` → для красивого Telegram-сообщения
- Пагинация: `config.hh.maxPages` страниц (по умолчанию 3)
- Скоринг: hardExclude (keyword) → AI-скоринг → без питча

**To add a new marketplace**: implement the `Parser` interface, add config entry in `src/config.ts`, export from `src/parsers/index.ts`.

### Dashboard (`dashboard/`)
Next.js 16 App Router + React 19 + Tailwind CSS 4 + TanStack React Query. Data from VPS PostgreSQL (via `pg`). `OrderCard` shows both pitch variants with copy-on-tap. **Important**: Next.js 16 has breaking changes — read `node_modules/next/dist/docs/` before modifying frontend code.

#### Service Worker (PWA + Push)
`dashboard/public/sw.js` — **статичный файл, не генерируется при сборке**. Содержит:
- Push notification handler (title + body → `showNotification`)
- `skipWaiting` + `clientsClaim` для мгновенной активации
- Cache-first для `/_next/static/` (иммутабельные чанки)
- Network-first для страниц с offline fallback

**Почему статичный**: `@ducanh2912/next-pwa` несовместим с Next.js 16 — при сборке не генерировал `sw.js`. Пакет удалён. `sw.js` коммитится в git, не имеет зависимостей от build-хешей.

`Cache-Control: no-store` на `/sw.js` настроен в `next.config.ts`.

#### Push Subscriptions
- VAPID public key передаётся через `GET /api/vapid-public-key` (runtime), **не** через `NEXT_PUBLIC_*` (build-time). Причина: `NEXT_PUBLIC_*` в standalone Docker-сборке требует ARG на этапе build — это хрупко.
- `PushNotificationManager` автоматически переподписывает при `permission=granted` + отсутствии подписки (например после очистки БД).
- Push notifier (`src/notifiers/push.ts`) авто-удаляет подписки с ответом 410/404/403.

#### API Routes
- `GET/POST/DELETE /api/push-subscriptions` — управление подписками (GET/DELETE требуют `DASHBOARD_API_KEY`)
- `GET /api/vapid-public-key` — отдаёт публичный VAPID ключ клиенту
- `GET/POST /api/orders` — заказы
- `POST /api/orders/pitch` — обновить выбранный pitch

## Environment Variables

**Backend** (`.env` в `/opt/home-codespaces/` на VPS):
- `OPENROUTER_API_KEY`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`
- `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`
- `DASHBOARD_URL`, `DASHBOARD_API_KEY`
- `SUPABASE_URL`, `SUPABASE_ANON_KEY` — опционально
- `HH_ENABLED=true`, `HH_SEARCH_URL`, `HH_MAX_PAGES` (default: 3), `HH_MIN_KEYWORD_SCORE` (default: 10) — HH.ru парсер

**Dashboard** (env в `docker-compose.yml` на VPS):
- `DATABASE_URL` — `postgresql://scan:...@postgres-scan:5432/scan_agent`
- `VAPID_PRIVATE_KEY`, `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `DASHBOARD_API_KEY`

## Деплой на VPS

Проект запущен в Docker на `/opt/home-codespaces/`. Состав:
- `caddy` — reverse proxy (80/443), домен `scan.nikulshin-dev.online`
- `dashboard` — Next.js 16, образ из GHCR (`ghcr.io/dnikulshin/scan-agent/dashboard:latest`)
- `postgres-scan` — PostgreSQL 16
- `webhook` — приём деплой-хуков, порт 9000 → `webhook.nikulshin-dev.online`

### CI/CD: GitHub Actions → GHCR → VPS

Любой `git push` с изменениями в `dashboard/` запускает `.github/workflows/deploy-dashboard.yml`:
1. Сборка Docker-образа на GitHub (бесплатно, с GHA-кешем слоёв)
2. Push в `ghcr.io/dnikulshin/scan-agent/dashboard:latest`
3. Вызов webhook → VPS делает `docker compose pull dashboard && docker compose up -d dashboard`

**Ручной деплой** (если CI не нужен):
```bash
cd /opt/home-codespaces
docker compose pull dashboard
docker compose up -d dashboard
```

### Важные нюансы инфраструктуры
- `adnanh/webhook` **не раскрывает** `${VAR}` в `hooks.json` самостоятельно. В docker-compose используется `envsubst` при запуске: `envsubst < hooks.json > /tmp/hooks.json`
- `NEXT_PUBLIC_VAPID_PUBLIC_KEY` передаётся в dashboard как runtime env (не build ARG) — ключ берётся через `/api/vapid-public-key`
- Очистка build cache (делать раз в неделю): `docker builder prune -f`

### Локальная разработка (dev-окружение)
- В dev-окружении установлен `HTTP_PROXY=http://172.18.0.1:8118`. Axios автоматически проксирует через него все исходящие запросы — прокси ломает заголовки и OpenRouter отвечает 400 `"Invalid header received from client."`. Все axios-вызовы к внешним API должны иметь `proxy: false`. В GitHub Actions прокси нет, флаг безопасен в обоих окружениях.
- При локальном `npm run dev` Telegram polling конфликтует с инстансом бота на VPS — ошибки `409 Conflict: terminated by other getUpdates request` в логах нормальны и не мешают работе агента.

## GitHub Actions Workflows

| Workflow | Триггер | Что делает |
|---|---|---|
| `scan-agent.yml` | cron каждые 30 мин | Запускает агента: парсинг → AI → уведомления |
| `deploy-dashboard.yml` | push в `dashboard/` | Сборка → GHCR → деплой на VPS |

## Лог изменений

### 2026-04-27 — Dashboard поддержка HH.ru + фикс HH_MAX_PAGES
**Что сделано:**
- `dashboard/lib/db.ts` — поля `employer` и `city` в интерфейсе `Order`
- `dashboard/app/api/orders/route.ts` — INSERT/UPDATE сохраняет `employer` и `city`
- `dashboard/app/page.tsx` — фильтр по источнику включает `hh`
- `dashboard/components/OrderCard.tsx`:
  - `hh: '🔴'` в SOURCE_EMOJI
  - для HH: показывает `🏢 employer` и `📍 city` вместо счётчика откликов
  - кнопка «Показать отклик» скрыта когда `hook`/`pitch` пустые (все HH-вакансии)
- `src/notifiers/dashboard.ts` — передаёт `employer` и `city` в POST /api/orders
- `.github/workflows/scan-agent.yml` — добавлены `HH_ENABLED`, `HH_SEARCH_URL`, `HH_MAX_PAGES`, `HH_MIN_KEYWORD_SCORE`
- `migrations/001_add_hh_fields.sql` — миграция: `ALTER TABLE orders ADD COLUMN IF NOT EXISTS employer TEXT; ... city TEXT`
- **fix** `src/config.ts`: `Number(process.env.HH_MAX_PAGES ?? '3')` → `||` — `??` не защищает от пустой строки из незаданного GitHub secret, `Number('')=0` → цикл парсинга не запускался

**Что осталось:**
- ⚠️ Применить миграцию БД на VPS:
  ```bash
  docker exec postgres-scan psql -U scan -d scan_agent \
    -c "ALTER TABLE orders ADD COLUMN IF NOT EXISTS employer TEXT; ALTER TABLE orders ADD COLUMN IF NOT EXISTS city TEXT;"
  ```
- ⚠️ Добавить секрет `HH_ENABLED=true` в GitHub Actions (Settings → Secrets → Actions)
- ⚠️ Разобраться с деплоем дашборда — образ в GHCR актуальный (deploy-dashboard.yml прошёл), но `scan.nikulshin-dev.online` показывает старую версию. Webhook или docker compose pull не сработали.
- Рассмотреть добавление Task Management CRM или AnyWhereDesk в портфолио профиля

### 2026-04-26 — Интеграция HH.ru + обновление профиля
**Что сделано:**
- Добавлен `src/parsers/hh.ts` — Playwright-парсер вакансий HH.ru (пагинация, meta: employer/city)
- Добавлен `src/core/keyword-scorer.ts` — FULLSTACK_SCORING и DEVOPS_SCORING конфиги для hardExclude pre-filter
- `src/types.ts` — добавлен `'hh'` в union source, поле `meta?`
- `src/config.ts` — добавлена секция `hh` (enabled/url/maxPages/minKeywordScore)
- `src/parsers/index.ts` — экспорт HhParser
- `src/index.ts` — HH-ветка в pipeline: hardExclude → AI scoreOrder() → Telegram (без питча)
- `src/notifiers/telegram.ts` — HH.ru в SOURCE_LABEL, метод `sendVacancy()` (без inline-кнопок выбора питча)
- `src/core/analyzer.ts` — промпт скоринга теперь использует `profile.stack` вместо захардкоженного стека
- `src/profile.ts` — обновлён реальными данными: полный стек (Vue, NestJS, Fastify, Redis, React Native, Expo), 3 реальных проекта из GitHub

**Тест (2026-04-26):** 149 вакансий HH распарсено, 19 новых, 2 отправлено в Telegram — работает.
