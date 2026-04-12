# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Project Does

An AI-powered agent that scrapes freelance marketplaces (Kwork, FL.ru, Freelance.ru, Habr Freelance), scores projects with an LLM (0–10), generates two pitch variants per project, and sends notifications via Telegram and/or a Next.js dashboard. Runs as a GitHub Actions cron job every 30 minutes.

**Pipeline**: Parse → Pre-filter (no AI) → AI Score → Pitch (×2, parallel) → Notify (Telegram + Supabase/Dashboard + Push) → Save to SQLite

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
- Scoring: temp 0.3, JSON output `{score, reason}`, Zod-validated
- Pitching: temp 0.5/0.9, JSON output `{hook, pitch}`, Russian only, hook ≤100 chars, pitch ≤1000 chars
- Max 2 attempts per order before skipping

### Parsers (`src/parsers/`)
Each parser implements the `Parser` interface from `src/types.ts` — a `fetch()` method returning `Order[]`. Uses Playwright + puppeteer-extra-stealth. FL.ru parser has a `findWorkingSelector()` fallback method for layout changes. Debug screenshots are saved on parse errors.

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

## GitHub Actions Workflows

| Workflow | Триггер | Что делает |
|---|---|---|
| `scan-agent.yml` | cron каждые 30 мин | Запускает агента: парсинг → AI → уведомления |
| `deploy-dashboard.yml` | push в `dashboard/` | Сборка → GHCR → деплой на VPS |
