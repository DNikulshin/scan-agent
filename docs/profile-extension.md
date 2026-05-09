# Блок 2 расширение — парсеры FL/Kwork/Freelance.ru + housekeeping (2026-05-09)

**Инфраструктура задеплоена 2026-05-09 (commit `193b00d`), селекторы FL/Kwork/Freelance.ru закрыты в тот же день (commits `0ce59b3`+`c5fa64e`, plan `~/.claude/plans/swift-wobbling-wave.md`).** Spec пользователя из `test.md` верифицирован живым smoke на профилях dnikulshin* через [scripts/smoke-profile.ts](../scripts/smoke-profile.ts).

GitHub-снимок дополнен 3 источниками: FL.ru / Kwork.ru / Freelance.ru. **HH вынесен в отдельный flow** (ручная заливка через `/profile` — см. [profile-hh-manual.md](profile-hh-manual.md)). FL/Kwork/Freelance.ru хранятся для UI на `/profile` и MD-экспорта; в AI-промпт льётся только HH (через `getCachedExperienceContext()`). Housekeeping: keep last 30 per source + delete `fetchedAt < now - 90d`.

## Карта кода

- БД: `ProfileSnapshot` с `source ProfileSource` (enum github/fl/kwork/hh/freelanceru, default `github`) + `payload Json`. `githubLogin` стал nullable. Индекс `(source, fetched_at desc)`. Миграция `20260509100000_add_profile_snapshot_source`.
- Парсеры [src/core/profile/](../src/core/profile/):
  - **Kwork** [kwork.ts](../src/core/profile/kwork.ts): тащит `window.stateData` через `page.evaluate` (rating, reviewsCount, displayName, profession, description с decode HTML entities, skills, badges, lastOnline). DOM-fallback на `h1.user-username`/`.user-profession`/`.user-skills__item`.
  - **FL** [fl.ts](../src/core/profile/fl.ts): двухпроходный fetch — `/rating/` через `div.rating p.b-text__bold` (общий рейтинг), затем `/portfolio/` через узкий `.b-portfolio__item` + `.user-categories a`. Login извлекается из URL regex'ом.
  - **Freelance.ru** [freelanceru.ts](../src/core/profile/freelanceru.ts): спек-селектор `div.rating-box span` + regex `\d+`.
  - **HH** [hh.ts](../src/core/profile/hh.ts): только `summarizeRawText` + legacy `summarizeHhExperience` (автопарсинг убран, см. [profile-hh-manual.md](profile-hh-manual.md)).
  - `browser.ts` (`withStealthPage` поверх `parsers/browser.ts`), `housekeeping.ts`, фасад `index.ts` (`refreshAllProfiles` через `Promise.allSettled`).
- Profile-context [src/core/profile-context.ts](../src/core/profile-context.ts): `source=github` для языков/репо, `source=hh` для опыта (`getCachedExperienceContext()`).
- Analyzer [src/core/analyzer.ts](../src/core/analyzer.ts): HH-experience в оба промпта (опционально).
- Pipeline [src/index.ts](../src/index.ts): `refreshAllProfiles` + `cleanupProfileSnapshots` после GitHub-refresh.
- Config [src/config.ts](../src/config.ts): секция `profile` (`flUrl`, `kworkUrl`, `freelanceruUrl`, `snapshotMaxAgeHours`).
- Dashboard:
  - Типы — [dashboard/lib/profile-types.ts](../dashboard/lib/profile-types.ts) (зеркало `src/core/profile/types.ts`, KworkProfilePayload без `gigs`).
  - [dashboard/lib/profile.ts](../dashboard/lib/profile.ts) — `getAllSnapshots()`, `formatProfileMd` с `renderKworkSection` под новые поля.
  - [dashboard/app/profile/page.tsx](../dashboard/app/profile/page.tsx) — UI секции с тегами skills/badges и excerpt описания.
- GHA: 3 vars (`FL_PROFILE_URL`, `KWORK_PROFILE_URL`, `FREELANCERU_PROFILE_URL`) в [.github/workflows/scan-agent.yml](../.github/workflows/scan-agent.yml).

## Решения

- Унификация: одна таблица `ProfileSnapshot` с дискриминатором `source`. GitHub продолжает писать в legacy `languagesAgg`/`repos` (бэкуордно), новые источники — в `payload`.
- AI: только HH в промпт (опыт работы — то, чего GitHub не даёт). FL/Kwork/Freelance.ru — социальное доказательство, в питч не льём ради context window.
- Refresh-кнопка `/profile` остаётся **GitHub-only** — Playwright не тащим в dashboard-контейнер. Не-GitHub источники обновляются по cron агента (FL/Kwork/Freelance.ru) или вручную (HH).
- Kwork: переход на `window.stateData` вместо DOM — JSON стабильнее меняется при редизайне, чем CSS-классы.
- FL: двухпроходный fetch (~+1 сек) — оправдано, потому что rating живёт на отдельной странице.
- Decode HTML entities в Kwork description через hardcoded map (`&laquo;`→«, `&mdash;`→— и т.п.) — без отдельной зависимости.

## Critical-нюансы

- `dashboard/lib/profile-types.ts` дублирует `src/core/profile/types.ts` — намеренно (паттерн `lib/notifications/*`). Обновлять синхронно.
- Пустой `portfolio[]` / `services[]` для FL/Freelance.ru — это live-данные конкретного профиля (нет публичных работ/услуг), не баг селекторов.
- `scripts/smoke-profile.ts` — ad-hoc smoke без БД, env'ы `FL_PROFILE_URL`/`KWORK_PROFILE_URL`/`FREELANCERU_PROFILE_URL`. Локально нужен `npx playwright install chromium` (~150MB) — на VPS/GHA уже установлен.

## Backlog (нефункциональное)

- Опциональный флаг `enabled` в `config.profile.{fl,kwork,freelanceru}` чтобы выключать источник env'ом без удаления URL.
- Ручной refresh не-GitHub источников из dashboard через outbox-job.
- FL/Kwork few-shot для `generatePitch`.
- Алёрт в Telegram при падении парсера профиля 3+ раз подряд.
