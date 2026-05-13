# Dashboard — карта подсистемы

Карта `dashboard/`. Для конкретных подсистем — отдельные docs: [notifications-outbox.md](notifications-outbox.md), [metrics-block1.md](metrics-block1.md), [profile-hh-manual.md](profile-hh-manual.md).

## Стек

Next.js 16 App Router · React 19 · Tailwind 4 · TanStack Query · Prisma Postgres.

**⚠️ Next.js 16** — много breaking changes относительно 14/15. Читать `node_modules/next/dist/docs/` до правок фронта.

`@prisma/client` резолвится из корневого `node_modules` (монорепо-нюанс — см. [notifications-outbox.md](notifications-outbox.md)).

## Service Worker (PWA + Push)

`dashboard/public/sw.js` — **статичный**, коммитится в git, не генерируется при сборке (`@ducanh2912/next-pwa` несовместим с Next.js 16, удалён). `Cache-Control: no-store` на `/sw.js` в `next.config.ts`.

## Push Subscriptions

- VAPID public key через `GET /api/vapid-public-key` (runtime), **не** через `NEXT_PUBLIC_*` (build-time хрупко в standalone Docker).
- `PushNotificationManager` авто-переподписывает при `permission=granted` + нет подписки.
- Подписки на 410/404/403 авто-удаляются worker'ом ([dashboard/lib/notifications/channels/push.ts](../dashboard/lib/notifications/channels/push.ts)).

## API Routes

| Маршрут | Назначение |
|---|---|
| `GET/POST/DELETE /api/push-subscriptions` | GET/DELETE требуют `DASHBOARD_API_KEY` |
| `GET /api/vapid-public-key` | Runtime ключ для подписки |
| `GET/POST /api/orders` | Список / создание |
| `POST /api/orders/pitch` | Выбрать вариант B питча |
| `GET /api/orders/export` | MD-выгрузка отфильтрованного списка (поле «Опубликован» если есть `publishedAt`) |
| `GET /api/orders/stream` | SSE (требует `DATABASE_URL_DIRECT`, не pooled) |
| `GET /api/settings` | `minScore/minPrice/maxOffers`; источник — таблица `settings`, фоллбэк = `src/config.ts:filter` |
| `POST /api/profile/refresh` | GitHub-снимок |
| `POST /api/profile/hh` | Ручная заливка HH-резюме |
| `GET /api/profile/export` | MD профиля |
| `GET/POST /api/metrics/*` | См. [metrics-block1.md](metrics-block1.md) |

## OrderCard

[`dashboard/components/OrderCard.tsx`](../dashboard/components/OrderCard.tsx) показывает оба варианта питча с copy-on-tap. Дата:
- если `published_at` есть — `📅 опубл. <дата>` (см. [enrich-published-at.md](enrich-published-at.md))
- иначе fallback на `created_at` без префикса

## Фильтр главной страницы

Дефолт `minScore = 0` («Любой балл»), мусор отсекается на бэке через `status='skipped'` в `markProcessed` (см. CHANGELOG 2026-05-11). `/api/settings` используется только на `/stats` и Telegram-ботом.
