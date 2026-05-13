# CLAUDE.md — scan-agent

Этот файл — тонкий индекс. Детали — в `docs/`, открывай по теме.

## 🔗 Глобальный контекст

Роль, стиль, система памяти — `~/.claude/CLAUDE.md` (загружается автоматически).
**Приоритет:** глобальный → этот файл → `docs/*` по теме → RAG (`codebase-rag` MCP).

## 📦 Что это

AI-агент скрапит фриланс-биржи (Kwork, FL.ru, Freelance.ru, Habr Freelance) и вакансии с HH.ru, оценивает проекты LLM (0–10), генерирует 2 варианта питча и шлёт уведомления в Telegram + Next.js dashboard. Запускается cron'ом GitHub Actions.

## 📚 Карты подсистем

Открывай только нужную тему — не держи в контексте по дефолту.

| Подсистема | Файл | Когда читать |
|---|---|---|
| Внутренности агента (pipeline, AI, парсеры, фильтры) | [docs/agent-internals.md](docs/agent-internals.md) | правки в `src/index.ts`, `src/core/*`, `src/parsers/*` |
| Dashboard (Next.js, OrderCard, API, Push, SW) | [docs/dashboard-overview.md](docs/dashboard-overview.md) | правки фронта, API-роутов, push-уведомлений |
| Переменные окружения | [docs/environment.md](docs/environment.md) | новые env, поиск где переменная задаётся |
| Enrich-воркер `publishedAt` | [docs/enrich-published-at.md](docs/enrich-published-at.md) | `src/enrich/`, дата публикации в UI/MD |
| Доставка уведомлений (outbox + worker + SSE) | [docs/notifications-outbox.md](docs/notifications-outbox.md) | `dashboard/lib/notifications/`, `src/core/notifications.ts`, SSE |
| Метрики прогона + `/stats` + MD-экспорт | [docs/metrics-block1.md](docs/metrics-block1.md) | `RunMetric`, `dashboard/app/stats/`, `/api/metrics/export` |
| Динамический профиль из GitHub | [docs/profile-github.md](docs/profile-github.md) | `src/core/github-profile.ts`, GH-снимок, `/profile` GitHub-секция |
| Парсеры FL/Kwork/Freelance.ru профилей | [docs/profile-extension.md](docs/profile-extension.md) | `src/core/profile/{fl,kwork,freelanceru}.ts`, `refreshAllProfiles` |
| HH-резюме ручной заливкой | [docs/profile-hh-manual.md](docs/profile-hh-manual.md) | `dashboard/app/api/profile/hh/`, `HhUploadForm` |
| План миграции БД | [docs/plans/postgres-migration.md](docs/plans/postgres-migration.md) | работа со схемой, Prisma, миграциями |
| Деплой / CI/CD / VPS | [docs/DEPLOY.md](docs/DEPLOY.md) | `docker-compose.yml`, GHA workflow, webhook, VPS-стек |
| Dev-сабдомены через Caddy | [docs/dev-subdomains.md](docs/dev-subdomains.md) | проброс dev-портов наружу через Authelia |
| История изменений | [docs/CHANGELOG.md](docs/CHANGELOG.md) | поиск исторического контекста по дате/коммиту |

## 🛠 Команды

### Backend (root)
```bash
npm run dev       # tsx, PRETTY_LOGS=true
npm run build     # → dist/
npm start         # dist/index.js
npm run lint      # tsc --noEmit
npm run test-push # тест push-уведомлений
```

### Dashboard (Next.js 16)
```bash
cd dashboard
npm run dev    # :3000
npm run build  # standalone build
npm run lint   # eslint
```

## 🚀 Деплой

Push в `main` с изменениями в `dashboard/` → GHA workflow `Deploy Dashboard` → образ в GHCR → webhook → VPS. Агент — `ScanAgent` workflow по cron. Детали — [docs/DEPLOY.md](docs/DEPLOY.md).

## 📜 История

Все значимые изменения — [docs/CHANGELOG.md](docs/CHANGELOG.md).
