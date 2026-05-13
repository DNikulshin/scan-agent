# Environment Variables

Все секреты и URL'ы окружения. Лежат в `/opt/home-codespaces/.env` на VPS (Dashboard через `docker-compose.yml`) или в GHA secrets/vars (агент в Actions).

## Backend (агент)

| Переменная | Источник | Назначение |
|---|---|---|
| `OPENROUTER_API_KEY` | GHA secret | OpenRouter / DeepSeek |
| `TELEGRAM_BOT_TOKEN` | GHA secret | Telegram-бот |
| `TELEGRAM_CHAT_ID` | GHA secret | Куда слать уведомления |
| `DATABASE_URL` | GHA secret | Внешняя строка к `postgres-provision` (открыта только для IP GHA) |
| `HH_ENABLED` / `HH_SEARCH_URL` / `HH_MAX_PAGES` (def 3) / `HH_MIN_KEYWORD_SCORE` (def 10) | GHA secret | HH-парсер |
| `FL_ENABLED` / `FL_SEARCH_URL` / `FL_MAX_PAGES` (def 5) / `FL_ONLY_FREE_RESPONSES` / `FL_GENERATE_PITCH` | GHA secret | FL.ru-парсер |
| `FREELANCERU_ENABLED` / `FREELANCERU_SEARCH_URL` | GHA secret | Freelance.ru-парсер |
| `HABR_ENABLED` / `HABR_SEARCH_URL` | GHA secret | Habr-парсер |
| `KWORK_SEARCH_URL` | GHA secret | Kwork-парсер |
| `KWORK_ENRICH_TTL_HOURS` (def 48) | env | TTL для эвристики publishedAt в enrich-воркере |
| `GH_PROFILE_LOGIN` | GHA `vars` | GitHub-снимок профиля. Префикс `GH_`, а не `GITHUB_`, т.к. GHA блокирует пользовательские vars/secrets с `GITHUB_*` |
| `GH_PROFILE_TOKEN` | GHA `secrets.GITHUB_TOKEN` | 5000 req/час, public_repo scope из коробки |
| `FL_PROFILE_URL` / `KWORK_PROFILE_URL` / `FREELANCERU_PROFILE_URL` | GHA `vars` | Профили фрилансеров (см. [profile-extension.md](profile-extension.md)) |

## Dashboard

В `/opt/home-codespaces/docker-compose.yml`:

| Переменная | Назначение |
|---|---|
| `DATABASE_URL` (= `DASHBOARD_DATABASE_URL`) | Internal URL к `postgres-provision` (pooled) |
| `DATABASE_URL_DIRECT` (= `DASHBOARD_DATABASE_URL_DIRECT`) | Non-pooled URL для `/api/orders/stream` SSE. Prisma Postgres / pgBouncer ломает LISTEN/NOTIFY, нужна постоянная сессия. Если не задан — fallback на `DATABASE_URL` |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` | Подпись push-payload, отдаются через `GET /api/vapid-public-key` для клиента |
| `DASHBOARD_API_KEY` | Bearer для приватных API-роутов |
| `TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_ID` | Для notifications worker'а (доставка) |
| `VAPID_SUBJECT` (def `mailto:admin@example.com`) | Push payload subject |
| `NOTIFICATIONS_POLL_INTERVAL_MS` (def 5000) | Период опроса outbox |
| `NOTIFICATIONS_BATCH_LIMIT` (def 20) | Размер батча |
| `NOTIFICATIONS_DISPATCHER_DISABLED=true` | Kill-switch для worker'а (см. [notifications-outbox.md](notifications-outbox.md)) |

## Где править

- **GHA secrets / vars** — через web-UI `Settings → Secrets and variables → Actions` в репозитории `DNikulshin/scan-agent`.
- **VPS env** — `/opt/home-codespaces/.env` (для Dashboard, провижионера, бэкапа). После правки — `docker compose up -d <service>` чтобы перечитать.

Никогда не коммитить `.env` файлы.
