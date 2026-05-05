# Деплой и инфраструктура — scan-agent

## VPS-стек

Проект запущен в Docker на `/opt/home-codespaces/`. Состав:
- `caddy` — reverse proxy (80/443), домен `scan.nikulshin-dev.online`
- `dashboard` — Next.js 16, образ из GHCR (`ghcr.io/dnikulshin/scan-agent/dashboard:latest`)
- `postgres-scan` — PostgreSQL 16
- `webhook` — приём деплой-хуков, порт 9000 → `webhook.nikulshin-dev.online`

## CI/CD: GitHub Actions → GHCR → VPS

Любой `git push` с изменениями в `dashboard/` запускает `.github/workflows/deploy-dashboard.yml`:
1. Сборка Docker-образа на GitHub (бесплатно, с GHA-кешем слоёв)
2. Push в `ghcr.io/dnikulshin/scan-agent/dashboard:latest`
3. Вызов webhook → VPS делает `docker compose pull dashboard && docker compose up -d dashboard`

**Ручной деплой** (если CI не нужен):
```bash
cd /opt/home-codespaces
docker compose pull dashboard
docker compose up -d dashboard
```

## GitHub Actions Workflows

| Workflow | Триггер | Что делает |
|---|---|---|
| `scan-agent.yml` | cron каждые 30 мин в пик / каждые 2ч внепик | Запускает агента: парсинг → AI → уведомления |
| `deploy-dashboard.yml` | push в `dashboard/` | Сборка → GHCR → деплой на VPS |

## Важные нюансы инфраструктуры

- `adnanh/webhook` **не раскрывает** `${VAR}` в `hooks.json` самостоятельно. В docker-compose используется `envsubst` при запуске: `envsubst < hooks.json > /tmp/hooks.json`
- `NEXT_PUBLIC_VAPID_PUBLIC_KEY` передаётся в dashboard как runtime env (не build ARG) — ключ берётся через `/api/vapid-public-key`
- Очистка build cache (делать раз в неделю): `docker builder prune -f`

## Локальная разработка (dev-окружение)

- В dev-окружении установлен `HTTP_PROXY=http://172.18.0.1:8118`. Axios автоматически проксирует через него все исходящие запросы — прокси ломает заголовки и OpenRouter отвечает 400 `"Invalid header received from client."`. Все axios-вызовы к внешним API должны иметь `proxy: false`. В GitHub Actions прокси нет, флаг безопасен в обоих окружениях.
- При локальном `npm run dev` Telegram polling конфликтует с инстансом бота на VPS — ошибки `409 Conflict: terminated by other getUpdates request` в логах нормальны и не мешают работе агента.
