# Лог изменений — scan-agent

Хронологический список значимых изменений. Свежие — сверху.

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
