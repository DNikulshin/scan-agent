'use client';

import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';

// Подписывается на /api/orders/stream (SSE → pg_notify('order_new')) и при
// каждом event'е инвалидирует TanStack-кеш заказов. Push при этом всё равно
// уходит — для других девайсов и закрытых вкладок.
//
// Авто-reconnect с экспоненциальным backoff (1s → 30s) на случай разрыва
// соединения (например, dashboard рестарт).
export function RealtimeOrdersListener() {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (typeof window === 'undefined' || typeof EventSource === 'undefined') {
      return;
    }

    let stopped = false;
    let es: EventSource | null = null;
    let retryDelay = 1000;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    const connect = () => {
      if (stopped) return;
      es = new EventSource('/api/orders/stream');

      es.addEventListener('order_new', () => {
        queryClient.invalidateQueries({ queryKey: ['orders'] });
      });

      es.addEventListener('ready', () => {
        retryDelay = 1000;
      });

      es.onerror = () => {
        es?.close();
        es = null;
        if (stopped) return;
        retryTimer = setTimeout(connect, retryDelay);
        retryDelay = Math.min(retryDelay * 2, 30_000);
      };
    };

    connect();

    return () => {
      stopped = true;
      if (retryTimer) clearTimeout(retryTimer);
      es?.close();
      es = null;
    };
  }, [queryClient]);

  return null;
}
