'use client';

import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { StatsPayload } from '@/lib/stats';

const TICK = { fill: '#9ca3af', fontSize: 12 };
const GRID = { stroke: '#1f2937' };

export function ScoreHistogramChart({ data }: { data: StatsPayload['scoreHistogram'] }) {
  const points = Object.entries(data).map(([bucket, count]) => ({ bucket, count }));
  return (
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={points} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" {...GRID} />
          <XAxis dataKey="bucket" tick={TICK} stroke="#374151" />
          <YAxis tick={TICK} stroke="#374151" allowDecimals={false} />
          <Tooltip
            contentStyle={{ backgroundColor: '#111827', border: '1px solid #374151', color: '#f3f4f6' }}
            cursor={{ fill: '#1f2937' }}
          />
          <Bar dataKey="count" fill="#3b82f6" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function ParserDurationsChart({ data }: { data: StatsPayload['parserDurations'] }) {
  const points = Object.entries(data)
    .map(([source, ms]) => ({ source, ms }))
    .sort((a, b) => b.ms - a.ms);

  if (points.length === 0) {
    return <p className="text-sm text-gray-500">Пока нет данных по парсерам.</p>;
  }

  return (
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={points} layout="vertical" margin={{ top: 10, right: 20, left: 20, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" {...GRID} />
          <XAxis type="number" tick={TICK} stroke="#374151" />
          <YAxis type="category" dataKey="source" tick={TICK} stroke="#374151" width={70} />
          <Tooltip
            formatter={(v) => [`${v} ms`, 'Среднее за 30 прогонов']}
            contentStyle={{ backgroundColor: '#111827', border: '1px solid #374151', color: '#f3f4f6' }}
            cursor={{ fill: '#1f2937' }}
          />
          <Bar dataKey="ms" fill="#10b981" radius={[0, 4, 4, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function ParsedBySourceChart({ data }: { data: StatsPayload['parsedBySource'] }) {
  const points = Object.entries(data)
    .map(([source, n]) => ({ source, n }))
    .sort((a, b) => b.n - a.n);

  if (points.length === 0) {
    return <p className="text-sm text-gray-500">Пока нет данных.</p>;
  }

  return (
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={points} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" {...GRID} />
          <XAxis dataKey="source" tick={TICK} stroke="#374151" />
          <YAxis tick={TICK} stroke="#374151" allowDecimals={false} />
          <Tooltip
            contentStyle={{ backgroundColor: '#111827', border: '1px solid #374151', color: '#f3f4f6' }}
            cursor={{ fill: '#1f2937' }}
          />
          <Bar dataKey="n" fill="#a855f7" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
