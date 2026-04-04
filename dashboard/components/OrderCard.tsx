'use client';

import { useState } from 'react';
import type { Order } from '@/lib/supabase';

const SOURCE_EMOJI: Record<string, string> = {
  kwork: '🟠',
  fl: '🔵',
  freelanceru: '🟢',
};

const STATUS_STYLES: Record<string, string> = {
  new: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
  applied: 'bg-green-500/10 text-green-400 border-green-500/20',
  skipped: 'bg-gray-500/10 text-gray-500 border-gray-500/20',
};

const STATUS_LABEL: Record<string, string> = {
  new: 'Новый',
  applied: 'Откликнулся',
  skipped: 'Пропущен',
};

export function OrderCard({ order, onStatusUpdate }: { order: Order; onStatusUpdate?: (id: string, status: 'applied' | 'skipped' | 'new') => void }) {
  try {
    const [open, setOpen] = useState(false);
    const [pending, setPending] = useState(false);
    const score = typeof order.score === 'number' ? order.score : 0;
    const stars = '⭐'.repeat(Math.min(Math.round(score / 2), 5));

  async function handleStatus(status: 'applied' | 'skipped' | 'new') {
    setPending(true);
    if (onStatusUpdate) {
      onStatusUpdate(order.id, status);
    }
    setPending(false);
  }

  const isSkipped = order.status === 'skipped';

  return (
    <div className={`rounded-xl border p-5 flex flex-col gap-3 transition-opacity ${
      isSkipped ? 'opacity-40 border-gray-800' : 'border-gray-800 bg-gray-900'
    }`}>
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-1 min-w-0">
          <a
            href={typeof order.link === 'string' ? order.link : '#'}
            target="_blank"
            rel="noopener noreferrer"
            className="font-semibold text-white hover:text-blue-400 transition-colors leading-tight"
          >
            {typeof order.title === 'string' ? order.title : 'Заголовок неизвестен'}
          </a>
          <div className="flex flex-wrap items-center gap-2 text-sm text-gray-400">
            <span>{SOURCE_EMOJI[typeof order.source === 'string' ? order.source : ''] ?? '⚪'} {typeof order.source === 'string' ? order.source : 'Источник неизвестен'}</span>
            <span>·</span>
            <span>💰 {typeof order.price === 'string' ? order.price : 'Цена неизвестна'}</span>
            <span>·</span>
            <span>📊 {typeof order.offers_count === 'number' ? order.offers_count : 0} откликов</span>
            <span>·</span>
            <span>{(() => {
              try {
                return new Date(order.created_at).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
              } catch {
                return 'Дата неизвестна';
              }
            })()}</span>
          </div>
        </div>
        <div className="flex flex-col items-end gap-2 shrink-0">
          <span className="text-lg font-bold text-white whitespace-nowrap">{stars} {order.score}/10</span>
          <span className={`text-xs px-2 py-0.5 rounded-full border ${STATUS_STYLES[order.status]}`}>
            {STATUS_LABEL[order.status]}
          </span>
        </div>
      </div>

      {/* Reason */}
      <p className="text-sm text-gray-400 leading-relaxed">
        {typeof order.reason === 'string' ? order.reason : 'Причина не доступна'}
      </p>

      {/* Pitch toggle */}
      <button
        onClick={() => setOpen(v => !v)}
        className="text-sm text-blue-400 hover:text-blue-300 text-left transition-colors"
      >
        {open ? '▲ Скрыть отклик' : '▼ Показать отклик'}
      </button>

      {open && (
        <div className="rounded-lg bg-gray-800 p-4 text-sm text-gray-200 leading-relaxed whitespace-pre-wrap select-all cursor-copy border border-gray-700">
          <p className="italic text-gray-400 mb-2">
            {typeof order.hook === 'string' ? order.hook : 'Hook не доступен'}
          </p>
          {typeof order.pitch === 'string' ? order.pitch : 'Pitch не доступен'}
        </div>
      )}

      {/* Actions */}
      {!isSkipped && (
        <div className="flex gap-2 pt-1">
          {order.status !== 'applied' && (
            <button
              onClick={() => handleStatus('applied')}
              disabled={pending}
              className="text-sm px-3 py-1.5 rounded-lg bg-green-600 hover:bg-green-500 disabled:opacity-50 transition-colors font-medium"
            >
              ✅ Откликнулся
            </button>
          )}
          {order.status !== 'skipped' && (
            <button
              onClick={() => handleStatus('skipped')}
              disabled={pending}
              className="text-sm px-3 py-1.5 rounded-lg bg-gray-700 hover:bg-gray-600 disabled:opacity-50 transition-colors"
            >
              ⏭ Пропустить
            </button>
          )}
          {order.status === 'applied' && (
            <button
              onClick={() => handleStatus('new')}
              disabled={pending}
              className="text-sm px-3 py-1.5 rounded-lg bg-gray-700 hover:bg-gray-600 disabled:opacity-50 transition-colors"
            >
              ↩ Сбросить
            </button>
          )}
        </div>
      )}
    </div>
  );
  } catch (err) {
    console.error('Error rendering OrderCard:', err, order);
    return (
      <div className="rounded-xl border p-5 border-gray-800 bg-gray-900 text-red-400">
        Ошибка отображения заказа
      </div>
    );
  }
}
