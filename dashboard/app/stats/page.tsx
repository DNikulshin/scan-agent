import Link from 'next/link';
import { getStats } from '@/lib/stats';
import {
  ScoreHistogramChart,
  ParserDurationsChart,
  ParsedBySourceChart,
} from './StatsCharts';

// Метрики обновляются после каждого прогона агента — кэшировать страницу нельзя.
export const dynamic = 'force-dynamic';
export const revalidate = 0;

function pct(num: number, den: number): string {
  if (!den) return '—';
  return `${Math.round((num / den) * 100)}%`;
}

function fmtUsd(n: number): string {
  return `$${n.toFixed(4)}`;
}

function fmtMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export default async function StatsPage() {
  const stats = await getStats();
  const { kpi, funnel, recentRuns, bySource } = stats;

  return (
    <div className="max-w-5xl mx-auto px-4 py-8">
      {/* Header — на мобильных кнопки уходят под заголовок вертикально */}
      <div className="mb-8 flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white mb-1">📊 Статистика</h1>
          <p className="text-gray-400 text-sm">
            All-time. Обновляется после каждого прогона агента.
          </p>
        </div>
        <div className="flex flex-col sm:flex-row gap-2 sm:shrink-0">
          <a
            href="/api/metrics/export"
            download
            className="px-3 py-1.5 text-sm rounded-md bg-blue-600 hover:bg-blue-500 text-white transition-colors text-center"
          >
            📥 Скачать MD
          </a>
          <Link
            href="/"
            className="px-3 py-1.5 text-sm rounded-md bg-gray-800 hover:bg-gray-700 text-gray-300 border border-gray-700 transition-colors text-center"
          >
            ← К заказам
          </Link>
        </div>
      </div>

      {/* KPI cards */}
      <section className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-8">
        <Kpi label="Спарсено" value={kpi.totalParsed.toLocaleString('ru-RU')} />
        <Kpi label="Уведомлено (enqueued)" value={kpi.totalEnqueued.toLocaleString('ru-RU')} />
        <Kpi label="Откликов" value={kpi.totalApplied.toLocaleString('ru-RU')} />
        <Kpi
          label="Win-rate"
          value={kpi.totalWon + kpi.totalLost > 0 ? `${Math.round(kpi.winRate * 100)}%` : '—'}
          accent={kpi.winRate >= 0.5 ? 'good' : 'neutral'}
        />
        <Kpi label="Выиграно" value={kpi.totalWon.toLocaleString('ru-RU')} accent="good" />
        <Kpi label="Проиграно" value={kpi.totalLost.toLocaleString('ru-RU')} accent="bad" />
        <Kpi label="AI-cost" value={fmtUsd(kpi.aiCostUsdTotal)} />
        <Kpi
          label="Tokens in/out"
          value={`${(kpi.aiTokensInTotal / 1000).toFixed(1)}k / ${(kpi.aiTokensOutTotal / 1000).toFixed(1)}k`}
        />
        <Kpi label="Прогонов" value={kpi.runsCount.toLocaleString('ru-RU')} />
        <Kpi label="Средняя длит. прогона" value={fmtMs(kpi.avgRunDurationMs)} />
      </section>

      {/* Воронка */}
      <section className="mb-8">
        <h2 className="text-lg font-semibold text-white mb-3">Воронка</h2>
        <div className="bg-gray-900 border border-gray-800 rounded-lg p-4 overflow-x-auto">
          <table className="w-full text-sm min-w-[360px]">
            <thead className="text-gray-400 text-left">
              <tr>
                <th className="pb-2">Этап</th>
                <th className="pb-2 text-right">Кол-во</th>
                <th className="pb-2 text-right">% от parsed</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800">
              <FunnelRow label="Спарсено" v={funnel.parsed} base={funnel.parsed} />
              <FunnelRow label="Отсеяно pre-filter" v={funnel.filtered} base={funnel.parsed} muted />
              <FunnelRow label="Отсеяно по keyword (HH)" v={funnel.lowScoreKeyword} base={funnel.parsed} muted />
              <FunnelRow label="Отсеяно по AI-score" v={funnel.lowScoreAi} base={funnel.parsed} muted />
              <FunnelRow label="Отправлено уведомление" v={funnel.enqueued} base={funnel.parsed} accent="good" />
              <FunnelRow label="Откликнулся" v={funnel.applied} base={funnel.parsed} accent="good" />
              <FunnelRow label="Выиграл" v={funnel.won} base={funnel.parsed} accent="good" />
            </tbody>
          </table>
        </div>
      </section>

      {/* Графики */}
      <section className="grid md:grid-cols-2 gap-4 mb-8">
        <Card title="Распределение AI-score">
          <ScoreHistogramChart data={stats.scoreHistogram} />
        </Card>
        <Card title="Парсеры — среднее время (30 прогонов)">
          <ParserDurationsChart data={stats.parserDurations} />
        </Card>
        <Card title="Спарсено по источникам (all-time)">
          <ParsedBySourceChart data={stats.parsedBySource} />
        </Card>
      </section>

      {/* По источникам */}
      <section className="mb-8">
        <h2 className="text-lg font-semibold text-white mb-3">По источникам</h2>
        <div className="bg-gray-900 border border-gray-800 rounded-lg p-4 overflow-x-auto">
          <table className="w-full text-sm min-w-[480px]">
            <thead className="text-gray-400 text-left">
              <tr>
                <th className="pb-2">Источник</th>
                <th className="pb-2 text-right">Спарсено</th>
                <th className="pb-2 text-right">Откликов</th>
                <th className="pb-2 text-right">Выигрыш</th>
                <th className="pb-2 text-right">Конверсия parsed→applied</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800">
              {bySource.map((s) => (
                <tr key={s.source}>
                  <td className="py-2 font-mono text-gray-300">{s.source}</td>
                  <td className="py-2 text-right">{s.parsed}</td>
                  <td className="py-2 text-right">{s.applied}</td>
                  <td className="py-2 text-right text-green-400">{s.won}</td>
                  <td className="py-2 text-right text-gray-400">{pct(s.applied, s.parsed)}</td>
                </tr>
              ))}
              {bySource.length === 0 && (
                <tr><td colSpan={5} className="py-4 text-center text-gray-500">Нет данных</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* Прогоны */}
      <section className="mb-4">
        <h2 className="text-lg font-semibold text-white mb-3">Последние прогоны (30)</h2>
        <div className="bg-gray-900 border border-gray-800 rounded-lg p-4 overflow-x-auto">
          <table className="w-full text-sm min-w-[640px]">
            <thead className="text-gray-400 text-left">
              <tr>
                <th className="pb-2">Started</th>
                <th className="pb-2 text-right">Длит.</th>
                <th className="pb-2 text-right">Parsed</th>
                <th className="pb-2 text-right">Enqueued</th>
                <th className="pb-2 text-right">Errors</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800">
              {recentRuns.map((r) => {
                const errs = Object.entries(r.errors);
                const errCount = errs.reduce((a, [, n]) => a + n, 0);
                return (
                  <tr key={r.runId ?? r.startedAt}>
                    <td className="py-2 text-gray-300 font-mono text-xs">
                      {new Date(r.startedAt).toLocaleString('ru-RU')}
                    </td>
                    <td className="py-2 text-right text-gray-400">{fmtMs(r.durationMs)}</td>
                    <td className="py-2 text-right">{r.parsedTotal}</td>
                    <td className="py-2 text-right text-blue-300">{r.enqueued}</td>
                    <td className={`py-2 text-right ${errCount > 0 ? 'text-red-400' : 'text-gray-600'}`}>
                      {errCount > 0
                        ? errs.map(([k, v]) => `${k}:${v}`).join(' ')
                        : '0'}
                    </td>
                  </tr>
                );
              })}
              {recentRuns.length === 0 && (
                <tr><td colSpan={5} className="py-4 text-center text-gray-500">Нет данных</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <p className="text-xs text-gray-600 mt-8">
        Сгенерировано: {new Date(stats.generatedAt).toLocaleString('ru-RU')}
      </p>
    </div>
  );
}

function Kpi({
  label,
  value,
  accent = 'neutral',
}: {
  label: string;
  value: string;
  accent?: 'good' | 'bad' | 'neutral';
}) {
  const valueColor =
    accent === 'good' ? 'text-green-400' : accent === 'bad' ? 'text-red-400' : 'text-white';
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-lg p-3">
      <div className="text-xs text-gray-400 mb-1">{label}</div>
      <div className={`text-xl font-bold ${valueColor}`}>{value}</div>
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-lg p-4">
      <h3 className="text-sm text-gray-400 mb-3">{title}</h3>
      {children}
    </div>
  );
}

function FunnelRow({
  label,
  v,
  base,
  accent,
  muted,
}: {
  label: string;
  v: number;
  base: number;
  accent?: 'good';
  muted?: boolean;
}) {
  const valueColor = accent === 'good' ? 'text-green-400' : muted ? 'text-gray-500' : 'text-white';
  return (
    <tr>
      <td className="py-2 text-gray-300">{label}</td>
      <td className={`py-2 text-right font-mono ${valueColor}`}>{v.toLocaleString('ru-RU')}</td>
      <td className="py-2 text-right text-gray-400 text-xs">{pct(v, base)}</td>
    </tr>
  );
}
