# HH-резюме через ручную заливку на /profile (2026-05-09)

## Контекст

Автопарсинг HH под авторизованной сессией (storageState + headful login) был зашортлистен и частично собран, но HH /resume отдаёт Cloudflare Lux SPA — `template#HH-Lux-InitialState` (220KB JSON) + DOM с `data-qa="skill-tag-<numericId>"`, нестабильным к редизайнам. Поддержка дороже пользы.

## Принято

Убрали HH-парсинг полностью, на `/profile` появилась форма ручной заливки текста резюме. Пользователь периодически копирует выгрузку из HH в textarea, dashboard кладёт в `ProfileSnapshot(source='hh').payload.rawText`. AI-промпт читает через `getCachedExperienceContext()` без изменений в pipeline.

## Карта кода

- Тип: [src/core/profile/types.ts](../src/core/profile/types.ts) + [dashboard/lib/profile-types.ts](../dashboard/lib/profile-types.ts) — `HhResumePayload.rawText?: string` (новое поле приоритетное); legacy-поля `title/area/salary/experience[]/skills[]` стали опциональными для совместимости со старыми снимками.
- Endpoint: [dashboard/app/api/profile/hh/route.ts](../dashboard/app/api/profile/hh/route.ts) — POST JSON `{text}`, Bearer `DASHBOARD_API_KEY`, лимит 256K, ручная валидация без zod (паттерн как у /api/orders/pitch).
- UI: [dashboard/app/profile/HhUploadForm.tsx](../dashboard/app/profile/HhUploadForm.tsx) — клиентский компонент с textarea (10 строк, monospace) + счётчик символов + prompt ключа на сабмите. [dashboard/app/profile/page.tsx](../dashboard/app/profile/page.tsx) — секция «HH.ru — резюме (ручная заливка)», `HhSection` рендерит `<pre>` с `payload.rawText` если задан.
- AI: [src/core/profile-context.ts](../src/core/profile-context.ts) — `loadHhExperience()` сначала пробует `rawText` (через новую `summarizeRawText` в [src/core/profile/hh.ts](../src/core/profile/hh.ts)), fallback на legacy `experience[]`.
- MD-экспорт: [dashboard/lib/profile.ts](../dashboard/lib/profile.ts) `renderHhSection` льёт `rawText` в fenced ` ``` `-block; маркер «ручная заливка» вместо ссылки если `payload.url === 'manual'`.

## Что стоит делать дальше

1. На проде — открыть `/profile`, вставить актуальный текст резюме в textarea, нажать «💾 Сохранить резюме», ввести `DASHBOARD_API_KEY` из Bitwarden.
2. Перезагрузить — секция «HH.ru — резюме (ручная заливка)» покажет текст в `<pre>`.
3. На следующем прогоне агента (cron) `getCachedExperienceContext()` начнёт лить текст в `scoreOrder`/`generatePitch`-промпты.
4. Обновлять снимок раз в N месяцев или при значимом изменении опыта — заливка перезатирает прошлый снимок (housekeeping чистит старое >90д автоматом).

## Решения

- Формат входа — plain text через textarea (не PDF, не DOCX, не файл). Пользователь сам формирует удобную ему выжимку.
- Без структурированной формы (`experience[]` repeater) — overkill, заливка раз в полгода.
- Без zod — для одной валидации `{text:string}` лишний пакет; ручной check как в других dashboard endpoint'ах.
- `url: 'manual'` — маркер ручного снимка для UI/MD; legacy-снимки сохраняют формат `hh.ru/resume/<hash>` для бэкуордной совместимости.

## Откатили (промежуточная storageState-итерация)

- `scripts/hh-login.ts` (CLI manual login через headful chromium).
- `storageStatePath` опцию из `createBrowser` ([src/parsers/browser.ts](../src/parsers/browser.ts)) и `withStealthPage` ([src/core/profile/browser.ts](../src/core/profile/browser.ts)).
- `fetchHhResume()` целиком из [src/core/profile/hh.ts](../src/core/profile/hh.ts) — остался только `summarizeHhExperience` (legacy fallback) + новая `summarizeRawText`.
- Env'ы `HH_PLAYWRIGHT_STORAGE_STATE` / `HH_RESUME_PUBLIC_URL`, поля `hhResumeUrl`/`hhStorageStatePath` из `config.profile` ([src/config.ts](../src/config.ts)).
- HH-job из `refreshAllProfiles` ([src/core/profile/index.ts](../src/core/profile/index.ts)) и шаг `Materialize HH storage state` из [.github/workflows/scan-agent.yml](../.github/workflows/scan-agent.yml).
- HH-блок из [scripts/smoke-profile.ts](../scripts/smoke-profile.ts).
