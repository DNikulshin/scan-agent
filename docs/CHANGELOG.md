# Лог изменений — scan-agent

Хронологический список значимых изменений. Свежие — сверху.

---

## 2026-05-09 (вечер) — Скрыть HH-мусор на главной + MD-экспорт заказов

Долго раздражало: dashboard показывал в секции «🆕 Новые» HH-вакансии со score=0 (Аналитик 1С, Lua программист и т.п.). В Telegram они корректно не уходили — pre-filter в [src/index.ts](../src/index.ts) ловит их через `hardExclude`/`minKeywordScore` и помечает `score: 0` без `enqueueNotifications`. Но `markProcessed` пишет их в БД для дедупа со `status: 'new'`, и фронт по дефолту с фильтром «Любой балл» рисовал их вместе с настоящими «Новыми». Теперь:

**Что добавили:**
- `GET /api/settings` ([dashboard/app/api/settings/route.ts](../dashboard/app/api/settings/route.ts)) — отдаёт `{minScore, minPrice, maxOffers}` из таблицы `settings`. Фоллбэки 7/1000/10 продублированы из [src/config.ts:filter](../src/config.ts) — синхронизировать вручную при смене.
- На [/](../dashboard/app/page.tsx) добавлен `useQuery(['settings'])`. Дефолт фильтра `minScore` теперь = `settings.minScore` (7), а не «Любой балл». Селект отражает effective-значение; параметр в URL побеждает дефолт. Чтобы посмотреть отсев — выбрать «Любой балл» (URL `?minScore=0`).
- `GET /api/orders/export` ([dashboard/app/api/orders/export/route.ts](../dashboard/app/api/orders/export/route.ts)) — MD-выгрузка отфильтрованных заказов. Те же query params, что у `/api/orders` (+ `tag`). `take: 1000`. Группировка по `status` (Новые/Откликнулся/Пропущены), формат карточки 1-в-1 как в чате с пользователем (заголовок + ссылка `[host](link)` + источник + цена + дата `Intl.DateTimeFormat('ru-RU')` + score + статус). Заголовки `Content-Disposition: attachment; filename="orders-YYYY-MM-DD.md"` (паттерн как в `/api/metrics/export`).
- Кнопка «📄 Сохранить в MD» в header главной — рядом с «👤 Профиль» / «📊 Статистика». При сборке href подкладывает effective `minScore`, если в URL его нет, плюс `activeTag`.

**Не трогали:**
- HH-фильтрация в [src/core/keyword-scorer.ts](../src/core/keyword-scorer.ts) и [src/index.ts](../src/index.ts) — она работает корректно (мусор не уходит в Telegram). Изменения чисто на стороне dashboard.
- БД-схему — никаких миграций.

**Проверено:**
- `cd dashboard && npm run lint && npm run build` — зелёные. Новые роуты `/api/settings` и `/api/orders/export` появились в карте маршрутов.
- UI в браузере не прогонял (CLI-сессия) — глазами проверить после деплоя: дефолт ≥7 на `/`, переключение на «Любой балл» открывает мусор, кнопка скачивает корректный MD.

**Решения:**
- Дефолт `minScore` поднят до `settings.minScore`, а не убран score=0 на сервере — чтобы поведение фильтра «Любой балл» оставалось буквальным (любой балл = действительно любой). Юзер знает, что при «Любой балл» увидит мусор для аудита и пополнения `hardExclude`.
- Дефолты в `/api/settings` захардкожены копией из `config.ts`, а не вынесены в shared module — одна константа, не оправдывает абстракции. Документировано в комментарии файла.
- `take: 1000` в экспорте — потолок при `cleanup(30)` в storage; больше не наберётся без задержки очистки.

---

## 2026-05-09 (поздняя ночь) — HH-резюме через ручную заливку на /profile

Закрыли «⏳ Открытый трек: HH-резюме под авторизованной сессией». Автопарсинг HH отказался работать под Cloudflare Lux SPA: страница рендерится из `template#HH-Lux-InitialState` (220KB JSON), DOM содержит `data-qa="skill-tag-<numericId>"` (нестабильно к редизайнам). Headful-storageState-вариант собрался частично (см. ниже), но «парсить нестабильный JSON ради ручной заливки раз в полгода» — overkill, поэтому переехали на простую textarea на `/profile`.

