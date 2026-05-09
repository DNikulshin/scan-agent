# CLAUDE.md — scan-agent

## 🔗 Глобальный контекст

Роль, стиль, система памяти — `~/.claude/CLAUDE.md` (загружается автоматически).
**Приоритет:** глобальный → этот файл → подгружаемые `docs/*` по мере необходимости → RAG (`codebase-rag` MCP).

## 📚 Карты архитектуры (подгружай по теме)

Этот файл — индекс. Карта кода и нюансы каждой подсистемы лежат в `docs/`. Не держи их в контексте по умолчанию — открывай только когда работаешь с соответствующей областью.

| Подсистема | Файл | Когда читать |
|---|---|---|
| Доставка уведомлений (outbox + worker + SSE) | [docs/notifications-outbox.md](docs/notifications-outbox.md) | правки в `dashboard/lib/notifications/`, `src/core/notifications.ts`, SSE-стриме, push/telegram-каналах |
| Метрики прогона + `/stats` + MD-экспорт | [docs/metrics-block1.md](docs/metrics-block1.md) | работа с `RunMetric`, `dashboard/app/stats/`, `/api/metrics/export` |
| Динамический профиль из GitHub | [docs/profile-github.md](docs/profile-github.md) | `src/core/github-profile.ts`, `profile-context.ts`, GH-снимок, `/profile` GitHub-секция |
| Парсеры FL/Kwork/Freelance.ru профилей | [docs/profile-extension.md](docs/profile-extension.md) | `src/core/profile/{fl,kwork,freelanceru}.ts`, `refreshAllProfiles`, smoke-profile |
| HH-резюме ручной заливкой | [docs/profile-hh-manual.md](docs/profile-hh-manual.md) | `dashboard/app/api/profile/hh/`, `HhUploadForm`, HH-секция `/profile`, `loadHhExperience` |
| План миграции БД | [docs/plans/postgres-migration.md](docs/plans/postgres-migration.md) | работа с БД-схемой, Prisma, миграциями (Шаги 1–4 ✅, 5–9 ⏳) |
| История изменений | [docs/CHANGELOG.md](docs/CHANGELOG.md) | поиск исторического контекста по дате/коммиту |
| Деплой / CI/CD / VPS | [docs/DEPLOY.md](docs/DEPLOY.md) | работа с `docker-compose.yml`, GHA workflow'ами, webhook'ами, VPS-стеком |
| Dev-сабдомены через Caddy | [docs/dev-subdomains.md](docs/dev-subdomains.md) | проброс dev-портов наружу через Authelia |

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
Next.js 16 App Router + React 19 + Tailwind 4 + TanStack Query. Данные из Prisma Postgres через `@prisma/client` (резолвится из корневого `node_modules` — см. [docs/notifications-outbox.md](docs/notifications-outbox.md) о монорепо-нюансе). `OrderCard` показывает оба варианта питча с copy-on-tap.
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
- `POST /api/profile/refresh` (GitHub снимок), `POST /api/profile/hh` (ручная заливка резюме), `GET /api/profile/export` (MD)

## Environment Variables

**Backend** (`.env` в `/opt/home-codespaces/` на VPS):
- `OPENROUTER_API_KEY`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`
- `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`
- `DASHBOARD_URL`, `DASHBOARD_API_KEY`
- `DATABASE_URL` — Prisma Postgres (pooled)
- `SUPABASE_URL`, `SUPABASE_ANON_KEY` — опционально
- `HH_ENABLED`, `HH_SEARCH_URL`, `HH_MAX_PAGES` (def 3), `HH_MIN_KEYWORD_SCORE` (def 10)
- `GH_PROFILE_LOGIN` (через GHA `vars`), `GH_PROFILE_TOKEN` (через GHA `secrets.GITHUB_TOKEN`) — см. [docs/profile-github.md](docs/profile-github.md)
- `FL_PROFILE_URL`, `KWORK_PROFILE_URL`, `FREELANCERU_PROFILE_URL` (через GHA `vars`) — см. [docs/profile-extension.md](docs/profile-extension.md)

**Dashboard** (env в `docker-compose.yml`):
- `DATABASE_URL`, `VAPID_PRIVATE_KEY`, `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `DASHBOARD_API_KEY`
- **Для notifications worker'а:** `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`; опционально `VAPID_SUBJECT` (def `mailto:admin@example.com`), `NOTIFICATIONS_POLL_INTERVAL_MS` (def 5000), `NOTIFICATIONS_BATCH_LIMIT` (def 20), kill-switch `NOTIFICATIONS_DISPATCHER_DISABLED=true`. Подробнее — [docs/notifications-outbox.md](docs/notifications-outbox.md).
- **Для SSE-роута** (`/api/orders/stream`): `DATABASE_URL_DIRECT` — non-pooled URL для прямого `pg.Client` (LISTEN/NOTIFY требует постоянной сессии, pgBouncer/Accelerate ломает подписку). Если не задан — fallback на `DATABASE_URL`. Prisma Postgres даёт оба URL.

## Деплой и инфра

См. [docs/DEPLOY.md](docs/DEPLOY.md) — VPS-стек, CI/CD pipeline, нюансы webhook/прокси/build-cache.

## История изменений

См. [docs/CHANGELOG.md](docs/CHANGELOG.md) — все значимые изменения с датами и контекстом.
