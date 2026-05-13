# Enrich-воркер дат публикации (`publishedAt`)

Карта подсистемы. Открывай, когда правишь `src/enrich/`, поле `Order.publishedAt`, или отображение дат публикации на дашборде/в MD-экспорте.

## Зачем

Парсеры карточек обычно отдают только дату появления заказа у нас (`createdAt = processedAt`). Реальная дата публикации на бирже либо есть только на странице заказа (HH, FL, Freelance.ru), либо вычисляется (Kwork). Без неё нельзя отвечать на «насколько свежий заказ» и сортировать по фактической свежести.

## Поток

1. Главный цикл (`src/index.ts`) после `metrics.flush()` вызывает `enrichOrders(storage, 20)` под `try/catch` — ошибки воркера не валят cron-прогон.
2. `Storage.getOrdersWithoutPublishedAt(20)` ([src/core/storage.ts](../src/core/storage.ts)): берёт до 20 заказов с `publishedAt = null` за последние 7 дней + `status: 'new'` + `blacklisted: false`. Сортировка `processedAt desc`.
   - **Почему 7-дневное окно**: без него заказы, для которых дата так и не вытаскивается (404, изменилась вёрстка), залипают в выборке навсегда и блокируют enrich остальных.
3. `enrichOrders` поднимает один Playwright-контекст на все 4 биржи (`createBrowser()`), идёт по списку с 2-сек паузой между запросами (anti-ban).
4. Для каждого источника свой `fetch*PublishedDate`:
   - **HH** — `<script type="application/ld+json">`, фильтр по `@type === 'JobPosting'`, поле `datePosted`.
   - **FL** — `.fl-project-content` textContent, regex `Опубликован DD.MM.YYYY в HH:MM`.
   - **Freelance.ru** — таблица `td:"Дата публикации:"` + соседняя ячейка. Большинство Freelance.ru-заказов уже имеют `publishedAt` из карточки списка (см. `FreelanceruParser` — `time.timeago[datetime]`), поэтому до enrich-воркера доходят редко.
   - **Kwork** — см. ниже.
5. При успехе — `Storage.setPublishedAt(id, date)` (update по PK). При неудаче — `logger.warn` с причиной, переход к следующему.

## Kwork: TTL-эвристика

Проверено 2026-05-13: Kwork **не отдаёт** явный timestamp публикации:
- В JSON-LD только `Organization` и `Product` без `datePublished` / `dateCreated`.
- Нет `<time>` тегов.
- Нет `og:*` / `itemprop=datePublished` meta-тегов.
- Нет data-* атрибутов с timestamp.

Единственный сигнал — счётчик «Осталось» в `.want-card__informers-row span`. Считаем:

```
published ≈ now - (TTL - remaining)
```

TTL настраивается через `KWORK_ENRICH_TTL_HOURS` (дефолт **48ч** — типичное наблюдение `1 д. 23 ч.` ≈ 47ч остатка). Это эвристика — реальный TTL зависит от выбора заказчика (1–7 дней) и Kwork иногда продлевает заявки. Расхождение с реальной датой может быть в пределах суток.

**Поддерживаемые форматы счётчика:**
- `Осталось: 1 д. 23 ч.` (когда > 24ч)
- `Осталось: 5 ч. 12 мин.` (когда < 24ч)

Если ни один не матчит — `logger.warn({ remainText })` и `null`. Это сигнал, что Kwork сменил вёрстку.

## Валидация Date в `markProcessed`

Парсеры могут пробросить `publishedAt` через `Order.meta` (например, FreelanceruParser из карточки списка). [`Storage.markProcessed`](../src/core/storage.ts) валидирует строку через `Number.isNaN(new Date(raw).getTime())` — кривая дата логируется `warn` и игнорируется, заказ всё равно записывается. Без валидации одна кривая ISO-строка валила бы upsert и заказ зацикливался в pipeline.

## Схема БД

`Order.publishedAt` — `DateTime? @db.Timestamptz(6)` (миграция `20260513120000_add_published_at`). Тип `timestamptz` сознательно: HH/FL отдают даты с timezone (`+00:00`/`+03:00`), при `TIMESTAMP(3)` без tz они приводились бы к локальному времени сервера.

Остальные datetime-колонки `orders` остаются `timestamp(3) without time zone` (Prisma default) — менять их = риск конвертации через session timezone.

## Отображение

- **Dashboard `OrderCard`** ([dashboard/components/OrderCard.tsx](../dashboard/components/OrderCard.tsx)): если `published_at` есть — `📅 опубл. <дата>`, иначе fallback на `created_at` без префикса.
- **MD-экспорт** ([dashboard/app/api/orders/export/route.ts](../dashboard/app/api/orders/export/route.ts)): поле `**Опубликован:**` при наличии `publishedAt`, иначе `**Дата:**` (= `createdAt`).
- **Telegram** — пока не обновлён (в очереди).

## Конфигурация

| Env | Дефолт | Где |
|---|---|---|
| `KWORK_ENRICH_TTL_HOURS` | `48` | [src/config.ts](../src/config.ts) → `config.kwork.enrichTtlHours` |

Лимит на batch (20 заказов за прогон) задаётся вызовом `enrichOrders(storage, 20)` в [src/index.ts](../src/index.ts). Раз в час cron, 30 мин в пиковые часы — итого 100–250 enrich/сутки, чего хватает на типичный поток.

## Известные ограничения

- **Kwork точность** — ±сутки из-за неизвестного TTL. Если Kwork введёт `meta[itemprop=datePublished]` — переписать на чтение прямого timestamp.
- **enrich-воркер ≠ метрики** — ошибки и счётчики enrich не пишутся в `RunMetric`. Если станет важно — добавить `enrich_attempts/success/failed` в метрики, либо отдельный workflow.
- **Старые заказы (>7 дней без даты)** — забываем, дата так и не появится. Историю это не ломает: для аналитики используется `createdAt`.

## История

- **2026-05-13** — первая итерация (`f438a0e`) + ревью-фиксы (`c9a27df`, `5b651d8`): миграция `published_at` (Timestamptz(6)), исправлен Kwork regex (формат `N д. M ч.`), TTL в конфиге, валидация Date, фильтр backlog по cutoff/status/blacklisted, типизация `Page`, JSON-LD HH фильтр по `@type`.
