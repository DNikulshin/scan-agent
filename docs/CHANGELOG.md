# Лог изменений — scan-agent

Хронологический список значимых изменений. Свежие — сверху.

---

## 2026-05-08 (поздний вечер) — Блок 1: метрики прогона + `/stats` + MD-экспорт

Реализован первый из 4 стратегических блоков (план `~/.claude/plans/humming-enchanting-castle.md`, реализационный план — `~/.claude/plans/crystalline-popping-scott.md`). Воронка `parsed → filtered → AI-scored → enqueued → applied → won/lost`, AI tokens/cost, score histogram и история прогонов теперь пишутся в `RunMetric` каждым запуском агента и доступны на `/stats` + как скачиваемый MD-отчёт.

**Backend (commit `c3f8845`):**
- [src/types.ts](../src/types.ts) — добавлен `AiUsage`.
- [src/core/analyzer.ts](../src/core/analyzer.ts) — `callOpenRouter` возвращает `{text, usage}`. Cost подтягивается best-effort через `GET /api/v1/generation?id={id}` (`withRetry({maxAttempts: 2})`; 404/timeout → 0). `scoreOrder/generatePitch` → `{result, usage}`. `analyzeOrder` суммирует usage всех вызовов и возвращает количество pitch-вызовов.
- [src/core/metrics.ts](../src/core/metrics.ts) (новый) — класс `RunMetrics` (accumulator: `incParsed/incFiltered/incLowScoreKeyword/incLowScoreAi/incScoringCall/incPitchCall/addAiUsage/recordScore/incEnqueued/incError/setParserDuration` + `flush()`). `runId` через `crypto.randomUUID`. `sent` в Outbox-эпохе = `enqueued`.
- [src/index.ts](../src/index.ts) — pipeline инструментирован; `metrics.flush()` в `finally` перед `process.exit`.
- [scripts/metrics-smoke.ts](../scripts/metrics-smoke.ts) — sanity-check (прогон ОК, `delta=1`).

**Dashboard (тот же commit):**
- [dashboard/lib/stats.ts](../dashboard/lib/stats.ts) (новый) — единая `getStats()` для page и MD: KPI + воронка + scoreHistogram + bySource + recentRuns.
- [dashboard/app/stats/page.tsx](../dashboard/app/stats/page.tsx) + [dashboard/app/stats/StatsCharts.tsx](../dashboard/app/stats/StatsCharts.tsx) (новые) — Server Component с KPI-карточками, таблицей воронки, графиками (recharts) и таблицей последних 30 прогонов.
- [dashboard/app/api/metrics/export/route.ts](../dashboard/app/api/metrics/export/route.ts) (новый) — `GET` отдаёт `text/markdown` с `Content-Disposition: attachment`.
- [dashboard/app/page.tsx](../dashboard/app/page.tsx) — линк «📊 Статистика» в шапке.
- `recharts^3.8.1` в зависимостях dashboard.

**Mobile fix (commit `7aed66c`):**
- Шапка `/stats` на узких экранах: `flex-col sm:flex-row` для контейнера и группы кнопок, кнопки `text-center` (растягиваются на всю ширину на мобильном). Решает баг — обрезался заголовок «📊 Статистика», т.к. кнопки «Скачать MD» + «К заказам» не влезали в один ряд.
- Воронка: `overflow-x-auto + min-w-[360px]` для длинных меток («Отсеяно по keyword (HH)»).
- [scripts/mobile-shot.mjs](../scripts/mobile-shot.mjs) (новый) — playwright-снимок iPhone-вьюпорта; запускается из code-server'a через docker network к `http://dashboard:3000` (минуя Caddy/Authelia).

**Известный артефакт первого деплоя (исправлен):**
В первой проверке воронка показывала проценты > 100% (`applied=32`, но `parsed=8` из smoke-теста). Причина: legacy-orders из миграции postgres-scan → Prisma Postgres имели `status='applied'` исторически, а `RunMetric` была заполнена только smoke'ом. Решение: `DELETE FROM run_metrics WHERE run_id = '...';` smoke-записи. После первого реального cron-прогона `ScanAgent` цифры выровнялись.

---

## 2026-05-08 (вечер) — Production rollout outbox + миграция dashboard на Prisma Postgres

End-to-end проверено в проде: GHA cron-агент → orders в Prisma Postgres → enqueue → dashboard worker → telegram + 5 push'ей. Health: `done=30, pending=0, failed=0`. SSE: `event: ready`.

