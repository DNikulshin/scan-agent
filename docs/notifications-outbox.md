# Notifications outbox + worker + SSE

Подробный лог реализации — в [CHANGELOG.md](CHANGELOG.md) (запись 2026-05-08). Здесь — карта кода и принятых решений.

## Архитектура

Агент пишет `NotificationJob` записи в outbox синхронно с `markProcessed`; dashboard-контейнер 24/7 крутит dispatcher с `SELECT FOR UPDATE SKIP LOCKED`, retry-backoff `[30s, 1m, 5m, 15m, 1h, 6h, 24h]`, изоляция per-channel; для real-time в открытой вкладке — SSE через `pg_notify('order_new')`.

## Карта кода

- Outbox: модель `NotificationJob` в [prisma/schema.prisma](../prisma/schema.prisma); миграция `20260505225113_add_notification_jobs` с `pg_notify`-триггерами `order_new` и `notification_job_new`.
- Агент: [src/core/notifications.ts](../src/core/notifications.ts) (`enqueueNotifications` 1 telegram + N push, `enqueueReminder`); pure-форматтеры в [src/notifiers/telegram-format.ts](../src/notifiers/telegram-format.ts); общий [src/core/prisma.ts](../src/core/prisma.ts). [src/index.ts](../src/index.ts) больше не отправляет уведомления напрямую.
- Worker: [dashboard/lib/notifications/dispatcher.ts](../dashboard/lib/notifications/dispatcher.ts) — singleton через `globalThis`, poll `NOTIFICATIONS_POLL_INTERVAL_MS` (def 5000), batch `NOTIFICATIONS_BATCH_LIMIT` (def 20), атомарный `claimBatch` с подбором зависших `sending` >15мин, `Promise.allSettled` per-job. Каналы [telegram.ts](../dashboard/lib/notifications/channels/telegram.ts) (прямой `fetch` Bot API; 429→Retryable(retry_after), 5xx→Retryable, 4xx→Fatal) и [push.ts](../dashboard/lib/notifications/channels/push.ts) (`web-push` + TTL `2592000` + Urgency `high` + Topic per orderId; 410/404/403 → `pushSubscription.deleteMany` + Fatal). Ошибки: [errors.ts](../dashboard/lib/notifications/errors.ts).
- Старт worker'а: [dashboard/instrumentation.ts](../dashboard/instrumentation.ts) (Next.js 16 `register()`, edge-guard `NEXT_RUNTIME==='nodejs'`, kill-switch `NOTIFICATIONS_DISPATCHER_DISABLED=true`).
- Health: [dashboard/app/api/health/notifications/route.ts](../dashboard/app/api/health/notifications/route.ts) — `GET` (Bearer `DASHBOARD_API_KEY`): counts по статусу за 24ч + oldest pending + last 10 failed.
- SSE: [dashboard/app/api/orders/stream/route.ts](../dashboard/app/api/orders/stream/route.ts) — `runtime='nodejs'`, прямой `pg.Client` на `DATABASE_URL_DIRECT` (fallback `DATABASE_URL`), `LISTEN order_new`, heartbeat 25с, `X-Accel-Buffering: no`. [dashboard/components/RealtimeOrdersListener.tsx](../dashboard/components/RealtimeOrdersListener.tsx) — `EventSource`, на `order_new` → invalidate `['orders']`, auto-reconnect 1s→30s, reset на `event: ready`. Подключён в [dashboard/app/layout.tsx](../dashboard/app/layout.tsx) внутри `ClientProviders` (нужен `QueryClientProvider`).
- Service Worker: [dashboard/public/sw.js](../dashboard/public/sw.js) — `tag: orderId, renotify: true` (повторный push по тому же заказу схлопывается, но звук/вибро срабатывают); `notificationclick` фокусирует существующую вкладку dashboard вместо повторного `openWindow`.

## Prod-разворот (2026-05-08, end-to-end проверено: `done=30, failed=0`)

- Dashboard переехал с локального `postgres-scan` контейнера на Prisma Postgres (одна БД источник правды для агента и UI). Live-данные мигрированы (190 orders + 5 push_subs) через `pg_dump --data-only --column-inserts`. Перед dump'ом — `UPDATE orders SET col = COALESCE(col, '')` для text-полей, иначе Prisma DDL `NOT NULL DEFAULT ''` отвергает legacy NULL'ы.
- Контейнер `postgres-scan` оставлен на VPS как страховка/legacy backup; через ~неделю снесём, если всё стабильно.
- В `/opt/home-codespaces/.env` добавлены: `DATABASE_URL` (pooled), `DATABASE_URL_DIRECT` (direct), `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`. Блок `dashboard.environment` в `/opt/home-codespaces/docker-compose.yml` переписан на `${...}` через эти env'ы; `depends_on: postgres-scan` удалён.
- В GitHub Secrets добавлен `DATABASE_URL` (тот же pooled URL) — для cron-агента.

