# ScanAgent Dashboard

Next.js 16 PWA — интерфейс для просмотра заказов с фриланс-бирж, найденных агентом.

## Что умеет

- Просмотр заказов с оценкой AI (0–10) и двумя вариантами отклика
- Фильтрация по бирже, минимальному score, тегам технологий, статусу
- Копирование отклика одним тапом
- Отметка результата (откликнулся / пропустил) и статистика Win Rate
- Push-уведомления в браузере о новых заказах
- Offline-режим (PWA, Service Worker)

## Локальный запуск

```bash
npm install
npm run dev   # http://localhost:3000
```

Нужен PostgreSQL. Строку подключения задай в `.env.local`:
```
DATABASE_URL=postgresql://scan:pass@localhost:5432/scan_agent
VAPID_PRIVATE_KEY=...
NEXT_PUBLIC_VAPID_PUBLIC_KEY=...
DASHBOARD_API_KEY=...
```

Схема БД: `../supabase/migration.sql`

## Деплой

Автоматически через GitHub Actions при пуше в `main` (папка `dashboard/`):
```
git push → GitHub Actions (build) → GHCR → webhook → VPS docker pull
```

Ручной деплой на VPS:
```bash
cd /opt/home-codespaces
docker compose pull dashboard
docker compose up -d dashboard
```

