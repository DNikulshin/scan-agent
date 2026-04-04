'use client';

import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { createClient } from '@supabase/supabase-js';
import { OrderCard } from '@/components/OrderCard';
import type { Order } from '@/lib/supabase';
import dynamic from 'next/dynamic';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
);

type FilterStatus = 'all' | 'new' | 'applied' | 'skipped';
type FilterSource = 'all' | 'kwork' | 'fl' | 'freelanceru';

function PageComponent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();

  const status = (searchParams.get('status') ?? 'all') as FilterStatus;
  const source = (searchParams.get('source') ?? 'all') as FilterSource;
  const minScore = parseInt(searchParams.get('minScore') ?? '0', 10);
  const activeTag = searchParams.get('tag') ?? '';

  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    applied: false,
    skipped: false,
  });

  const { data: orders, isLoading, error } = useQuery({
    queryKey: ['orders', status, source, minScore, activeTag],
    queryFn: async () => {
      let query = supabase
        .from('orders')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(100);

      if (status !== 'all') query = query.eq('status', status);
      if (source !== 'all') query = query.eq('source', source);
      if (minScore > 0) query = query.gte('score', minScore);

      const { data, error } = await query;
      if (error) throw error;
      return data as Order[];
    },
  });

  const updateStatusMutation = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: 'applied' | 'skipped' | 'new' }) => {
      const { error } = await supabase
        .from('orders')
        .update({ status })
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['orders'] });
    },
  });

  const updateFilter = (key: string, value: string) => {
    const params = new URLSearchParams(searchParams.toString());
    if (value === 'all') {
      params.delete(key);
    } else {
      params.set(key, value);
    }
    router.push(`?${params.toString()}`);
  };

  const toggleSection = (section: string) => {
    setExpandedSections(prev => ({ ...prev, [section]: !prev[section] }));
  };

  const counts = { new: 0, applied: 0, skipped: 0, all: 0 };
  if (orders) {
    orders.forEach(o => {
      counts.all++;
      const s = o.status as FilterStatus;
      if (['new', 'applied', 'skipped'].includes(s)) counts[s]++;
    });
  }

  const filteredByTag = activeTag
    ? orders?.filter(o => o.tags?.split(',').includes(activeTag))
    : orders;

  // Группировка заказов
  const groupedOrders = {
    new:     filteredByTag?.filter(o => o.status === 'new')     || [],
    applied: filteredByTag?.filter(o => o.status === 'applied') || [],
    skipped: filteredByTag?.filter(o => o.status === 'skipped') || [],
  };

  if (isLoading) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-8">
        <div className="text-center text-gray-400">Загрузка...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-8">
        <div className="text-center text-red-400">Ошибка: {(error as Error).message}</div>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-8">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-white mb-1">🔍 ScanAgent</h1>
        <p className="text-gray-400 text-sm">Заказы с фриланс-бирж · обновляется каждые 30 мин</p>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-6">
        {/* Status tabs */}
        <div className="flex gap-1 bg-gray-900 rounded-lg p-1 border border-gray-800">
          {(['all', 'new', 'applied', 'skipped'] as FilterStatus[]).map(s => (
            <FilterButton key={s} value={s} current={status} onClick={() => updateFilter('status', s)}
              label={{ all: 'Все', new: 'Новые', applied: 'Откликнулся', skipped: 'Пропущены' }[s]}
            />
          ))}
        </div>

        {/* Source filter */}
        <select
          value={source}
          onChange={e => updateFilter('source', e.target.value)}
          className="px-3 py-1.5 text-sm bg-gray-900 border border-gray-800 rounded-md text-white"
        >
          <option value="all">Все источники</option>
          <option value="kwork">Kwork</option>
          <option value="fl">FL.ru</option>
          <option value="freelanceru">Freelance.ru</option>
        </select>

        {/* Min score */}
        <select
          value={minScore || '0'}
          onChange={e => updateFilter('minScore', e.target.value === '0' ? 'all' : e.target.value)}
          className="px-3 py-1.5 text-sm bg-gray-900 border border-gray-800 rounded-md text-white"
        >
          <option value="0">Любой балл</option>
          <option value="5">≥ 5</option>
          <option value="6">≥ 6</option>
          <option value="7">≥ 7</option>
          <option value="8">≥ 8</option>
          <option value="9">≥ 9</option>
        </select>
      </div>

      {/* Tag filter */}
      {(() => {
        const allTags = Array.from(new Set(
          (orders ?? []).flatMap(o => o.tags?.split(',').filter(Boolean) ?? [])
        )).sort();
        if (allTags.length === 0) return null;
        return (
          <div className="flex flex-wrap gap-2 mb-6">
            {activeTag && (
              <button
                onClick={() => updateFilter('tag', 'all')}
                className="px-2.5 py-1 rounded-full text-xs font-medium bg-blue-600 text-white"
              >
                ✕ {activeTag}
              </button>
            )}
            {allTags.filter(t => t !== activeTag).map(tag => (
              <button
                key={tag}
                onClick={() => updateFilter('tag', tag)}
                className="px-2.5 py-1 rounded-full text-xs font-medium bg-gray-800 text-gray-400 border border-gray-700 hover:border-gray-500 hover:text-white transition-colors"
              >
                {tag}
              </button>
            ))}
          </div>
        );
      })()}

      {/* Orders */}
      <div className="space-y-6">
        {/* Новые заказы всегда сверху */}
        {groupedOrders.new.length > 0 && (
          <div>
            <h2 className="text-lg font-semibold text-white mb-4">🆕 Новые ({groupedOrders.new.length})</h2>
            <div className="space-y-4">
              {groupedOrders.new.map(order => (
                <OrderCard key={order.id} order={order} onStatusUpdate={(id, status) => updateStatusMutation.mutate({ id, status })} />
              ))}
            </div>
          </div>
        )}

        {/* Откликнулся - свернутая секция */}
        {groupedOrders.applied.length > 0 && (
          <div>
            <button
              onClick={() => toggleSection('applied')}
              className="w-full text-left text-lg font-semibold text-green-400 mb-4 flex items-center gap-2"
            >
              {expandedSections.applied ? '▼' : '▶'} ✅ Откликнулся ({groupedOrders.applied.length})
            </button>
            {expandedSections.applied && (
              <div className="space-y-4">
                {groupedOrders.applied.map(order => (
                  <OrderCard key={order.id} order={order} onStatusUpdate={(id, status) => updateStatusMutation.mutate({ id, status })} />
                ))}
              </div>
            )}
          </div>
        )}

        {/* Пропущены - свернутая секция */}
        {groupedOrders.skipped.length > 0 && (
          <div>
            <button
              onClick={() => toggleSection('skipped')}
              className="w-full text-left text-lg font-semibold text-gray-400 mb-4 flex items-center gap-2"
            >
              {expandedSections.skipped ? '▼' : '▶'} ⏭ Пропущены ({groupedOrders.skipped.length})
            </button>
            {expandedSections.skipped && (
              <div className="space-y-4">
                {groupedOrders.skipped.map(order => (
                  <OrderCard key={order.id} order={order} onStatusUpdate={(id, status) => updateStatusMutation.mutate({ id, status })} />
                ))}
              </div>
            )}
          </div>
        )}

        {orders?.length === 0 && (
          <div className="text-center text-gray-400">Нет заказов</div>
        )}
      </div>
    </div>
  );
}

function FilterButton({
  value, current, onClick, label,
}: {
  value: string; current: string; onClick: () => void; label: string;
}) {
  const isActive = value === current;
  return (
    <button
      onClick={onClick}
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

export default dynamic(() => Promise.resolve(PageComponent), { ssr: false });
