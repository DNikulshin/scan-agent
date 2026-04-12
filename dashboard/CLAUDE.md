# CLAUDE.md — Dashboard

This file provides guidance to Claude Code when working inside the `dashboard/` directory.

## Важно: Next.js 16

Это **не та Next.js, которую ты знаешь**. В версии 16 есть breaking changes — API, соглашения и структура файлов могут отличаться от обучающих данных. Перед написанием кода читай актуальную документацию в `node_modules/next/dist/docs/`. Обращай внимание на deprecation notices.

## Команды

```bash
npm run dev    # Dev server на порту 3000
npm run build  # Production build (standalone output → .next/standalone/)
npm run lint   # ESLint
```

## Стек

Next.js 16 · React 19 · Tailwind CSS 4 · TanStack React Query · PostgreSQL (`pg`)

## Структура

- `app/` — App Router страницы и API routes
- `app/api/` — серверные endpoints (orders, push-subscriptions, vapid-public-key)
- `components/` — клиентские компоненты (OrderCard, PushNotificationManager)
- `lib/db.ts` — PostgreSQL клиент
- `public/sw.js` — **статичный** Service Worker (не генерируется, коммитится в git)

## Service Worker

`public/sw.js` — статичный файл. **Не удалять, не добавлять в .gitignore.**
Обрабатывает push-уведомления, кеширует статику, даёт offline fallback.
`next-pwa` удалён — несовместим с Next.js 16.

## Push-уведомления

VAPID public key **не** используется как `NEXT_PUBLIC_*` (требует build ARG).
Вместо этого — runtime endpoint `GET /api/vapid-public-key`.
`PushNotificationManager` автоматически переподписывает при `permission=granted` + нет подписки.

## Деплой

Push в `main` с изменениями в `dashboard/` → GitHub Actions → образ в GHCR → webhook → VPS.
Ручной деплой: `docker compose pull dashboard && docker compose up -d dashboard` на VPS.

Подробнее — в корневом [CLAUDE.md](../CLAUDE.md).
