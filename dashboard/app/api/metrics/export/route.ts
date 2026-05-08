// GET /api/metrics/export — отдаёт markdown-отчёт со всеми KPI/воронкой/прогонами.
// Без auth — как /api/orders, dashboard за Authelia.

import { getStats, type StatsPayload } from '@/lib/stats';

export const dynamic = 'force-dynamic';

function pct(num: number, den: number): string {
  if (!den) return '—';
  return `${Math.round((num / den) * 100)}%`;
}

function fmtMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function buildMarkdown(s: StatsPayload, generatedAt: Date): string {
  const dateStr = generatedAt.toISOString().slice(0, 10);
  const lines: string[] = [];

  lines.push(`# Scan-agent metrics — all-time (export ${dateStr})`);
  lines.push('');

  // Воронка
  lines.push('## Воронка');
  lines.push('');
  lines.push('| Этап | Кол-во | % от parsed |');
  lines.push('|---|---:|---:|');
  const f = s.funnel;
  const base = f.parsed;
  lines.push(`| Спарсено | ${f.parsed} | 100% |`);
  lines.push(`| Отсеяно pre-filter | ${f.filtered} | ${pct(f.filtered, base)} |`);
  lines.push(`| Отсеяно по keyword (HH) | ${f.lowScoreKeyword} | ${pct(f.lowScoreKeyword, base)} |`);
  lines.push(`| Отсеяно по AI-score | ${f.lowScoreAi} | ${pct(f.lowScoreAi, base)} |`);
  lines.push(`| Уведомлено (enqueued) | ${f.enqueued} | ${pct(f.enqueued, base)} |`);
  lines.push(`| Откликнулся | ${f.applied} | ${pct(f.applied, base)} |`);
  lines.push(`| Выиграл | ${f.won} | ${pct(f.won, base)} |`);
  lines.push('');

  // AI
  lines.push('## AI');
  lines.push('');
  const k = s.kpi;
  lines.push(`- Прогонов: **${k.runsCount}**, средняя длит.: **${fmtMs(k.avgRunDurationMs)}**`);
  lines.push(`- Tokens in/out: **${k.aiTokensInTotal.toLocaleString('en-US')} / ${k.aiTokensOutTotal.toLocaleString('en-US')}**`);
  lines.push(`- Стоимость, USD: **$${k.aiCostUsdTotal.toFixed(4)}**`);
  if (k.totalEnqueued > 0) {
    lines.push(`- Средняя цена обработанного заказа: **$${(k.aiCostUsdTotal / k.totalEnqueued).toFixed(4)}**`);
  }
  lines.push('');

  // Гистограмма
  lines.push('## Качество AI-оценок');
  lines.push('');
  lines.push('| Score | Кол-во |');
  lines.push('|---|---:|');
  for (const [bucket, count] of Object.entries(s.scoreHistogram)) {
    lines.push(`| ${bucket} | ${count} |`);
  }
  lines.push('');

  // По источникам
  lines.push('## По источникам');
  lines.push('');
  lines.push('| Источник | Спарсено | Откликов | Выигрыш | Конверсия |');
  lines.push('|---|---:|---:|---:|---:|');
  for (const row of s.bySource) {
    lines.push(`| ${row.source} | ${row.parsed} | ${row.applied} | ${row.won} | ${pct(row.applied, row.parsed)} |`);
  }
  if (s.bySource.length === 0) {
    lines.push('| _нет данных_ |  |  |  |  |');
  }
  lines.push('');

  // Прогоны
  lines.push('## Прогоны (последние 30)');
  lines.push('');
  lines.push('| Run | Started | Длит. | Parsed | Enqueued | Errors |');
  lines.push('|---|---|---:|---:|---:|---|');
  for (const r of s.recentRuns) {
    const errs = Object.entries(r.errors)
      .map(([k, n]) => `${k}:${n}`)
      .join(' ');
    const runShort = r.runId ? r.runId.slice(0, 8) : '—';
    lines.push(
      `| \`${runShort}\` | ${new Date(r.startedAt).toISOString().replace('T', ' ').slice(0, 19)} ` +
      `| ${fmtMs(r.durationMs)} | ${r.parsedTotal} | ${r.enqueued} | ${errs || '—'} |`,
    );
  }
  if (s.recentRuns.length === 0) {
    lines.push('| _нет прогонов_ |  |  |  |  |  |');
  }
  lines.push('');

  lines.push(`---`);
  lines.push(`_Generated: ${generatedAt.toISOString()}_`);
  lines.push('');

  return lines.join('\n');
}

export async function GET() {
  const stats = await getStats();
  const generatedAt = new Date();
  const md = buildMarkdown(stats, generatedAt);

  const filename = `scan-agent-metrics-${generatedAt.toISOString().slice(0, 10)}.md`;
  return new Response(md, {
    headers: {
      'Content-Type': 'text/markdown; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  });
}
