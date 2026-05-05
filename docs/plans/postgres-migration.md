# План: единая Postgres БД (Prisma) + метрики обходчика

## Context

Сейчас в проекте две БД:
- **SQLite** (`agent.db`) — локально в GitHub Actions runner, кешируется через `actions/cache` ключом `agent-db-${{ github.run_id }}`. Это эфемерный CI-кеш, не «реальная» БД.
- **PostgreSQL** на VPS — пишется агентом через `POST /api/orders` (HTTP-вызов из `src/notifiers/dashboard.ts`), читается dashboard напрямую через `pg`-пул.

Каждый заказ записывается **дважды**: в SQLite (для дедупликации между прогонами) и в Postgres через HTTP (для отображения в dashboard). Схемы расходятся (в SQLite нет `description`, `price`, `status`, `outcome`), миграции живут в двух местах (`/migrations/`, `/supabase/migration.sql`).

Метрики прогона почти не собираются: в логах только `totalNew` и `totalSent` ([src/index.ts:256-259](src/index.ts#L256-L259)). Не видно сколько отфильтровано, отклонено по AI/keyword score, сколько ошибок отправки, длительность прогона.

**Цель**: убрать SQLite, использовать единую managed Postgres БД (Prisma Postgres) через Prisma ORM из агента и dashboard, добавить таблицу метрик прогона + ежедневный rollup + страницу `/stats` в dashboard. Cron оставить как есть.

---

## Решения

1. **БД**: Prisma Postgres (https://www.prisma.io/postgres) — managed, бесплатный tier, подключение через Accelerate (HTTP-edge) или прямой `postgres://`. GitHub Actions подключается без открытия портов VPS. Local dev — через `.env` с тем же `DATABASE_URL`.
2. **ORM**: Prisma. Единая `prisma/schema.prisma` в корне репо, переиспользуется и агентом, и dashboard. Миграции через `prisma migrate`.
3. **Storage agent**: класс `Storage` ([src/core/storage.ts](src/core/storage.ts)) переписать на Prisma Client. Убрать `better-sqlite3`. Удалить шаги restore/save кеша из workflow.
4. **Dashboard**: `dashboard/lib/db.ts` (raw `pg`) → Prisma Client. API-routes (`POST /api/orders`, `GET /api/orders`, `/api/push-subscriptions`) переписать на Prisma.
5. **Метрики**: новая таблица `run_metrics` (per-run) + view `daily_metrics` (агрегация за сутки). Страница `/stats` в dashboard.
6. **Cron**: без изменений ([.github/workflows/scan-agent.yml:1-20](.github/workflows/scan-agent.yml#L1-L20)).

---

## Изменения по файлам

### Новые файлы

- **`prisma/schema.prisma`** — единая схема:
  - `Order` — то, что сейчас в Postgres `orders` (объединение полей SQLite + Postgres): `id`, `orderId`, `source`, `title`, `description`, `price`, `link`, `offersCount`, `score`, `reason`, `hook`, `pitch`, `pitchB`, `tags[]`, `employer`, `city`, `status`, `outcome`, `blacklisted`, `processedAt`, `remindedAt`, `appliedAt`, `createdAt`. Уникальный индекс `(orderId, source)`.
  - `Setting` — `key` PK, `value` String. Замена SQLite `settings`.
  - `PushSubscription` — `id`, `endpoint` unique, `p256dh`, `auth`, `createdAt`.
  - `RunMetric` — `id`, `startedAt`, `finishedAt`, `durationMs`, `parsedTotal`, `parsedBySource` (Json), `filtered`, `lowScoreAi`, `lowScoreKeyword`, `sent`, `errors` (Json: `{telegram, dashboard, supabase, push}`), `runId` (GitHub run_id, опц.).
  - View `daily_metrics`: суточный SUM по `RunMetric` + COUNT/AVG по `Order` за день.
- **`prisma/migrations/`** — генерируется `prisma migrate dev`. Первая миграция включает текущую схему orders + новые таблицы. Старый `/migrations/001_add_hh_fields.sql` и `/supabase/migration.sql` удалить после проверки.
- **`src/core/metrics.ts`** — класс `RunMetrics` со счётчиками: `incParsed(source)`, `incFiltered()`, `incLowScoreAi()`, `incLowScoreKeyword()`, `incSent()`, `incError(channel)`, `flush()` — пишет запись в `RunMetric`.
- **`dashboard/app/stats/page.tsx`** + **`dashboard/app/api/stats/route.ts`** — страница «Статистика» с графиками (последние 30 дней): отправлено/спарсено/отфильтровано, error rate, средний score. Можно использовать `recharts` (уже распространён, ~50KB).

### Изменяемые файлы

- **`src/core/storage.ts`** — переписать на `PrismaClient`. Сигнатуры публичных методов (`isProcessed`, `markProcessed`, `getStats`, `count`, `getSetting`, `setSetting`, `getOrderForReminder`, `markReminded`) сохранить — `src/index.ts` не трогаем по интерфейсу.
- **`src/notifiers/dashboard.ts`** — **удалить HTTP-нотификатор полностью**. После миграции агент пишет напрямую в общую БД через Prisma в `Storage.markProcessed()`. Dashboard читает из той же БД. Это убирает дублирование.
- **`src/index.ts`**:
  - Инициализировать `RunMetrics` в начале `main()`.
  - Прокидывать `metrics` в pipeline; на каждой ветке (filter, lowScoreAi, lowScoreKeyword, sent, ошибка) вызывать соответствующий `inc*`.
  - В `finally` — `await metrics.flush()` перед exit.
  - Убрать `dashboard` notifier из массива нотификаторов.
- **`src/config.ts`** — добавить `database.url` (env `DATABASE_URL`). Удалить опции, относящиеся к dashboard HTTP API (`DASHBOARD_URL`, `DASHBOARD_API_KEY` остаются только для push-нотификатора, если он сохранится; иначе тоже удалить).
- **`dashboard/lib/db.ts`** — заменить `pg.Pool` на singleton `PrismaClient` (паттерн с globalThis для Next.js dev).
- **`dashboard/app/api/orders/route.ts`**, **`/api/orders/pitch/route.ts`**, **`/api/push-subscriptions/route.ts`**, **`/api/vapid-public-key/route.ts`** — переписать на Prisma. `POST /api/orders` после удаления HTTP-нотификатора больше не нужен — его можно либо удалить, либо оставить как readonly-эндпоинт.
- **`dashboard/components/OrderCard.tsx`**, **`dashboard/app/page.tsx`** — типы `Order` импортировать из `@prisma/client` вместо ручного интерфейса.
- **`.github/workflows/scan-agent.yml`**:
  - Удалить шаги «Restore DB cache» (строки 28-33) и «Save DB cache» (строки 81-86).
  - Удалить env `DASHBOARD_URL`, `DASHBOARD_API_KEY` (если останется только в push-нотификаторе — оставить).
  - Добавить env `DATABASE_URL` (секрет).
  - Перед запуском агента: `npx prisma generate` (если не закоммичен `node_modules/.prisma`) и `npx prisma migrate deploy` — применить новые миграции.
  - Cron-блок не трогать.
- **`package.json`**:
  - Добавить `prisma` (dev), `@prisma/client`.
  - Удалить `better-sqlite3`, `@types/better-sqlite3`.
  - Скрипты: `"db:migrate": "prisma migrate dev"`, `"db:deploy": "prisma migrate deploy"`, `"db:studio": "prisma studio"`, `"postinstall": "prisma generate"`.
- **`dashboard/package.json`** — добавить `@prisma/client` (использует общий клиент, generate в корне). Удалить `pg`, `@types/pg`.

### Удаляемое

- `agent.db` (если в репо).
- `migrations/001_add_hh_fields.sql`, `supabase/migration.sql` (после проверки, что Prisma migrate-baseline покрыл всё).
- `src/notifiers/dashboard.ts` — заменён прямой записью.
- В CLAUDE.md обновить раздел про две БД.

---

## Метрики: модель данных

```prisma
model RunMetric {
  id              String   @id @default(uuid())
  startedAt       DateTime
  finishedAt      DateTime
  durationMs      Int
  parsedTotal     Int      @default(0)
  parsedBySource  Json     // { kwork: 12, fl: 8, hh: 30, habr: 5, freelance: 0 }
  filtered        Int      @default(0)  // отсеяно pre-AI фильтром (стоп-слова/цена/офферы)
  lowScoreAi      Int      @default(0)  // AI-score < minScore
  lowScoreKeyword Int      @default(0)  // HH keyword score < minKeywordScore
  sent            Int      @default(0)
  errors          Json     // { telegram: 0, push: 1, ... }
  runId           String?
  createdAt       DateTime @default(now())

  @@index([startedAt])
}
```

Daily rollup — SQL view (создаётся миграцией):

```sql
CREATE VIEW daily_metrics AS
SELECT
  date_trunc('day', started_at) AS day,
  COUNT(*) AS runs,
  SUM(parsed_total) AS parsed,
  SUM(filtered) AS filtered,
  SUM(low_score_ai + low_score_keyword) AS low_score,
  SUM(sent) AS sent,
  AVG(duration_ms) AS avg_duration_ms
FROM run_metrics
GROUP BY 1
ORDER BY 1 DESC;
```

Страница `/stats`:
- Таб 1 — последние 24 часа (часовой бар-чарт).
- Таб 2 — 30 дней (из `daily_metrics`).
- KPI-карточки: «отправлено сегодня», «error rate», «среднее время прогона», «AI score распределение».

---

## Порядок реализации

1. Создать Prisma Postgres проект, получить `DATABASE_URL`.
2. `npx prisma init`, описать `schema.prisma`, прогнать `prisma migrate dev` локально → проверить таблицы.
3. Перенести данные с VPS Postgres в Prisma Postgres (`pg_dump | psql`) — если хотим сохранить историю.
4. Переписать `src/core/storage.ts` на Prisma; запустить `npm run dev` локально, убедиться что pipeline работает.
5. Переписать dashboard на Prisma (`dashboard/lib/db.ts`, API-routes), `cd dashboard && npm run dev` — проверить UI.
6. Удалить `src/notifiers/dashboard.ts` и связанные env. Проверить что Storage пишет напрямую и dashboard видит свежие заказы.
7. Добавить `RunMetrics` в `src/index.ts`, прогнать локально, проверить запись в `run_metrics`.
8. Сделать страницу `/stats`.
9. Обновить workflow: убрать кеш SQLite, добавить `prisma migrate deploy` + `DATABASE_URL` в secrets. Один тестовый прогон через `workflow_dispatch`.
10. Обновить CLAUDE.md (новая архитектура, 1 БД).

---

## Верификация

- `npm run lint` (агент) и `cd dashboard && npm run lint` — type-check проходит.
- Локально `npm run dev` на агенте: лог `Цикл завершён` показывает расширенные метрики; `SELECT * FROM run_metrics ORDER BY started_at DESC LIMIT 1` через `prisma studio` — запись присутствует.
- Локально `cd dashboard && npm run dev`: `/` показывает заказы из новой БД; `/stats` рендерит графики (с моковыми данными — несколько запусков агента локально).
- В GitHub Actions: один прогон через `workflow_dispatch`, проверить что `prisma migrate deploy` применил миграции, агент отработал, в БД появилась запись `run_metrics` с `runId = github.run_id`.
- Telegram-нотификация и push приходят как раньше.
- Дедупликация работает: повторный прогон не создаёт дубликатов в `orders` (UNIQUE constraint).

---

## Риски и нюансы

- **`HTTP_PROXY` в dev-окружении**: Prisma Client использует свой механизм соединения. Если будут проблемы с прокси при `prisma migrate dev` локально — отключать `HTTP_PROXY` для prisma-команд.
- **Edge runtime**: Next.js 16 + Prisma — использовать `@prisma/client` (Node.js runtime), не Edge. API-routes должны иметь `export const runtime = 'nodejs'` если нужно явно.
- **Prisma Postgres connection limits**: на free tier обычно ограничены коннекты. В GitHub Actions короткий процесс — ок. В Next.js dashboard на VPS — singleton клиент уже решает.
- **Миграция данных**: если важно сохранить заказы с VPS Postgres — отдельный шаг `pg_dump --data-only` → `psql $PRISMA_DB_URL`. Иначе — старт с пустой БД (агент быстро наполнит).
- **Push-нотификатор** ([src/notifiers/push.ts](src/notifiers/push.ts)) сейчас читает подписки из dashboard через HTTP `GET /api/push-subscriptions`. После миграции можно либо оставить HTTP, либо подключаться к БД напрямую (упрощает, но связывает агент с БД ещё больше — оба варианта приемлемы).
