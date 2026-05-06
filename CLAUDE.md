# CLAUDE.md — scan-agent

## 🔗 Глобальный контекст

Роль, стиль, система памяти — `~/.claude/CLAUDE.md` (загружается автоматически).
**Приоритет:** глобальный → этот файл → RAG (`codebase-rag` MCP).

## 📚 Дополнительные файлы

Подгружай по мере необходимости, не держи в контексте по умолчанию:
- [docs/plans/postgres-migration.md](docs/plans/postgres-migration.md) — план миграции БД (Шаги 1–4 ✅, 5–9 ⏳).
- `~/.claude/plans/sunny-drifting-token.md` — **активный план** надёжной доставки уведомлений (outbox + worker + SSE). Фаза 1 ✅, Фаза 2 — следующая.
- [docs/CHANGELOG.md](docs/CHANGELOG.md) — лог изменений (только при поиске исторического контекста).
- [docs/DEPLOY.md](docs/DEPLOY.md) — VPS-стек, CI/CD, инфра-нюансы (только при работе с деплоем).

---

## 🚧 Текущая задача (in progress)

**Безупречная доставка уведомлений: outbox в Postgres + worker в dashboard + SSE.**

План: `~/.claude/plans/sunny-drifting-token.md` — читать целиком перед продолжением. Архитектура: агент пишет `NotificationJob` записи в outbox синхронно с `markProcessed`; dashboard-контейнер 24/7 крутит dispatcher с `SELECT FOR UPDATE SKIP LOCKED`, retry-backoff `[30s, 1m, 5m, 15m, 1h, 6h, 24h]`, изоляция per-channel; для real-time в открытой вкладке — SSE через `pg_notify('order_new')`.

**Прогресс по плану уведомлений:**
- ✅ Фаза 1 — outbox + enqueue в агенте:
  - Модель `NotificationJob` в [prisma/schema.prisma](prisma/schema.prisma); миграция `20260505225113_add_notification_jobs` с двумя `pg_notify`-триггерами (`order_new`, `notification_job_new`). Применена.
  - [src/notifiers/telegram-format.ts](src/notifiers/telegram-format.ts) — pure-форматтеры (`buildOrderMessage`, `buildReminderMessage`). [src/notifiers/telegram.ts](src/notifiers/telegram.ts) — теперь тонкая обёртка.
  - [src/core/prisma.ts](src/core/prisma.ts) — общий PrismaClient. [src/core/notifications.ts](src/core/notifications.ts) — `enqueueNotifications` (1 telegram + N push) и `enqueueReminder`.
  - [src/index.ts](src/index.ts) — inline `telegram.send`/`push.sendToAll` заменены на `markProcessed → enqueueNotifications`. Push-инстанс из агента удалён. Reminder через outbox.
  - [scripts/enqueue-smoke.ts](scripts/enqueue-smoke.ts) — sanity-check (прогон 2026-05-05: `delta=1`, ОК).
- ⏳ Фаза 2 (следующая) — dashboard worker:
  - `dashboard/lib/notifications/dispatcher.ts` (poll-loop + `claimBatch` через raw SQL `SELECT FOR UPDATE SKIP LOCKED`)
  - `dashboard/lib/notifications/channels/{telegram,push}.ts` (per-channel send, retryable/fatal errors, `web-push` с `TTL=2592000`, `urgency: 'high'`, `topic: orderId`; 410/404/403 → удалить подписку)
  - `dashboard/instrumentation.ts` (Next.js 16 register hook → запускает dispatcher)
  - `dashboard/app/api/health/notifications/route.ts` (counts по статусу + последние failed)
  - В `dashboard/package.json` вернуть `pg`, `@types/pg`, добавить `web-push`, `@types/web-push`
- Фаза 3 — SSE (`/api/orders/stream` + `RealtimeOrdersListener` компонент с `EventSource` → `queryClient.invalidateQueries`).
- Фаза 4 — cleanup: удалить `src/notifiers/push.ts`, обновить `sw.js` (`tag: orderId, renotify: true`), CHANGELOG, CLAUDE.md.

**Параллельный трек — Postgres-миграция (план `docs/plans/postgres-migration.md`):**
- ✅ Шаги 1–3 — Prisma Postgres + storage переписан, `better-sqlite3` удалён.
- ✅ Шаг 4 — dashboard на Prisma: [dashboard/lib/db.ts](dashboard/lib/db.ts) (singleton + `serializeOrder` для snake_case API), все API routes (`orders`, `pitch`, `reset`, `push-subscriptions`), `actions.ts`. **`@prisma/client` намеренно НЕ в `dashboard/package.json`** — иначе ставится заглушка с `PrismaClient = any`; резолвится из корневого `node_modules` через Node module resolution. Это критично для type-check и Next.js standalone.
- ⏳ Шаги 5–9 — отложены до Фазы 4 плана уведомлений (удалить `src/notifiers/dashboard.ts` уже не нужно после outbox).

**Принятые решения:**
- БД очереди: Postgres (выбран вместо Redis/BullMQ — для 10–15 push/день overkill; `pg_notify` + `SKIP LOCKED` дают всё нужное без новой инфры).
- Real-time: SSE с подпиской на `pg_notify`. **LISTEN/NOTIFY требует non-pooled `DATABASE_URL`** через прямой `pg.Client` — Prisma Postgres даёт оба URL.
- Push fan-out: одна job на endpoint (а не одна общая) — потеря одной не влияет на остальные.
- Worker singleton — через `instrumentation.ts` + `globalThis` guard. Если когда-то 2 реплики dashboard — `SKIP LOCKED` всё равно атомарен.

**Нюансы:**
- `HTTP_PROXY` в dev ломает `prisma migrate`/`generate` — запускать с `env -u HTTP_PROXY -u HTTPS_PROXY -u http_proxy -u https_proxy npx prisma ...`.
- Telegram polling **остаётся в агенте** (callback-кнопки `/setrate`, `/setscore`, `pick1/pick2/skip`). Перенос polling'а в dashboard — отдельная задача, не в этом плане.
- `migrations/001_add_hh_fields.sql` и `supabase/migration.sql` — снести после Фазы 4.

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
