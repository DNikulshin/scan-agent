# Внутренности агента

Карта кода для `src/` (агент, не дашборд). Открывай, когда правишь pipeline, AI, парсеры или фильтры.

## Pipeline

| Источник | Поток |
|---|---|
| Kwork / Habr | Parse → Pre-filter (no AI) → AI Score → Pitch (×2, parallel) → Notify → Save |
| FL.ru | Parse → Pre-filter → AI Score → Notify (без AI-питча, отклик пишется вручную) → Save |
| HH.ru | Parse → hardExclude (keyword) → AI Score → Notify (без питча) → Save |
| Freelance.ru | Parse → Pre-filter → AI Score → Pitch (×2) → Notify → Save |

После основного цикла — `enrichOrders(storage, 20)` обогащает `publishedAt` (см. [enrich-published-at.md](enrich-published-at.md)) и `getUnremindedOrders` для напоминаний по high-score заказам через 2+ часа.

С `KEEP_ALIVE=false` (cron) процесс выходит через 30 сек после завершения цикла.

## Ключевые модули

- **`src/index.ts`** — оркестратор: Storage + Telegram callback listener + parsers loop + reminders + enrich + exit.
- **`src/core/storage.ts`** — Prisma Postgres, дедуп по `(orderId, source)`. Все методы async.
- **`src/core/filter.ts` — `getTrashReason`** — стоп-слова, мин. цена, макс. офферы. Мусорные заказы пишутся с `status='skipped'` (см. инвариант ниже).
- **`src/core/analyzer.ts`** — OpenRouter/DeepSeek. `scoreOrder` (temp 0.3, JSON `{score, reason}`, Zod). `generatePitch` (temp 0.5/0.9, RU only, hook ≤100, pitch ≤1000). Max 2 попытки на заказ. Для HH/FL — только score, без питча.
- **`src/core/keyword-scorer.ts`** — hardExclude + positive score для HH. `kw.excluded` или `kw.rawScore < config.hh.minKeywordScore` → пропуск без AI. Конфиги: `FULLSTACK_SCORING`, `DEVOPS_SCORING`. `minKeywordScore=10` ≈ минимум 1 core keyword (TS/React/Node).
- **`src/parsers/*.ts`** — каждый реализует `Parser` interface (`fetchOrders() → Order[]`). Playwright + puppeteer-extra-stealth. FL.ru имеет `findWorkingSelector()` fallback. Debug screenshots при ошибках.
- **`src/utils/retry.ts`** — exponential backoff для OpenRouter / Telegram / Supabase.

## Конфигурация

`src/config.ts` — все env с дефолтами + CSS-селекторы парсеров (обновлять при смене вёрстки маркетплейсов). `src/profile.ts` — статический профиль разработчика для AI-питча (для динамического — см. [profile-github.md](profile-github.md)).

## Dynamic settings

`minPrice/minScore/maxOffers/stopWords` хранятся в таблице `settings`, меняются через Telegram (`/setrate`, `/setscore`, `/setstop`) или через дашборд (`GET /api/settings`). Фоллбэк = `config.filter`.

## Pre-AI vs AI vs Pitch ветки в `src/index.ts`

Три параллельные ветки выбора по `order.source`:

1. **HH**: keyword pre-filter → AI score → пишем `status='skipped'` если ниже порога; `pitch = { hook: '', pitch: '' }`.
2. **FL** (`!config.fl.generatePitch`): pre-filter → AI score → `status='skipped'` при низком; пустой питч.
3. **Остальные** (Kwork/Habr/Freelance.ru): `analyzeOrder` (score + pitch×2 параллельно).

**Инвариант:** если добавляешь новую ветку «пропустили без `enqueueNotifications`» — обязательно `status: 'skipped'` в `markProcessed`, иначе мусор всплывёт в секции «🆕 Новые» на дашборде (см. CHANGELOG 2026-05-11).

## Добавить новый маркетплейс

1. Реализовать `Parser` (`src/parsers/<name>.ts`).
2. Конфиг (URL, селекторы) в `src/config.ts`.
3. Экспорт из `src/parsers/index.ts`.
4. Добавить в массив `parsers` в `src/index.ts`.
5. Если pipeline отличается от дефолтного (без питча, особый фильтр) — отдельная ветка в основном цикле.

## HH.ru — особенности

Включается через `HH_ENABLED=true`. `offersCount=0` (HH не показывает количество откликов). `meta.employer/city` идут на дашборд. Пагинация `HH_MAX_PAGES` (def 3). `waitUntil: 'domcontentloaded'` (не `networkidle` — HH медленный).

Резюме под AI-промпт грузится через ручную заливку на `/profile` — см. [profile-hh-manual.md](profile-hh-manual.md).
