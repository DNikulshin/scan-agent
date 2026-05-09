import Link from 'next/link';
import { getAllSnapshots, languagesByPct } from '@/lib/profile';
import type {
  HhResumePayload,
  FlProfilePayload,
  KworkProfilePayload,
  FreelanceruProfilePayload,
} from '@/lib/profile-types';
import { RefreshButton } from './RefreshButton';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

function fmtAge(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const hrs = Math.floor(ms / 3600_000);
  if (hrs < 1) return '< 1 ч назад';
  if (hrs < 24) return `${hrs} ч назад`;
  const days = Math.floor(hrs / 24);
  return `${days} д назад`;
}

export default async function ProfilePage(): Promise<React.ReactElement> {
  const all = await getAllSnapshots();
  const snap = all.github;

  return (
    <div className="max-w-5xl mx-auto px-4 py-8">
      <div className="mb-8 flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white mb-1">👤 Профиль</h1>
          <p className="text-gray-400 text-sm">
            Снимки из GitHub + HH/FL/Kwork/Freelance.ru. AI-промпт берёт стек из GitHub и опыт работы из HH.
          </p>
        </div>
        <div className="flex flex-col sm:flex-row gap-2 sm:shrink-0">
          <a
            href="/api/profile/export"
            download
            className="px-3 py-1.5 text-sm rounded-md bg-blue-600 hover:bg-blue-500 text-white transition-colors text-center"
          >
            📥 Скачать MD
          </a>
          <RefreshButton />
          <Link
            href="/"
            className="px-3 py-1.5 text-sm rounded-md bg-gray-800 hover:bg-gray-700 text-gray-300 border border-gray-700 transition-colors text-center"
          >
            ← К заказам
          </Link>
        </div>
      </div>

      {!snap && !all.hh && !all.fl && !all.kwork && !all.freelanceru && (
        <div className="bg-yellow-900/30 border border-yellow-800 rounded-lg p-4 text-yellow-200 text-sm">
          Снимков ещё нет. Запустите агента (он создаст автоматически) или нажмите «Обновить» (только GitHub).
        </div>
      )}

      {snap && (
        <>
          <section className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-8">
            <Kpi label="GitHub login" value={snap.githubLogin} />
            <Kpi label="Репов в снимке" value={String(snap.repos.length)} />
            <Kpi label="Обновлён" value={fmtAge(snap.fetchedAt)} hint={new Date(snap.fetchedAt).toLocaleString('ru-RU')} />
          </section>

          <section className="mb-8">
            <h2 className="text-lg font-semibold text-white mb-3">Стек по языкам</h2>
            <div className="bg-gray-900 border border-gray-800 rounded-lg p-4 overflow-x-auto">
              <table className="w-full text-sm min-w-[360px]">
                <thead className="text-gray-400 text-left">
                  <tr>
                    <th className="pb-2">Язык</th>
                    <th className="pb-2 text-right">Bytes</th>
                    <th className="pb-2 text-right">%</th>
                    <th className="pb-2 pl-3"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-800">
                  {languagesByPct(snap.languagesAgg).map(({ lang, bytes, pct }) => (
                    <tr key={lang}>
                      <td className="py-2 font-mono text-gray-300">{lang}</td>
                      <td className="py-2 text-right text-gray-400">{bytes.toLocaleString('en-US')}</td>
                      <td className="py-2 text-right text-white">{(pct * 100).toFixed(1)}%</td>
                      <td className="py-2 pl-3 w-1/3">
                        <div className="h-2 bg-gray-800 rounded">
                          <div
                            className="h-2 bg-blue-500 rounded"
                            style={{ width: `${Math.max(pct * 100, 1)}%` }}
                          />
                        </div>
                      </td>
                    </tr>
                  ))}
                  {Object.keys(snap.languagesAgg).length === 0 && (
                    <tr><td colSpan={4} className="py-4 text-center text-gray-500">Нет данных</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>

          <section className="mb-8">
            <h2 className="text-lg font-semibold text-white mb-3">Топ-репозитории</h2>
            <div className="space-y-3">
              {snap.repos.map((r) => (
                <div key={r.name} className="bg-gray-900 border border-gray-800 rounded-lg p-4">
                  <div className="flex items-baseline justify-between gap-2 flex-wrap mb-1">
                    <a
                      href={r.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-base font-semibold text-blue-400 hover:underline break-all"
                    >
                      {r.name}
                    </a>
                    <div className="text-xs text-gray-500 font-mono shrink-0">
                      {r.language && <span className="mr-2 text-gray-400">{r.language}</span>}
                      {r.stars > 0 && <span className="mr-2">⭐ {r.stars}</span>}
                      {r.pushedAt.slice(0, 10)}
                    </div>
                  </div>
                  {r.description && (
                    <p className="text-gray-300 text-sm mb-2">{r.description}</p>
                  )}
                  {r.readmeExcerpt && (
                    <pre className="text-xs text-gray-400 bg-black/30 rounded p-2 overflow-x-auto whitespace-pre-wrap">
                      {r.readmeExcerpt}
                    </pre>
                  )}
                </div>
              ))}
            </div>
          </section>
        </>
      )}

      {all.hh && <HhSection fetchedAt={all.hh.fetchedAt} payload={all.hh.payload} />}
      {all.fl && <FlSection fetchedAt={all.fl.fetchedAt} payload={all.fl.payload} />}
      {all.kwork && <KworkSection fetchedAt={all.kwork.fetchedAt} payload={all.kwork.payload} />}
      {all.freelanceru && <FreelanceruSection fetchedAt={all.freelanceru.fetchedAt} payload={all.freelanceru.payload} />}
    </div>
  );
}

function SourceHeader({ title, fetchedAt, link }: { title: string; fetchedAt: string; link: string }): React.ReactElement {
  return (
    <div className="mb-3 flex items-baseline justify-between gap-2 flex-wrap">
      <h2 className="text-lg font-semibold text-white">{title}</h2>
      <div className="text-xs text-gray-500">
        {fmtAge(fetchedAt)} · <a href={link} target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:underline">открыть</a> · обновляется по cron агента
      </div>
    </div>
  );
}

function HhSection({ fetchedAt, payload }: { fetchedAt: string; payload: HhResumePayload }): React.ReactElement {
  return (
    <section className="mb-8">
      <SourceHeader title="HH.ru — резюме" fetchedAt={fetchedAt} link={payload.url} />
      <div className="bg-gray-900 border border-gray-800 rounded-lg p-4 space-y-3">
        <div className="text-sm text-gray-300 space-y-1">
          {payload.title && <div><span className="text-gray-500">Должность:</span> <span className="text-white">{payload.title}</span></div>}
          {payload.area && <div><span className="text-gray-500">Локация:</span> {payload.area}</div>}
          {payload.salary && <div><span className="text-gray-500">Желаемая ЗП:</span> {payload.salary}</div>}
        </div>

        {payload.experience.length > 0 && (
          <div>
            <h3 className="text-sm font-semibold text-gray-400 mb-2">Опыт работы</h3>
            <ul className="space-y-2 text-sm">
              {payload.experience.map((e, i) => (
                <li key={`${e.company}-${i}`}>
                  <div className="text-gray-300">
                    <span className="text-gray-500 font-mono text-xs">{e.period}</span>{' '}
                    <span className="text-white">{e.company}</span> · {e.position}
                  </div>
                  {e.summary && <div className="text-gray-400 text-xs mt-0.5">{e.summary}</div>}
                </li>
              ))}
            </ul>
          </div>
        )}

        {payload.skills.length > 0 && (
          <div>
            <h3 className="text-sm font-semibold text-gray-400 mb-2">Ключевые навыки</h3>
            <div className="flex flex-wrap gap-1.5">
              {payload.skills.map((s) => (
                <span key={s} className="px-2 py-0.5 text-xs rounded bg-gray-800 text-gray-300 border border-gray-700">{s}</span>
              ))}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

function FlSection({ fetchedAt, payload }: { fetchedAt: string; payload: FlProfilePayload }): React.ReactElement {
  return (
    <section className="mb-8">
      <SourceHeader title="FL.ru — портфолио" fetchedAt={fetchedAt} link={payload.url} />
      <div className="bg-gray-900 border border-gray-800 rounded-lg p-4 space-y-3 text-sm">
        {(payload.rating > 0 || payload.reviewsCount > 0) && (
          <div className="text-gray-300">
            <span className="text-white">Рейтинг {payload.rating}</span> · {payload.reviewsCount} отзыв(ов)
          </div>
        )}
        {payload.specializations.length > 0 && (
          <div className="text-gray-400 text-xs">{payload.specializations.join(' · ')}</div>
        )}
        {payload.portfolio.length > 0 && (
          <ul className="space-y-2">
            {payload.portfolio.map((w, i) => (
              <li key={`${w.title}-${i}`}>
                <a href={w.link} target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:underline">
                  {w.title}
                </a>
                {w.description && <span className="text-gray-400"> — {w.description}</span>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function KworkSection({ fetchedAt, payload }: { fetchedAt: string; payload: KworkProfilePayload }): React.ReactElement {
  const title = payload.displayName ? `Kwork — ${payload.displayName}` : 'Kwork';
  const descriptionExcerpt = payload.description
    ? payload.description.length > 300
      ? `${payload.description.slice(0, 300)}…`
      : payload.description
    : null;
  return (
    <section className="mb-8">
      <SourceHeader title={title} fetchedAt={fetchedAt} link={payload.url} />
      <div className="bg-gray-900 border border-gray-800 rounded-lg p-4 space-y-3 text-sm">
        {payload.profession && (
          <div className="text-gray-300">
            <span className="text-white">{payload.profession}</span>
          </div>
        )}
        {(payload.rating > 0 || payload.reviewsCount > 0) && (
          <div className="text-gray-300">
            <span className="text-white">Рейтинг {payload.rating}</span> · {payload.reviewsCount} отзыв(ов)
          </div>
        )}
        {payload.lastOnline && <div className="text-gray-500 text-xs">{payload.lastOnline}</div>}
        {payload.badges.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {payload.badges.map((b, i) => (
              <span key={`${b}-${i}`} className="px-2 py-0.5 text-xs bg-gray-800 text-gray-300 rounded">
                {b}
              </span>
            ))}
          </div>
        )}
        {descriptionExcerpt && <p className="text-gray-300 whitespace-pre-line">{descriptionExcerpt}</p>}
        {payload.skills.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {payload.skills.map((s, i) => (
              <span key={`${s}-${i}`} className="px-2 py-0.5 text-xs bg-blue-900/40 text-blue-200 rounded">
                {s}
              </span>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function FreelanceruSection({
  fetchedAt,
  payload,
}: {
  fetchedAt: string;
  payload: FreelanceruProfilePayload;
}): React.ReactElement {
  return (
    <section className="mb-8">
      <SourceHeader title="Freelance.ru" fetchedAt={fetchedAt} link={payload.url} />
      <div className="bg-gray-900 border border-gray-800 rounded-lg p-4 space-y-3 text-sm">
        {payload.rating > 0 && <div className="text-gray-300">Рейтинг <span className="text-white">{payload.rating}</span></div>}
        {payload.services.length > 0 && (
          <ul className="space-y-2">
            {payload.services.map((s, i) => (
              <li key={`${s.title}-${i}`}>
                <span className="text-white">{s.title}</span>
                {s.description && <span className="text-gray-400"> — {s.description}</span>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function Kpi({ label, value, hint }: { label: string; value: string; hint?: string }): React.ReactElement {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-lg p-3">
      <div className="text-xs text-gray-400 mb-1">{label}</div>
      <div className="text-xl font-bold text-white">{value}</div>
      {hint && <div className="text-xs text-gray-500 mt-1">{hint}</div>}
    </div>
  );
}
