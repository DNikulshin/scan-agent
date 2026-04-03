import { createClient } from '@supabase/supabase-js';
import { OrderCard } from '@/components/OrderCard';
import type { Order } from '@/lib/supabase';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
);

type FilterStatus = 'all' | 'new' | 'applied' | 'skipped';
type FilterSource = 'all' | 'kwork' | 'fl' | 'freelanceru';

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; source?: string; minScore?: string }>;
}) {
  const params = await searchParams;
  const status = (params.status ?? 'all') as FilterStatus;
  const source = (params.source ?? 'all') as FilterSource;
  const minScore = parseInt(params.minScore ?? '0', 10);

  let query = supabase
    .from('orders')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(100);

  if (status !== 'all') query = query.eq('status', status);
  if (source !== 'all') query = query.eq('source', source);
  if (minScore > 0) query = query.gte('score', minScore);

  const { data: orders, error } = await query;

  const counts = {
    new: 0, applied: 0, skipped: 0, all: 0,
  };
  if (orders) {
    orders.forEach(o => {
      counts.all++;
      counts[o.status as FilterStatus]++;
    });
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-8">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-white mb-1">🔍 ScanAgent</h1>
        <p className="text-gray-400 text-sm">Заказы с фриланс-бирж · обновляется каждые 30 мин</p>
      </div>

      {/* Filters */}
      <form className="flex flex-wrap gap-3 mb-6">
        {/* Status tabs */}
        <div className="flex gap-1 bg-gray-900 rounded-lg p-1 border border-gray-800">
          {(['all', 'new', 'applied', 'skipped'] as FilterStatus[]).map(s => (
            <FilterButton key={s} name="status" value={s} current={status}
              label={{ all: 'Все', new: 'Новые', applied: 'Откликнулся', skipped: 'Пропущены' }[s]}
            />
          ))}
        </div>

        {/* Source */}
        <div className="flex gap-1 bg-gray-900 rounded-lg p-1 border border-gray-800">
          {(['all', 'kwork', 'fl', 'freelanceru'] as FilterSource[]).map(s => (
            <FilterButton key={s} name="source" value={s} current={source}
              label={{ all: 'Все биржи', kwork: 'Kwork', fl: 'FL.ru', freelanceru: 'Freelance.ru' }[s]}
            />
          ))}
        </div>

        {/* Min score */}
        <div className="flex gap-1 bg-gray-900 rounded-lg p-1 border border-gray-800">
          {[0, 7, 8, 9].map(s => (
            <FilterButton key={s} name="minScore" value={String(s)} current={String(minScore)}
              label={s === 0 ? 'Все оценки' : `≥${s}⭐`}
            />
          ))}
        </div>
      </form>

      {/* Error */}
      {error && (
        <div className="rounded-lg bg-red-900/30 border border-red-800 p-4 text-red-400 mb-6 text-sm">
          Ошибка загрузки: {error.message}
        </div>
      )}

      {/* Stats */}
      <div className="flex gap-4 text-sm text-gray-500 mb-4">
        <span>Показано: <b className="text-white">{orders?.length ?? 0}</b></span>
        <span>Новых: <b className="text-blue-400">{counts.new}</b></span>
        <span>Откликнулся: <b className="text-green-400">{counts.applied}</b></span>
      </div>

      {/* Orders */}
      <div className="flex flex-col gap-4">
        {orders?.length === 0 && (
          <p className="text-gray-500 text-center py-16">Заказов не найдено</p>
        )}
        {orders?.map(order => (
          <OrderCard key={order.id} order={order as Order} />
        ))}
      </div>
    </div>
  );
}

function FilterButton({
  name, value, current, label,
}: {
  name: string; value: string; current: string; label: string;
}) {
  const isActive = value === current;
  return (
    <button
      type="submit"
      name={name}
      value={value}
      className={`px-3 py-1 rounded-md text-sm font-medium transition-colors ${
        isActive
          ? 'bg-blue-600 text-white'
          : 'text-gray-400 hover:text-white hover:bg-gray-800'
      }`}
    >
      {label}
    </button>
  );
}