**Что приехало в прод этим разворотом** (в одной сессии, по шагам):

1. **GHA secret `DATABASE_URL`** добавлен (commit `2b0cd66`). До этого workflow `ScanAgent` падал бы на старте Prisma — секрета не было после миграции с SQLite.
2. **Docker build dashboard починен** для монорепо (commit `a6c30f0`):
   - `Deploy Dashboard` падал на `npm ci`, потому что build context был `./dashboard`, а `dashboard/postinstall = prisma generate --schema ../prisma/schema.prisma` смотрит за пределы context'а; плюс `@prisma/client` намеренно НЕ в `dashboard/package.json` (резолвится из корневого `node_modules`), в Docker корневых deps тоже не было.
   - Workflow: `context: .` + `file: ./dashboard/Dockerfile`.
   - [dashboard/Dockerfile](../dashboard/Dockerfile) многоступенчатый: deps-стадия ставит и корневые deps (с `npx prisma generate`), и dashboard-deps; builder копирует обе папки `node_modules`; runner запускает `node dashboard/server.js`.
   - [dashboard/next.config.ts](../dashboard/next.config.ts): добавлен `outputFileTracingRoot: '..'` — без него standalone не подхватывает `@prisma/client` из корневого `node_modules`.
   - Корневой [.dockerignore](../.dockerignore) отсекает `.git/.next/node_modules/docs`.
3. **Миграция БД dashboard** с локального `postgres-scan` на Prisma Postgres:
   - `UPDATE orders SET col = COALESCE(col, '')` в legacy БД (Prisma DDL даёт NOT NULL DEFAULT '', legacy DDL допускал NULL).
   - `pg_dump --data-only --column-inserts -t orders -t push_subscriptions` → импорт в Prisma Postgres через `psql` (после `TRUNCATE` smoke-test записей). 190 orders + 5 push_subs перенесены.
   - Блок `dashboard.environment` в `/opt/home-codespaces/docker-compose.yml` переписан на `${DATABASE_URL}/${DATABASE_URL_DIRECT}/${TELEGRAM_BOT_TOKEN}/${TELEGRAM_CHAT_ID}`; `depends_on: postgres-scan` удалён. Соответствующие env'ы добавлены в `/opt/home-codespaces/.env`.
   - Контейнер `postgres-scan` оставлен как страховка/legacy backup; снести через ~неделю если всё стабильно.
