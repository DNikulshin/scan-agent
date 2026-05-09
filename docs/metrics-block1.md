# Блок 1 — метрики прогона + `/stats` + MD-экспорт (2026-05-08)

Воронка (parsed → filtered → AI-scored → enqueued → applied → won/lost), AI tokens/cost, гистограмма score'ов и история прогонов пишутся в `RunMetric` каждым запуском агента. Доступны на `/stats` (KPI + recharts) и как скачиваемый MD-отчёт.

## Карта кода

- Backend: [src/types.ts](../src/types.ts) (`AiUsage`); [src/core/analyzer.ts](../src/core/analyzer.ts) — `callOpenRouter` отдаёт `{text, usage}`, `fetchGenerationCost(id)` через `GET /api/v1/generation`; `scoreOrder/generatePitch/analyzeOrder` возвращают usage. [src/core/metrics.ts](../src/core/metrics.ts) — класс `RunMetrics` (counters + `flush`), runId через `randomUUID`. [src/index.ts](../src/index.ts) инструментирован, `metrics.flush()` в `finally` перед exit.
- Dashboard: [dashboard/lib/stats.ts](../dashboard/lib/stats.ts) — единый `getStats()` для page и MD-экспорта. [dashboard/app/stats/page.tsx](../dashboard/app/stats/page.tsx) (Server Component, `dynamic='force-dynamic'`) + [dashboard/app/stats/StatsCharts.tsx](../dashboard/app/stats/StatsCharts.tsx) (recharts). [dashboard/app/api/metrics/export/route.ts](../dashboard/app/api/metrics/export/route.ts) — `text/markdown` отчёт. Линк «📊 Статистика» в [dashboard/app/page.tsx](../dashboard/app/page.tsx).
- Зависимости: `recharts^3.8.1` в [dashboard/package.json](../dashboard/package.json).

## Решения

- "sent" в `RunMetric` после миграции на outbox **= enqueued**. Реальная доставка (telegram/push) считается отдельно в [`/api/health/notifications`](../dashboard/app/api/health/notifications/route.ts).
- AI-cost — best-effort: `GET /api/v1/generation?id={id}` через `withRetry({maxAttempts: 2})`; на 404/timeout → 0, не ломает pipeline.
- Score histogram — статичные buckets `["0-2", "3-4", "5-6", "7-8", "9-10"]`.

## Утилита

[scripts/mobile-shot.mjs](../scripts/mobile-shot.mjs) — playwright-снимок страницы в iPhone-вьюпорте. Запуск из code-server-контейнера через docker-network к `http://dashboard:3000` (минуя Caddy/Authelia).
