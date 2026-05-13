# ScanAgent

AI-агент для мониторинга фриланс-бирж и вакансий: парсит Kwork, FL.ru, Freelance.ru, Habr Freelance, HH.ru → AI-скоринг → генерирует 2 варианта отклика → Telegram + PWA-дашборд.

Запускается по cron в GitHub Actions, без собственного сервера для агента. Данные — PostgreSQL на VPS (`db.nikulshin-dev.online`).

## Содержание

- [Стек](#стек)
- [Запуск](#запуск)
- [GitHub Actions](#github-actions)
- [Документация](#документация)

## Стек

- TypeScript (Node.js 20), Playwright + puppeteer-extra-stealth для парсинга
- OpenRouter (DeepSeek) для AI-скоринга и питча
- PostgreSQL через Prisma, единая БД для агента и дашборда
- Next.js 16 + React 19 + Tailwind 4 — дашборд (PWA, push, SSE)
- Telegram Bot API, Web Push
- Pino, Zod, axios

## Запуск

### Backend (агент)

```bash
npm install
npx playwright install chromium --with-deps
cp .env.example .env  # заполнить — см. docs/environment.md
npm run dev           # tsx + pretty-логи
```

### Dashboard

```bash
cd dashboard
npm install
npm run dev           # :3000
```

### Команды

| | Команда |
|---|---|
| Lint (root, tsc) | `npm run lint` |
| Build агента | `npm run build` |
| Прод-запуск агента | `npm start` |
| Тест push | `npm run test-push` |
| Lint dashboard (eslint) | `cd dashboard && npm run lint` |
| Build dashboard | `cd dashboard && npm run build` |

## GitHub Actions

Workflow `.github/workflows/scan-agent.yml` запускает агента по cron (пиковые часы — каждые 30 мин, иначе раз в 2 часа). Ручной запуск через **Actions → ScanAgent → Run workflow**.

Workflow `.github/workflows/deploy-dashboard.yml` собирает образ дашборда в GHCR и дёргает webhook на VPS при пуше в `main` с изменениями в `dashboard/`.

Все секреты — в **Settings → Secrets and variables → Actions**. Список переменных — [docs/environment.md](docs/environment.md).

## Документация

`CLAUDE.md` — тонкий индекс для AI-коллаборации. Детальные карты подсистем — в `docs/`:

- [docs/agent-internals.md](docs/agent-internals.md) — pipeline, AI, парсеры, фильтры
- [docs/dashboard-overview.md](docs/dashboard-overview.md) — Next.js, API, OrderCard, Push, SW
- [docs/environment.md](docs/environment.md) — все env-переменные
- [docs/enrich-published-at.md](docs/enrich-published-at.md) — обогащение датами публикации
- [docs/notifications-outbox.md](docs/notifications-outbox.md) — outbox + worker + SSE
- [docs/metrics-block1.md](docs/metrics-block1.md) — метрики прогона + `/stats` + MD-экспорт
- [docs/profile-github.md](docs/profile-github.md) / [profile-extension.md](docs/profile-extension.md) / [profile-hh-manual.md](docs/profile-hh-manual.md) — динамические профили
- [docs/DEPLOY.md](docs/DEPLOY.md) — VPS, CI/CD, webhook
- [docs/CHANGELOG.md](docs/CHANGELOG.md) — история изменений