4. **`public.` префикс в `$queryRaw`** (commit `73ed733`):
   - Pooled URL Prisma Postgres отдаёт `current_schema = null`, raw SQL без префикса падает с `42P01 relation "notification_jobs" does not exist`.
   - ORM-запросы шлют `"public"."notification_jobs"` сами и работают, raw — нет.
   - Альтернатива через `&schema=public` в URL не сработала: Prisma 6.19 на ней отвечает `Can't reach database server`.
   - Fix в [dashboard/lib/notifications/dispatcher.ts:114-129](../dashboard/lib/notifications/dispatcher.ts#L114-L129) — `FROM public.notification_jobs`.

**Что осталось как «не блокеры»:**
- `RunMetric` метрики не пишутся в [src/index.ts](../src/index.ts) — отдельная задача (Блок 1, план `~/.claude/plans/humming-enchanting-castle.md`).
- `src/notifiers/dashboard.ts`, `src/notifiers/supabase.ts` — опциональные дублирующие каналы, можно удалить отдельным cleanup'ом.
- `migrations/001_add_hh_fields.sql`, `supabase/migration.sql` — реликты pre-Prisma эпохи.

---

## 2026-05-08 — Безупречная доставка уведомлений: outbox + worker + SSE (Фазы 1–4)

**Цель:** отвязать «решение отправить» от «факт доставки». Агент перестал отправлять напрямую — пишет `NotificationJob` в Postgres-outbox синхронно с `markProcessed`. Доставку делает 24/7 worker внутри dashboard-контейнера. План: `~/.claude/plans/sunny-drifting-token.md`.

**Архитектура:** `agent → notification_jobs → dashboard worker → Telegram / web-push`. SSE-стрим `pg_notify('order_new')` → открытые вкладки получают новые карточки без F5.

**Фаза 1 — outbox в БД и enqueue в агенте** (commit `d46ee9d`):
- Модель `NotificationJob` в [prisma/schema.prisma](../prisma/schema.prisma); миграция `20260505225113_add_notification_jobs` с `pg_notify`-триггерами `order_new` и `notification_job_new`.
- Pure-форматтеры [src/notifiers/telegram-format.ts](../src/notifiers/telegram-format.ts) (`buildOrderMessage`, `buildReminderMessage`) — переиспользуются и в агенте, и в worker'e.
- Общий [src/core/prisma.ts](../src/core/prisma.ts), [src/core/notifications.ts](../src/core/notifications.ts) с `enqueueNotifications` (telegram + N push) и `enqueueReminder`.
- [src/index.ts](../src/index.ts): inline `telegram.send`/`push.sendToAll` заменены на `markProcessed → enqueueNotifications`. Push-инстанс из агента удалён, reminder через outbox.

**Фазы 2–3 — dashboard worker + SSE** (commit `4c3e6a3`):
- [dashboard/lib/notifications/dispatcher.ts](../dashboard/lib/notifications/dispatcher.ts) — singleton через `globalThis`, poll `NOTIFICATIONS_POLL_INTERVAL_MS` (def 5000), batch до `NOTIFICATIONS_BATCH_LIMIT` (def 20). Атомарный `claimBatch` через `UPDATE … FROM (SELECT … FOR UPDATE SKIP LOCKED)`, подбирает зависшие `sending` (>15 мин). Backoff `[30s, 1m, 5m, 15m, 1h, 6h, 24h, 24h]`; `RetryableError.retryAfterSec` имеет приоритет (Telegram 429); `FatalError` или `attempts ≥ maxAttempts` → `failed`. Per-job изоляция через `Promise.allSettled`.
- Каналы: [telegram.ts](../dashboard/lib/notifications/channels/telegram.ts) — прямой `fetch` Bot API без `node-telegram-bot-api`; [push.ts](../dashboard/lib/notifications/channels/push.ts) — `web-push` с `TTL=2592000`, `Urgency: high`, `Topic: <orderId>`, авто-удаление подписок на 410/404/403.
- [dashboard/instrumentation.ts](../dashboard/instrumentation.ts) — Next.js 16 `register()`, kill-switch `NOTIFICATIONS_DISPATCHER_DISABLED`.
- Health: `GET /api/health/notifications` (Bearer `DASHBOARD_API_KEY`) — counts по статусу за 24ч + last 10 failed.
- SSE [dashboard/app/api/orders/stream/route.ts](../dashboard/app/api/orders/stream/route.ts): `runtime='nodejs'`, прямой `pg.Client` на `DATABASE_URL_DIRECT` (Prisma не умеет LISTEN/NOTIFY — pgBouncer/Accelerate теряют подписку), heartbeat 25с, `X-Accel-Buffering: no`. [RealtimeOrdersListener.tsx](../dashboard/components/RealtimeOrdersListener.tsx) — auto-reconnect 1s→30s, reset на `event: ready`.

**Фаза 4 — cleanup (этот коммит):**
- Удалён `src/notifiers/push.ts` — логика отправки и delete-on-410 переехала в worker.
- [dashboard/public/sw.js](../dashboard/public/sw.js): `tag: orderId, renotify: true` (повторный push по заказу схлопывается, но звук/вибро срабатывают); `notificationclick` фокусирует существующую вкладку dashboard вместо повторного открытия.
- `web-push` в корневом `package.json` остаётся ради `scripts/test-push.ts` (sanity-check доставки на проде).

**Принятые решения:**
- БД очереди — Postgres (Redis/BullMQ overkill для 10–15 push/день; `pg_notify` + `SKIP LOCKED` дают всё нужное).
- Push fan-out — одна job на endpoint (потеря одной не влияет на остальные).
- Worker singleton через `instrumentation.ts` + `globalThis`. На двух репликах `SKIP LOCKED` всё равно атомарен.
- Telegram polling (callback-кнопки `/setrate`, `pick1/pick2/skip`) **остаётся в агенте** — перенос polling'а в dashboard вне скоупа.

**Новые env для dashboard** (см. `CLAUDE.md`): `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `VAPID_SUBJECT`, `DATABASE_URL_DIRECT`, опц. `NOTIFICATIONS_POLL_INTERVAL_MS`, `NOTIFICATIONS_BATCH_LIMIT`, `NOTIFICATIONS_DISPATCHER_DISABLED`.

---

## 2026-05-05 — Шаг 2 миграции на Prisma + универсальный dev-доступ через Caddy

**Prisma миграция (Шаг 2 плана `docs/plans/postgres-migration.md`):**
- Установлены `prisma@6.19.3` + `@prisma/client@6.19.3` (Prisma 7 несовместим: убрал `datasource.url` из schema-файла, требует `prisma.config.ts`).
- `prisma/schema.prisma` с 4 моделями: `Order`, `Setting`, `PushSubscription`, `RunMetric` (последняя сразу с расширениями Блока 1: `aiTokensIn/Out`, `aiCostUsd Decimal(12,6)`, `parserDurations`, `scoreHistogram`, `scoringCalls`, `pitchCalls`).
- Применена миграция `prisma/migrations/20260505174149_init` к Prisma Postgres. Таблицы и индексы есть, smoke-test через `scripts/prisma-smoke.ts` ок (4 пустые таблицы доступны через PrismaClient).
- Все Prisma-команды нужно запускать **без HTTP-прокси**: `env -u HTTP_PROXY -u HTTPS_PROXY -u http_proxy -u https_proxy npx prisma ...`.

**Шаг 3 (storage.ts на Prisma) — заготовка:** черновик новой реализации `Storage` лежит в `docs/plans/storage-prisma-draft.ts`. В нём все методы async, есть `count()` (не геттер), `getStats` через `$queryRaw` с Postgres-синтаксисом (`COUNT(*) FILTER WHERE`, `INTERVAL`). После замены `src/core/storage.ts` нужно добавить `await` в `src/index.ts` (10 мест) и `src/notifiers/telegram.ts` (12 мест).

**Инфраструктура — универсальный dev-доступ:** в Caddyfile хоста (`/opt/home-codespaces/Caddyfile`) добавлен snippet `(devport)`. Любой порт codeserver-контейнера выводится наружу за один блок: `myapp.nikulshin-dev.online { import devport <PORT> }` + `caddy reload`. С Authelia. Решает классическую проблему code-server `/proxy/PORT/` для SPA (Prisma Studio, Next.js dev, NestJS, Vite, ...). Подробности — в [CLAUDE.md](../CLAUDE.md) разделе «🛠️ Инфра».

---

## 2026-05-03 (сессия 2) — FL без AI-питча + пиковое расписание cron

**Решение по бизнесу:** на FL.ru AI-питч уступает ручному тексту, а каждая генерация — это токены и минуты Actions. Агент на FL теперь только **отбирает** проекты (skillsWeight предфильтр + AI-скоринг), отклик пишется вручную.

**Изменения:**
- `src/config.ts` — доукомплектован `config.fl`: `maxPages`, `fetchDelay`, `hardExclude`, `skillsWeight`, `userAgents`, `generatePitch` (флаг режима)
- `src/index.ts` — ветка `source === 'fl' && !config.fl.generatePitch`: scoreOrder() → пустой pitch → notify. Полный pipeline (score + pitch×2) остаётся для Kwork / Habr / Freelance.ru
- `src/notifiers/telegram.ts` — метод `send()` роутит по источнику: `hh → sendVacancy`, `fl (без питча) → sendFlOrder`, иначе `sendFreelanceOrder`. У `sendFlOrder` одна кнопка «Пропустить», без A/B вариантов
- `.github/workflows/scan-agent.yml`:
  - `FL_GENERATE_PITCH=false`, `FL_MAX_PAGES=5` в env
  - Cron перестроен по нагрузке: пиковые часы 07-10 / 17-20 МСК — каждые 30 мин; остальное — раз в 2 часа. Экономит ~50% Actions-минут без потери новых проектов

**Нюанс схемы БД:** при пустых hook/pitch колонки в SQLite/Postgres не должны иметь NOT NULL. Сейчас не имеют — fallback `{ hook: '', pitch: '' }` пишется штатно.

---

## 2026-05-03 — Фикс FL.ru парсера (page.evaluate падал)

**Проблема:** парсер FL валился в самом начале:
```
🌐 [FL] Открываю https://www.fl.ru/projects/
❌ [FL] Ошибка: Cannot read properties of undefined (reading 'length')
```
А после первого фикса — новая ошибка:
```
❌ [FL] Ошибка: page.evaluate: ReferenceError: __name is not defined
```

**Причины и фиксы:**

1. **`new Function(\`return ${...}\`)` в `page.evaluate`** (`src/parsers/fl.ts`).
   Playwright сериализует pageFunction через `toString()`, но для функций, созданных конструктором `Function`, серилизация даёт `function anonymous() { ... }` — Playwright не всегда корректно его выполняет, и `page.evaluate` возвращал `undefined`. Дальше `page1Cards.length` → краш.
   **Решение:** заменил на обычную функцию `parseCardsInBrowser(html: string | null)` — одна функция парсит и `document` (page 1), и HTML-строку через DOMParser (page 2+). Заодно ушло ~80 строк дублирования.

2. **`__name is not defined` в браузерном контексте** (`src/parsers/browser.ts`).
   tsx/esbuild с опцией `keepNames` оборачивает именованные функции в `__name(fn, "name")` для сохранения `Function.name`. При сериализации в `page.evaluate` ссылки на `__name` уезжают в браузер, где этого хелпера нет → ReferenceError.
   **Решение:** в `createBrowser()` добавлен `context.addInitScript()` — инжектит `globalThis.__name = (fn) => fn` в каждую страницу до загрузки. Шим действует на все парсеры (FL, HH, browser-helpers).

**Нюанс на будущее:** при использовании `page.evaluate(fn)` с tsx/esbuild — либо передавать только стрелочные функции, либо держать шим `__name` в init script. Любой именованный `function` или `class` транспилируется с обёрткой.

**Решено по дизайну:** `FL_MAX_PAGES=3` оставляем — на пиковых направлениях 60 проектов/тик хватает (cron каждые 30 мин). Если в логах будут видны новые проекты на 3-й странице — поднимать до 5.

---

## 2026-04-27 (сессия 3) — Фикс GitHub Actions cache race condition

**Проблема:** `Warning: Cache save failed — Unable to reserve cache with key agent-db-<run_id>` при каждом запуске агента.

**Причина:** Двойное сохранение кеша:
- `actions/cache@v4` (шаг "Restore DB cache") — делал авто-сохранение в post-run с тем же ключом
- `actions/cache/save@v4` (шаг "Save DB cache") — ещё одно явное сохранение

Оба шага пытались записать в один ключ `agent-db-${{ github.run_id }}` → race condition с самим собой.

**Фикс:** `.github/workflows/scan-agent.yml` — `actions/cache@v4` → `actions/cache/restore@v4` в шаге "Restore DB cache". Единственная запись — явный `actions/cache/save@v4` в конце.

**Нюанс:** `actions/cache@v4` = restore + авто-save на post-run. Если рядом есть явный `cache/save@v4` с тем же ключом — всегда будет конфликт. Паттерн: `actions/cache/restore@v4` + `actions/cache/save@v4` по отдельности.

---

## 2026-04-27 (сессия 2) — Стабилизация CI/CD + HH парсер

**Что сделано:**
- `.github/workflows/deploy-dashboard.yml` — исправлен webhook-вызов: HMAC-SHA256 (`X-Hub-Signature-256`) вместо Bearer-токена. Секрет: `WEBHOOK_SECRET_SCAN_AGENT`
- `webhook/deploy-scan-agent.sh` — реальный деплой (`docker compose pull dashboard && up -d`) вместо заглушки
- `src/index.ts` — каждый `parser.fetchOrders()` обёрнут в try-catch: падение одного парсера не роняет весь агент
- `src/parsers/hh.ts`:
  - guard на пустой `HH_SEARCH_URL` (возвращает `[]` вместо `Invalid URL`)
  - `waitUntil: 'domcontentloaded'` вместо `networkidle` + timeout 30s (HH держит фоновые запросы → таймаут 60s)
- `src/index.ts` — positive keyword filter для HH: `kw.rawScore < config.hh.minKeywordScore` до AI-вызова. Снижает кол-во AI-вызовов с ~75 до ~15 на 149 вакансий

**Закрытые задачи из прошлой сессии:**
- ✅ Миграция БД на VPS применена (`employer`, `city` колонки)
- ✅ Секрет `HH_ENABLED=true` добавлен в GitHub Actions
- ✅ Dashboard деплой починен — CI/CD работает end-to-end
- ✅ `HH_SEARCH_URL` добавлен в GitHub Actions secrets

**Что осталось:**
- Рассмотреть добавление Task Management CRM или AnyWhereDesk в портфолио профиля

---

## 2026-04-27 (сессия 1) — Dashboard поддержка HH.ru + фикс HH_MAX_PAGES

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
- **fix** `src/config.ts`: `Number(process.env.HH_MAX_PAGES ?? '3')` → `||` — `??` не защищает от пустой строки

---

## 2026-04-26 — Интеграция HH.ru + обновление профиля

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