**Что добавили:**
- POST [dashboard/app/api/profile/hh/route.ts](../dashboard/app/api/profile/hh/route.ts) — JSON `{text}`, Bearer `DASHBOARD_API_KEY`, лимит 256K. Кладёт в `ProfileSnapshot(source='hh').payload.rawText`.
- UI [dashboard/app/profile/HhUploadForm.tsx](../dashboard/app/profile/HhUploadForm.tsx) — textarea (10 строк, monospace, счётчик символов) + prompt `DASHBOARD_API_KEY` на сабмите. Встроена в [dashboard/app/profile/page.tsx](../dashboard/app/profile/page.tsx) над `HhSection`.
- Тип `HhResumePayload` в [src/core/profile/types.ts](../src/core/profile/types.ts) + mirror в [dashboard/lib/profile-types.ts](../dashboard/lib/profile-types.ts) — `rawText?: string` (новое поле приоритетное); legacy-поля стали опциональными.
- AI-промпт: [src/core/profile-context.ts](../src/core/profile-context.ts) `loadHhExperience()` сначала пробует `rawText` (через `summarizeRawText` в [src/core/profile/hh.ts](../src/core/profile/hh.ts)), fallback на legacy `experience[]`. `getCachedExperienceContext()` контракт без изменений — analyzer ничего не заметит.
- HhSection ([dashboard/app/profile/page.tsx](../dashboard/app/profile/page.tsx)) рендерит `<pre>` с `rawText` если задан; маркер «ручная заливка» вместо ссылки если `payload.url === 'manual'`. `renderHhSection` ([dashboard/lib/profile.ts](../dashboard/lib/profile.ts)) льёт `rawText` в fenced ` ``` `-block в MD-экспорт.

**Что убрали (cleanup промежуточной storageState-итерации):**
- Файл `scripts/hh-login.ts` (CLI manual login через headful chromium) — не понадобился.
- `storageStatePath` опцию из `createBrowser` ([src/parsers/browser.ts](../src/parsers/browser.ts)) и `withStealthPage` ([src/core/profile/browser.ts](../src/core/profile/browser.ts)) — все профильные парсеры снова без сессии.
- `fetchHhResume()` целиком из [src/core/profile/hh.ts](../src/core/profile/hh.ts) (остался только `summarizeHhExperience` + новая `summarizeRawText`).
- Env'ы `HH_PLAYWRIGHT_STORAGE_STATE` / `HH_RESUME_PUBLIC_URL`, поля `hhResumeUrl`/`hhStorageStatePath` из `config.profile` ([src/config.ts](../src/config.ts)).
- HH-job из `refreshAllProfiles` ([src/core/profile/index.ts](../src/core/profile/index.ts)) и шаг `Materialize HH storage state` из [.github/workflows/scan-agent.yml](../.github/workflows/scan-agent.yml).
- HH-блок из [scripts/smoke-profile.ts](../scripts/smoke-profile.ts).

**End-to-end проверено локально (dashboard dev + Prisma Postgres prod, тест-снимок удалён):**
- POST без auth → 401, неправильный Bearer → 401, пустой text → 400, не-string → 400.
- POST 200 с реальным текстом → запись в `profile_snapshots` создана.
- `/profile` рендерит секцию + `<pre>` + маркер «ручная заливка».
- `/api/profile/export` MD — `## HH.ru — резюме · ручная заливка` + fenced block.
- `loadProfileContext()` → `getCachedExperienceContext()` возвращает rawText (536/800 символов).
- Lint root + dashboard + tsc — все зелёные. Smoke FL/Kwork/Freelance.ru без регрессий.

**Дальше на проде:**
1. Открыть `/profile` (за Authelia), вставить текст резюме в textarea, ввести `DASHBOARD_API_KEY`.
2. Перезагрузить — увидеть `<pre>` с текстом + маркер «Снимок: <время> · ручная заливка».
3. На следующем cron'е агент подхватит rawText в AI-промпт автоматически.
4. Обновлять снимок раз в N месяцев — заливка перезаписывает прошлый, housekeeping чистит >90д.

**Решения:**
- Plain text через textarea > PDF/DOCX/файл — пользователь сам формирует выжимку, никаких новых dep'ов в dashboard.
- Без zod — `{text:string}` валидируется руками, паттерн как у `/api/orders/pitch`.
- Без структурированной формы (`experience[]` repeater) — overkill для заливки раз в полгода.
- `url: 'manual'` — маркер ручного снимка для UI/MD-экспорта.

---

## 2026-05-09 (ночь) — Селекторы FL/Kwork/Freelance.ru закрыты по spec'у пользователя

Spec из `test.md` верифицирован живым smoke (`scripts/smoke-profile.ts`) на профилях `dnikulshin*`. Парсеры теперь возвращают валидные данные. HH вынесен в отдельный трек.

**Что сделано (commits `0ce59b3` + `c5fa64e`, plan `~/.claude/plans/swift-wobbling-wave.md`):**
- **Kwork** [src/core/profile/kwork.ts](../src/core/profile/kwork.ts) — переход на `window.stateData` через `page.evaluate`. Маппинг: `userRating`/`totalReviewsCount`/`userProfileName`/`userProfileProfession`/`userProfileDescription` (с decode HTML entities `&laquo;`→«, `&mdash;`→— и т.п.)/`userSkills[]`/`userProfileBadges[]`/`lastOnlineAsString`. DOM-fallback на `h1.user-username`/`.user-profession`/`.user-skills__item`. **Контракт payload обновлён**: `KworkProfilePayload` без `gigs`, новые поля синхронно в `dashboard/lib/profile-types.ts` + `renderKworkSection` (MD + UI).
- **FL** [src/core/profile/fl.ts](../src/core/profile/fl.ts) — двухпроходный fetch: `/rating/` через `div.rating p.b-text__bold` (общий рейтинг), `/portfolio/` через узкий `.b-portfolio__item` + `.user-categories a`. Шумные `[class*="..."]` fallback'и убраны. Login извлекается из URL regex'ом — нормализация базы.
- **Freelance.ru** [src/core/profile/freelanceru.ts](../src/core/profile/freelanceru.ts) — спек-селектор `div.rating-box span` + regex `\d+`. **Backlog был неправ**: rating=61 — валидное значение, на странице действительно «Рейтинг: 61».
- **HH** — намеренно не трогали. Public share-link даёт 403 от антибота → отдельный план: storageState/userDataDir + manual login (см. CLAUDE.md раздел «Открытый трек: HH»).
- **Попутно** (`c5fa64e`): починен [dashboard/components/OrderCard.tsx](../dashboard/components/OrderCard.tsx) под React 19 hooks-rules (хуки внутри try/catch, JSX в try/catch — оба правила теперь errors). `dashboard/eslint.config.mjs` — ignores для git-ignored реликтов `public/swe-worker-*.js` / `public/workbox-*.js` (от удалённого `next-pwa`).

