# CLAUDE.md — scan-agent

## 🔗 Глобальный контекст

Роль, стиль, система памяти — `~/.claude/CLAUDE.md` (загружается автоматически).
**Приоритет:** глобальный → этот файл → RAG (`codebase-rag` MCP).

## 📚 Дополнительные файлы

Подгружай по мере необходимости, не держи в контексте по умолчанию:
- [docs/plans/postgres-migration.md](docs/plans/postgres-migration.md) — **активный план** миграции на Prisma Postgres (читать в начале сессии)
- [docs/CHANGELOG.md](docs/CHANGELOG.md) — лог изменений (только при поиске исторического контекста)
- [docs/DEPLOY.md](docs/DEPLOY.md) — VPS-стек, CI/CD, инфра-нюансы (только при работе с деплоем)

---

## 🚧 Текущая задача (in progress)

**Миграция на единую Prisma Postgres БД + метрики прогона.**

План: [docs/plans/postgres-migration.md](docs/plans/postgres-migration.md) — читать целиком, прежде чем продолжать.

**Прогресс:**
- ✅ Шаг 1 — Prisma Postgres подключён, `DATABASE_URL` в `.env` (pooled).
- ✅ Шаг 2 — [prisma/schema.prisma](prisma/schema.prisma) с 4 моделями (Order, Setting, PushSubscription, RunMetric с расширениями Блока 1). Миграция `20260505174149_init` применена.
- ✅ Шаг 3 — [src/core/storage.ts](src/core/storage.ts) на PrismaClient (async). Callers в [src/index.ts](src/index.ts) и [src/notifiers/telegram.ts](src/notifiers/telegram.ts) проставлены `await`. `count` getter → `count()`. `better-sqlite3` удалён. Прогон 2026-05-05: `totalNew=186, totalSent=8, dbSize=168` — БД пишется, дедуп ОК.
- ⏳ Шаг 4 (следующий) — `dashboard/lib/db.ts` + API на Prisma.
- Дальше: удалить `src/notifiers/dashboard.ts` → `src/core/metrics.ts` + инструментирование `src/index.ts` → `/stats` страница + `/api/metrics/export` → workflow.

**Принятые решения:**
- БД: Prisma Postgres (managed). ORM: Prisma 6.x (Prisma 7 убрали `datasource.url` в schema — несовместимо с планом, не используем).
- Метрики: per-run в `RunMetric` + ручные статусы заказа (`status`, `outcome`, `applied_at` уже в схеме) + UI-страница `/stats` + MD-экспорт `/api/metrics/export` (all-time). Подробнее: [Блок 1 в `~/.claude/plans/humming-enchanting-castle.md`].
- Cron в `.github/workflows/scan-agent.yml` оставить как есть.

**Нюансы:**
- `pg` есть только в `dashboard/node_modules/` — для ad-hoc проверок коннекта.
- `HTTP_PROXY` в dev может мешать `prisma migrate`/`generate` — все Prisma-команды запускать с `env -u HTTP_PROXY -u HTTPS_PROXY -u http_proxy -u https_proxy npx prisma ...`.
- Push-нотификатор (`src/notifiers/push.ts`) после миграции: оставить HTTP к dashboard или подключить к БД напрямую — отложено.
- `migrations/001_add_hh_fields.sql` и `supabase/migration.sql` пока не удаляем — снесём после переписывания storage и dashboard на Prisma.

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
- `src/notifiers/push.ts` авто-удаляет подписки на 410/404/403

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

## Деплой и инфра

См. [docs/DEPLOY.md](docs/DEPLOY.md) — VPS-стек, CI/CD pipeline, нюансы webhook/прокси/build-cache.

## История изменений

См. [docs/CHANGELOG.md](docs/CHANGELOG.md) — все значимые изменения с датами и контекстом.