## Critical нюансы из prod-rollout (для будущих правок)

- **`$queryRaw` в Prisma Postgres pooled URL** требует префикса `public.` — иначе `42P01 relation "X" does not exist`. Pooled даёт `current_schema = null`, ORM-запросы (`prisma.X.findMany`) сами шлют `"public"."X"` и работают, raw — нет. Параметр `&schema=public` в URL Prisma 6.19 НЕ обрабатывает (отвечает `Can't reach database server`). См. fix в [dashboard/lib/notifications/dispatcher.ts:114-129](../dashboard/lib/notifications/dispatcher.ts#L114-L129).
- **Docker build dashboard в монорепо**: workflow [`.github/workflows/deploy-dashboard.yml`](../.github/workflows/deploy-dashboard.yml) использует `context: .` (repo root) + `file: ./dashboard/Dockerfile`. Если оставить `context: ./dashboard` — `npm ci` падает, потому что `dashboard/postinstall = prisma generate --schema ../prisma/schema.prisma` смотрит за пределы build context'а. Dockerfile многоступенчатый: deps-стадия ставит и корневые deps (с `npx prisma generate` для `@prisma/client`), и dashboard-deps. Standalone структура: `/app/dashboard/server.js + /app/node_modules/`, запуск `node dashboard/server.js`. Корневой [.dockerignore](../.dockerignore) отсекает `.git/.next/node_modules/docs`.
- **Next.js 16 standalone в монорепо** требует и `turbopack.root: '..'`, и `outputFileTracingRoot: '..'` в [dashboard/next.config.ts](../dashboard/next.config.ts). Без `outputFileTracingRoot` standalone-bundle не подхватывает `@prisma/client` из корневого `node_modules`.

## Параллельный трек — Postgres-миграция (план [docs/plans/postgres-migration.md](plans/postgres-migration.md))

- ✅ Шаги 1–3 — Prisma Postgres + storage переписан, `better-sqlite3` удалён.
- ✅ Шаг 4 — dashboard на Prisma: [dashboard/lib/db.ts](../dashboard/lib/db.ts) (singleton + `serializeOrder` для snake_case API), все API routes (`orders`, `pitch`, `reset`, `push-subscriptions`), `actions.ts`. **`@prisma/client` намеренно НЕ в `dashboard/package.json`** — иначе ставится заглушка с `PrismaClient = any`; резолвится из корневого `node_modules` через Node module resolution. Это критично для type-check и Next.js standalone.
- ⏳ Шаги 5–9 — отложены, переосмыслены после внедрения outbox (удаление `src/notifiers/dashboard.ts` потеряло актуальность).

## Принятые решения

- БД очереди: Postgres (выбран вместо Redis/BullMQ — для 10–15 push/день overkill; `pg_notify` + `SKIP LOCKED` дают всё нужное без новой инфры).
- Real-time: SSE с подпиской на `pg_notify`. **LISTEN/NOTIFY требует non-pooled `DATABASE_URL`** через прямой `pg.Client` — Prisma Postgres даёт оба URL.
- Push fan-out: одна job на endpoint (а не одна общая) — потеря одной не влияет на остальные.
- Worker singleton — через `instrumentation.ts` + `globalThis` guard. Если когда-то 2 реплики dashboard — `SKIP LOCKED` всё равно атомарен.

## Нюансы

- `HTTP_PROXY` в dev ломает `prisma migrate`/`generate` — запускать с `env -u HTTP_PROXY -u HTTPS_PROXY -u http_proxy -u https_proxy npx prisma ...`.
- Telegram polling **остаётся в агенте** (callback-кнопки `/setrate`, `/setscore`, `pick1/pick2/skip`). Перенос polling'а в dashboard — отдельная задача.
- `migrations/001_add_hh_fields.sql` и `supabase/migration.sql` — реликты pre-Prisma эпохи, можно удалить вместе со следующим cleanup'ом БД.
- `web-push` остаётся в корневом `package.json` ради `scripts/test-push.ts` (sanity-check доставки на проде); `src/notifiers/push.ts` удалён в Фазе 4.