**Smoke-результаты (dnikulshin*):**
- Kwork: displayName, profession, description (1000-сим. с decoded entities), 12 skills, lastOnline. rating=0/reviewsCount=0 — у профиля нет отзывов (валидно).
- FL: rating=42 (с /rating/), portfolio=[]/specializations=[] — у dnikulshindev действительно нет публичных работ (отладка `[class*=...]` подтвердила, что на странице только nav-элементы).
- Freelance.ru: rating=61, services=[] — на профиле блока услуг нет (есть портфолио, но не покрыто spec'ом).
- Lint root + dashboard + dashboard build — все чистые.

**Утилита:** [scripts/smoke-profile.ts](../scripts/smoke-profile.ts) — ad-hoc smoke без БД. Локально требует `npx playwright install chromium` (~150MB), на VPS/GHA уже в стеке.

**Что в backlog (нефункциональное):** флаг `enabled` per-source, ручной refresh не-GitHub источников из dashboard, FL/Kwork few-shot для `generatePitch`, Telegram-алёрт при 3+ падениях парсера профиля.

---

## 2026-05-09 (поздний вечер) — Блок 2 расширение: парсеры FL/Kwork/HH/Freelance.ru + housekeeping

Добавлены 4 источника публичных профилей в `ProfileSnapshot`. Сама инфраструктура (БД, фасад, AI-интеграция, dashboard, GHA) задеплоена и валидирована. **Селекторы парсеров требуют живой настройки в следующей сессии** — на текущих сайтах часть полей не подцепилась.

**Что сделано (commit `193b00d`, deployed 2026-05-09):**
- БД: `ProfileSnapshot.source` (enum github/fl/kwork/hh/freelanceru, default `github`) + `payload Json` + индекс `(source, fetched_at desc)`. Миграция `20260509100000_add_profile_snapshot_source` применена в проде. Existing GitHub-снимки backfilled через DEFAULT (count = 2 → 2 после миграции, ✅).
- Парсеры: [src/core/profile/](../src/core/profile/) — 4 fetcher'а (FL/Kwork/HH/Freelance.ru) через единый `withStealthPage` (Playwright + puppeteer-extra-stealth, реюз `parsers/browser.ts`). Фасад `refreshAllProfiles` через `Promise.allSettled` — ошибка одного источника не валит остальные. `cleanupProfileSnapshots`: keep last 30 per source + delete `>90d`.
- AI: [src/core/profile-context.ts](../src/core/profile-context.ts) → `getCachedExperienceContext()` читает HH-таймлайн → пробрасывается в `scoreOrder` + `generatePitch`. **Только HH** льётся в промпт (FL/Kwork/Freelance.ru — для UI). Если HH-снимка нет, блок не вставляется (поведение до правок не меняется).
- Dashboard: [dashboard/lib/profile.ts](../dashboard/lib/profile.ts) → `getAllSnapshots()` per source + расширенный `formatProfileMd`. [dashboard/app/profile/page.tsx](../dashboard/app/profile/page.tsx) — отдельные секции HH/FL/Kwork/Freelance.ru. Refresh-кнопка осталась GitHub-only (Playwright не тащим в dashboard-контейнер).
- GHA: 4 vars `HH_RESUME_PUBLIC_URL`, `FL_PROFILE_URL`, `KWORK_PROFILE_URL`, `FREELANCERU_PROFILE_URL`.

**Smoke-проверка через workflow_dispatch:**
- ✅ Pipeline не упал, парсеры заказов отработали штатно (84 FL + 12 Kwork + 18 Freelance.ru + 60 HH).
- ✅ Снимки записались для FL/Kwork/Freelance.ru.
- ❌ HH — **403 на public share-link**. Cloudflare/антибот hh.ru поверх stealth. Это не селектор, это серверная защита. Решение — отдельной задачей: либо OAuth API (регистрация hh.ru app), либо прокси.
- ⚠️ FL: `portfolio=2` — оба элемента это nav-ссылки `#profile-nav` («Портфолио», «Прайс-лист»), а не реальные работы. Селектор `[class*="portfolio"]` слишком широкий.
- ⚠️ Kwork: `gigs=0, rating=0` — селекторы `.want-card`/`.kwork-item` (списки заказов) не подходят для страницы продавца. Нужен другой markup.
- ⚠️ Freelance.ru: `rating=61` — `tryText` поймал случайное число; реальный рейтинг — другой селектор.

**Backlog для следующей сессии:**
1. Запустить локально headful Playwright против каждого URL (4 шт.), найти реальные классы через DevTools / Inspector.
2. Решить HH 403 — приоритет: OAuth API через `hh.ru/oauth/authorize` с регистрацией app (даёт доступ к `/me/resumes`).
3. Опционально: добавить флаг `enabled` в `config.profile.{fl,kwork,hh,freelanceru}` чтобы можно было выключить источник через env, не убирая URL.

---

## 2026-05-09 — FL.ru: фильтр платных откликов

На FL.ru проекты с платным откликом приходили в общую выдачу — тратили AI-токены, попадали в Telegram, отвлекали. Добавлен авто-клик чекбокса «Не требуется оплата отклика» перед парсингом.

- [src/parsers/fl.ts](../src/parsers/fl.ts) — helper `applyFreeResponsesFilter(page)` находит `label[for="ui-checkbox-check-for-all"]`, кликает, ждёт перерисовку, возвращает `page.url()` после применения. URL используется как база для пагинации (FL.ru добавляет query-param при фильтрации).
- `buildPageUrl` переписан через `URL` API — корректно вставляет `/page-N/` в pathname, не ломая query-string.
- [src/config.ts](../src/config.ts) — новый флаг `fl.onlyFreeResponses` (env `FL_ONLY_FREE_RESPONSES`, дефолт `true`). Прочитан как `!== "false"` чтобы по умолчанию был включён.
- `.env` + [.github/workflows/scan-agent.yml](../.github/workflows/scan-agent.yml) — `FL_ONLY_FREE_RESPONSES=true` явно прописан.

Если чекбокс не найден — лог-ворнинг, парсер продолжает работу без фильтра (graceful degradation). Если FL.ru поменяет вёрстку — увидим в логах.

---

## 2026-05-08 (поздний вечер) — Блок 1: метрики прогона + `/stats` + MD-экспорт

Реализован первый из 4 стратегических блоков (план `~/.claude/plans/humming-enchanting-castle.md`, реализационный план — `~/.claude/plans/crystalline-popping-scott.md`). Воронка `parsed → filtered → AI-scored → enqueued → applied → won/lost`, AI tokens/cost, score histogram и история прогонов теперь пишутся в `RunMetric` каждым запуском агента и доступны на `/stats` + как скачиваемый MD-отчёт.

**Backend (commit `c3f8845`):**
- [src/types.ts](../src/types.ts) — добавлен `AiUsage`.
- [src/core/analyzer.ts](../src/core/analyzer.ts) — `callOpenRouter` возвращает `{text, usage}`. Cost подтягивается best-effort через `GET /api/v1/generation?id={id}` (`withRetry({maxAttempts: 2})`; 404/timeout → 0). `scoreOrder/generatePitch` → `{result, usage}`. `analyzeOrder` суммирует usage всех вызовов и возвращает количество pitch-вызовов.
- [src/core/metrics.ts](../src/core/metrics.ts) (новый) — класс `RunMetrics` (accumulator: `incParsed/incFiltered/incLowScoreKeyword/incLowScoreAi/incScoringCall/incPitchCall/addAiUsage/recordScore/incEnqueued/incError/setParserDuration` + `flush()`). `runId` через `crypto.randomUUID`. `sent` в Outbox-эпохе = `enqueued`.
- [src/index.ts](../src/index.ts) — pipeline инструментирован; `metrics.flush()` в `finally` перед `process.exit`.
- [scripts/metrics-smoke.ts](../scripts/metrics-smoke.ts) — sanity-check (прогон ОК, `delta=1`).

**Dashboard (тот же commit):**
- [dashboard/lib/stats.ts](../dashboard/lib/stats.ts) (новый) — единая `getStats()` для page и MD: KPI + воронка + scoreHistogram + bySource + recentRuns.
- [dashboard/app/stats/page.tsx](../dashboard/app/stats/page.tsx) + [dashboard/app/stats/StatsCharts.tsx](../dashboard/app/stats/StatsCharts.tsx) (новые) — Server Component с KPI-карточками, таблицей воронки, графиками (recharts) и таблицей последних 30 прогонов.
- [dashboard/app/api/metrics/export/route.ts](../dashboard/app/api/metrics/export/route.ts) (новый) — `GET` отдаёт `text/markdown` с `Content-Disposition: attachment`.
- [dashboard/app/page.tsx](../dashboard/app/page.tsx) — линк «📊 Статистика» в шапке.
- `recharts^3.8.1` в зависимостях dashboard.

**Mobile fix (commit `7aed66c`):**
- Шапка `/stats` на узких экранах: `flex-col sm:flex-row` для контейнера и группы кнопок, кнопки `text-center` (растягиваются на всю ширину на мобильном). Решает баг — обрезался заголовок «📊 Статистика», т.к. кнопки «Скачать MD» + «К заказам» не влезали в один ряд.
- Воронка: `overflow-x-auto + min-w-[360px]` для длинных меток («Отсеяно по keyword (HH)»).
- [scripts/mobile-shot.mjs](../scripts/mobile-shot.mjs) (новый) — playwright-снимок iPhone-вьюпорта; запускается из code-server'a через docker network к `http://dashboard:3000` (минуя Caddy/Authelia).

**Известный артефакт первого деплоя (исправлен):**
В первой проверке воронка показывала проценты > 100% (`applied=32`, но `parsed=8` из smoke-теста). Причина: legacy-orders из миграции postgres-scan → Prisma Postgres имели `status='applied'` исторически, а `RunMetric` была заполнена только smoke'ом. Решение: `DELETE FROM run_metrics WHERE run_id = '...';` smoke-записи. После первого реального cron-прогона `ScanAgent` цифры выровнялись.

---

## 2026-05-08 (вечер) — Production rollout outbox + миграция dashboard на Prisma Postgres

End-to-end проверено в проде: GHA cron-агент → orders в Prisma Postgres → enqueue → dashboard worker → telegram + 5 push'ей. Health: `done=30, pending=0, failed=0`. SSE: `event: ready`.

**Что приехало в прод этим разворотом** (в одной сессии, по шагам):

1. **GHA secret `DATABASE_URL`** добавлен (commit `2b0cd66`). До этого workflow `ScanAgent` падал бы на старте Prisma — секрета не было после миграции с SQLite.
2. **Docker build dashboard починен** для монорепо (commit `a6c30f0`):
   - `Deploy Dashboard` падал на `npm ci`, потому что build context был `./dashboard`, а `dashboard/postinstall = prisma generate --schema ../prisma/schema.prisma` смотрит за пределы context'а; плюс `@prisma/client` намеренно НЕ в `dashboard/package.json` (резолвится из корневого `node_modules`), в Docker корневых deps тоже не было.
   - Workflow: `context: .` + `file: ./dashboard/Dockerfile`.
   - [dashboard/Dockerfile](../dashboard/Dockerfile) многоступенчатый: deps-стадия ставит и корневые deps (с `npx prisma generate`), и dashboard-deps; builder копирует обе папки `node_modules`; runner запускает `node dashboard/server.js`.
   - [dashboard/next.config.ts](../dashboard/next.config.ts): добавлен `outputFileTracingRoot: '..'` — без него standalone не подхватывает `@prisma/client` из корневого `node_modules`.
   - Корневой [.dockerignore](../.dockerignore) отсекает `.git/.next/node_modules/docs`.
3. **Миграция БД dashboard** с локального `postgres-scan` на Prisma Postgres:
   - `UPDATE orders SET col = COALESCE(col, '')` в legacy БД (Prisma DDL даёт NOT NULL DEFAULT '', legacy DDL допускал NULL).
   - `pg_dump --data-only --column-inserts -t orders -t push_subscriptions` → импорт в Prisma Postgres через `psql` (после `TRUNCATE` smoke-test записей). 190 orders + 5 push_subs перенесены.
   - Блок `dashboard.environment` в `/opt/home-codespaces/docker-compose.yml` переписан на `${DATABASE_URL}/${DATABASE_URL_DIRECT}/${TELEGRAM_BOT_TOKEN}/${TELEGRAM_CHAT_ID}`; `depends_on: postgres-scan` удалён. Соответствующие env'ы добавлены в `/opt/home-codespaces/.env`.
   - Контейнер `postgres-scan` оставлен как страховка/legacy backup; снести через ~неделю если всё стабильно.
4. **`public.` префикс в `$queryRaw`** (commit `73ed733`):
   - Pooled URL Prisma Postgres отдаёт `current_schema = null`, raw SQL без префикса падает с `42P01 relation "notification_jobs" does not exist`.
   - ORM-запросы шлют `"public"."notification_jobs"` сами и работают, raw — нет.
   - Альтернатива через `&schema=public` в URL не сработала: Prisma 6.19 на ней отвечает `Can't reach database server`.
   - Fix в [dashboard/lib/notifications/dispatcher.ts:114-129](../dashboard/lib/notifications/dispatcher.ts#L114-L129) — `FROM public.notification_jobs`.

**Что осталось как «не блокеры»:**
- `RunMetric` метрики не пишутся в [src/index.ts](../src/index.ts) — отдельная задача (Блок 1, план `~/.claude/plans/humming-enchanting-castle.md`).
- `src/notifiers/dashboard.ts`, `src/notifiers/supabase.ts` — опциональные дублирующие каналы, можно удалить отдельным cleanup'ом.
- `migrations/001_add_hh_fields.sql`, `supabase/migration.sql` — реликты pre-Prisma эпохи.

---

## 2026-05-08 — Безупречная доставка уведомлений: outbox + worker + SSE (Фазы 1–4)

**Цель:** отвязать «решение отправить» от «факт доставки». Агент перестал отправлять напрямую — пишет `NotificationJob` в Postgres-outbox синхронно с `markProcessed`. Доставку делает 24/7 worker внутри dashboard-контейнера. План: `~/.claude/plans/sunny-drifting-token.md`.

**Архитектура:** `agent → notification_jobs → dashboard worker → Telegram / web-push`. SSE-стрим `pg_notify('order_new')` → открытые вкладки получают новые карточки без F5.

**Фаза 1 — outbox в БД и enqueue в агенте** (commit `d46ee9d`):
- Модель `NotificationJob` в [prisma/schema.prisma](../prisma/schema.prisma); миграция `20260505225113_add_notification_jobs` с `pg_notify`-триггерами `order_new` и `notification_job_new`.
- Pure-форматтеры [src/notifiers/telegram-format.ts](../src/notifiers/telegram-format.ts) (`buildOrderMessage`, `buildReminderMessage`) — переиспользуются и в агенте, и в worker'e.
- Общий [src/core/prisma.ts](../src/core/prisma.ts), [src/core/notifications.ts](../src/core/notifications.ts) с `enqueueNotifications` (telegram + N push) и `enqueueReminder`.
- [src/index.ts](../src/index.ts): inline `telegram.send`/`push.sendToAll` заменены на `markProcessed → enqueueNotifications`. Push-инстанс из агента удалён, reminder через outbox.

**Фазы 2–3 — dashboard worker + SSE** (commit `4c3e6a3`):
- [dashboard/lib/notifications/dispatcher.ts](../dashboard/lib/notifications/dispatcher.ts) — singleton через `globalThis`, poll `NOTIFICATIONS_POLL_INTERVAL_MS` (def 5000), batch до `NOTIFICATIONS_BATCH_LIMIT` (def 20). Атомарный `claimBatch` через `UPDATE … FROM (SELECT … FOR UPDATE SKIP LOCKED)`, подбирает зависшие `sending` (>15 мин). Backoff `[30s, 1m, 5m, 15m, 1h, 6h, 24h, 24h]`; `RetryableError.retryAfterSec` имеет приоритет (Telegram 429); `FatalError` или `attempts ≥ maxAttempts` → `failed`. Per-job изоляция через `Promise.allSettled`.
- Каналы: [telegram.ts](../dashboard/lib/notifications/channels/telegram.ts) — прямой `fetch` Bot API без `node-telegram-bot-api`; [push.ts](../dashboard/lib/notifications/channels/push.ts) — `web-push` с `TTL=2592000`, `Urgency: high`, `Topic: <orderId>`, авто-удаление подписок на 410/404/403.
- [dashboard/instrumentation.ts](../dashboard/instrumentation.ts) — Next.js 16 `register()`, kill-switch `NOTIFICATIONS_DISPATCHER_DISABLED`.
- Health: `GET /api/health/notifications` (Bearer `DASHBOARD_API_KEY`) — counts по статусу за 24ч + last 10 failed.
- SSE [dashboard/app/api/orders/stream/route.ts](../dashboard/app/api/orders/stream/route.ts): `runtime='nodejs'`, прямой `pg.Client` на `DATABASE_URL_DIRECT` (Prisma не умеет LISTEN/NOTIFY — pgBouncer/Accelerate теряют подписку), heartbeat 25с, `X-Accel-Buffering: no`. [RealtimeOrdersListener.tsx](../dashboard/components/RealtimeOrdersListener.tsx) — auto-reconnect 1s→30s, reset на `event: ready`.

**Фаза 4 — cleanup (этот коммит):**
- Удалён `src/notifiers/push.ts` — логика отправки и delete-on-410 переехала в worker.
- [dashboard/public/sw.js](../dashboard/public/sw.js): `tag: orderId, renotify: true` (повторный push по заказу схлопывается, но звук/вибро срабатывают); `notificationclick` фокусирует существующую вкладку dashboard вместо повторного открытия.
- `web-push` в корневом `package.json` остаётся ради `scripts/test-push.ts` (sanity-check доставки на проде).

**Принятые решения:**
- БД очереди — Postgres (Redis/BullMQ overkill для 10–15 push/день; `pg_notify` + `SKIP LOCKED` дают всё нужное).
- Push fan-out — одна job на endpoint (потеря одной не влияет на остальные).
- Worker singleton через `instrumentation.ts` + `globalThis`. На двух репликах `SKIP LOCKED` всё равно атомарен.
- Telegram polling (callback-кнопки `/setrate`, `pick1/pick2/skip`) **остаётся в агенте** — перенос polling'а в dashboard вне скоупа.

**Новые env для dashboard** (см. `CLAUDE.md`): `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `VAPID_SUBJECT`, `DATABASE_URL_DIRECT`, опц. `NOTIFICATIONS_POLL_INTERVAL_MS`, `NOTIFICATIONS_BATCH_LIMIT`, `NOTIFICATIONS_DISPATCHER_DISABLED`.

---

## 2026-05-05 — Шаг 2 миграции на Prisma + универсальный dev-доступ через Caddy

**Prisma миграция (Шаг 2 плана `docs/plans/postgres-migration.md`):**
- Установлены `prisma@6.19.3` + `@prisma/client@6.19.3` (Prisma 7 несовместим: убрал `datasource.url` из schema-файла, требует `prisma.config.ts`).
- `prisma/schema.prisma` с 4 моделями: `Order`, `Setting`, `PushSubscription`, `RunMetric` (последняя сразу с расширениями Блока 1: `aiTokensIn/Out`, `aiCostUsd Decimal(12,6)`, `parserDurations`, `scoreHistogram`, `scoringCalls`, `pitchCalls`).
- Применена миграция `prisma/migrations/20260505174149_init` к Prisma Postgres. Таблицы и индексы есть, smoke-test через `scripts/prisma-smoke.ts` ок (4 пустые таблицы доступны через PrismaClient).
- Все Prisma-команды нужно запускать **без HTTP-прокси**: `env -u HTTP_PROXY -u HTTPS_PROXY -u http_proxy -u https_proxy npx prisma ...`.

**Шаг 3 (storage.ts на Prisma) — заготовка:** черновик новой реализации `Storage` лежит в `docs/plans/storage-prisma-draft.ts`. В нём все методы async, есть `count()` (не геттер), `getStats` через `$queryRaw` с Postgres-синтаксисом (`COUNT(*) FILTER WHERE`, `INTERVAL`). После замены `src/core/storage.ts` нужно добавить `await` в `src/index.ts` (10 мест) и `src/notifiers/telegram.ts` (12 мест).

**Инфраструктура — универсальный dev-доступ:** в Caddyfile хоста (`/opt/home-codespaces/Caddyfile`) добавлен snippet `(devport)`. Любой порт codeserver-контейнера выводится наружу за один блок: `myapp.nikulshin-dev.online { import devport <PORT> }` + `caddy reload`. С Authelia. Решает классическую проблему code-server `/proxy/PORT/` для SPA (Prisma Studio, Next.js dev, NestJS, Vite, ...). Подробности — в [CLAUDE.md](../CLAUDE.md) разделе «🛠️ Инфра».

---

## 2026-05-03 (сессия 2) — FL без AI-питча + пиковое расписание cron

**Решение по бизнесу:** на FL.ru AI-питч уступает ручному тексту, а каждая генерация — это токены и минуты Actions. Агент на FL теперь только **отбирает** проекты (skillsWeight предфильтр + AI-скоринг), отклик пишется вручную.

**Изменения:**
- `src/config.ts` — доукомплектован `config.fl`: `maxPages`, `fetchDelay`, `hardExclude`, `skillsWeight`, `userAgents`, `generatePitch` (флаг режима)
- `src/index.ts` — ветка `source === 'fl' && !config.fl.generatePitch`: scoreOrder() → пустой pitch → notify. Полный pipeline (score + pitch×2) остаётся для Kwork / Habr / Freelance.ru
- `src/notifiers/telegram.ts` — метод `send()` роутит по источнику: `hh → sendVacancy`, `fl (без питча) → sendFlOrder`, иначе `sendFreelanceOrder`. У `sendFlOrder` одна кнопка «Пропустить», без A/B вариантов
- `.github/workflows/scan-agent.yml`:
  - `FL_GENERATE_PITCH=false`, `FL_MAX_PAGES=5` в env
  - Cron перестроен по нагрузке: пиковые часы 07-10 / 17-20 МСК — каждые 30 мин; остальное — раз в 2 часа. Экономит ~50% Actions-минут без потери новых проектов

**Нюанс схемы БД:** при пустых hook/pitch колонки в SQLite/Postgres не должны иметь NOT NULL. Сейчас не имеют — fallback `{ hook: '', pitch: '' }` пишется штатно.

---

## 2026-05-03 — Фикс FL.ru парсера (page.evaluate падал)

**Проблема:** парсер FL валился в самом начале:
```
🌐 [FL] Открываю https://www.fl.ru/projects/
❌ [FL] Ошибка: Cannot read properties of undefined (reading 'length')
```
А после первого фикса — новая ошибка:
```
❌ [FL] Ошибка: page.evaluate: ReferenceError: __name is not defined
```

**Причины и фиксы:**

1. **`new Function(\`return ${...}\`)` в `page.evaluate`** (`src/parsers/fl.ts`).
   Playwright сериализует pageFunction через `toString()`, но для функций, созданных конструктором `Function`, серилизация даёт `function anonymous() { ... }` — Playwright не всегда корректно его выполняет, и `page.evaluate` возвращал `undefined`. Дальше `page1Cards.length` → краш.
   **Решение:** заменил на обычную функцию `parseCardsInBrowser(html: string | null)` — одна функция парсит и `document` (page 1), и HTML-строку через DOMParser (page 2+). Заодно ушло ~80 строк дублирования.

2. **`__name is not defined` в браузерном контексте** (`src/parsers/browser.ts`).
   tsx/esbuild с опцией `keepNames` оборачивает именованные функции в `__name(fn, "name")` для сохранения `Function.name`. При сериализации в `page.evaluate` ссылки на `__name` уезжают в браузер, где этого хелпера нет → ReferenceError.
   **Решение:** в `createBrowser()` добавлен `context.addInitScript()` — инжектит `globalThis.__name = (fn) => fn` в каждую страницу до загрузки. Шим действует на все парсеры (FL, HH, browser-helpers).

**Нюанс на будущее:** при использовании `page.evaluate(fn)` с tsx/esbuild — либо передавать только стрелочные функции, либо держать шим `__name` в init script. Любой именованный `function` или `class` транспилируется с обёрткой.

**Решено по дизайну:** `FL_MAX_PAGES=3` оставляем — на пиковых направлениях 60 проектов/тик хватает (cron каждые 30 мин). Если в логах будут видны новые проекты на 3-й странице — поднимать до 5.

---

## 2026-04-27 (сессия 3) — Фикс GitHub Actions cache race condition

**Проблема:** `Warning: Cache save failed — Unable to reserve cache with key agent-db-<run_id>` при каждом запуске агента.

**Причина:** Двойное сохранение кеша:
- `actions/cache@v4` (шаг "Restore DB cache") — делал авто-сохранение в post-run с тем же ключом
- `actions/cache/save@v4` (шаг "Save DB cache") — ещё одно явное сохранение

Оба шага пытались записать в один ключ `agent-db-${{ github.run_id }}` → race condition с самим собой.

**Фикс:** `.github/workflows/scan-agent.yml` — `actions/cache@v4` → `actions/cache/restore@v4` в шаге "Restore DB cache". Единственная запись — явный `actions/cache/save@v4` в конце.

**Нюанс:** `actions/cache@v4` = restore + авто-save на post-run. Если рядом есть явный `cache/save@v4` с тем же ключом — всегда будет конфликт. Паттерн: `actions/cache/restore@v4` + `actions/cache/save@v4` по отдельности.

---

## 2026-04-27 (сессия 2) — Стабилизация CI/CD + HH парсер

**Что сделано:**
- `.github/workflows/deploy-dashboard.yml` — исправлен webhook-вызов: HMAC-SHA256 (`X-Hub-Signature-256`) вместо Bearer-токена. Секрет: `WEBHOOK_SECRET_SCAN_AGENT`
- `webhook/deploy-scan-agent.sh` — реальный деплой (`docker compose pull dashboard && up -d`) вместо заглушки
- `src/index.ts` — каждый `parser.fetchOrders()` обёрнут в try-catch: падение одного парсера не роняет весь агент
- `src/parsers/hh.ts`:
  - guard на пустой `HH_SEARCH_URL` (возвращает `[]` вместо `Invalid URL`)
  - `waitUntil: 'domcontentloaded'` вместо `networkidle` + timeout 30s (HH держит фоновые запросы → таймаут 60s)
- `src/index.ts` — positive keyword filter для HH: `kw.rawScore < config.hh.minKeywordScore` до AI-вызова. Снижает кол-во AI-вызовов с ~75 до ~15 на 149 вакансий

**Закрытые задачи из прошлой сессии:**
- ✅ Миграция БД на VPS применена (`employer`, `city` колонки)
- ✅ Секрет `HH_ENABLED=true` добавлен в GitHub Actions
- ✅ Dashboard деплой починен — CI/CD работает end-to-end
- ✅ `HH_SEARCH_URL` добавлен в GitHub Actions secrets

**Что осталось:**
- Рассмотреть добавление Task Management CRM или AnyWhereDesk в портфолио профиля

---

## 2026-04-27 (сессия 1) — Dashboard поддержка HH.ru + фикс HH_MAX_PAGES

**Что сделано:**
- `dashboard/lib/db.ts` — поля `employer` и `city` в интерфейсе `Order`
- `dashboard/app/api/orders/route.ts` — INSERT/UPDATE сохраняет `employer` и `city`
- `dashboard/app/page.tsx` — фильтр по источнику включает `hh`
- `dashboard/components/OrderCard.tsx`:
  - `hh: '🔴'` в SOURCE_EMOJI
  - для HH: показывает `🏢 employer` и `📍 city` вместо счётчика откликов
  - кнопка «Показать отклик» скрыта когда `hook`/`pitch` пустые (все HH-вакансии)
- `src/notifiers/dashboard.ts` — передаёт `employer` и `city` в POST /api/orders
- `.github/workflows/scan-agent.yml` — добавлены `HH_ENABLED`, `HH_SEARCH_URL`, `HH_MAX_PAGES`, `HH_MIN_KEYWORD_SCORE`
- `migrations/001_add_hh_fields.sql` — миграция: `ALTER TABLE orders ADD COLUMN IF NOT EXISTS employer TEXT; ... city TEXT`
- **fix** `src/config.ts`: `Number(process.env.HH_MAX_PAGES ?? '3')` → `||` — `??` не защищает от пустой строки

---

## 2026-04-26 — Интеграция HH.ru + обновление профиля

**Что сделано:**
- Добавлен `src/parsers/hh.ts` — Playwright-парсер вакансий HH.ru (пагинация, meta: employer/city)
- Добавлен `src/core/keyword-scorer.ts` — FULLSTACK_SCORING и DEVOPS_SCORING конфиги для hardExclude pre-filter
- `src/types.ts` — добавлен `'hh'` в union source, поле `meta?`
- `src/config.ts` — добавлена секция `hh` (enabled/url/maxPages/minKeywordScore)
- `src/parsers/index.ts` — экспорт HhParser
- `src/index.ts` — HH-ветка в pipeline: hardExclude → AI scoreOrder() → Telegram (без питча)
- `src/notifiers/telegram.ts` — HH.ru в SOURCE_LABEL, метод `sendVacancy()` (без inline-кнопок выбора питча)
- `src/core/analyzer.ts` — промпт скоринга теперь использует `profile.stack` вместо захардкоженного стека
- `src/profile.ts` — обновлён реальными данными: полный стек (Vue, NestJS, Fastify, Redis, React Native, Expo), 3 реальных проекта из GitHub

**Тест (2026-04-26):** 149 вакансий HH распарсено, 19 новых, 2 отправлено в Telegram — работает.
