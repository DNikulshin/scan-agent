import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { config } from '../config';
import { logger } from '../utils/logger';
import type { ScoredOrder, Notifier } from '../types';

/**
 * Supabase-нотифайер — сохраняет заказ в облачную БД.
 * Активен только если задан SUPABASE_URL.
 */
export class SupabaseNotifier implements Notifier {
  name = 'supabase';
  private client: SupabaseClient | null = null;

  constructor() {
    if (config.supabase.url && config.supabase.anonKey) {
      this.client = createClient(config.supabase.url, config.supabase.anonKey);
    }
  }

  get enabled(): boolean {
    return this.client !== null;
  }

  async send(scored: ScoredOrder): Promise<void> {
    if (!this.client) return;

    const { order, score, pitch } = scored;

    const { error } = await this.client.from('orders').upsert({
      order_id: order.id,
      source: order.source,
      title: order.title,
      description: order.desc,
      price: order.price,
      link: order.link,
      offers_count: order.offersCount,
      score: score.score,
      reason: score.reason,
      hook: pitch.hook,
      pitch: pitch.pitch,
      tags: (scored.tags ?? []).join(','),
      status: 'new',
    }, { onConflict: 'order_id,source' });

    if (error) throw new Error(error.message);

    logger.info({ orderId: order.id, source: order.source }, 'Сохранено в Supabase');
  }

  async updatePitch(orderId: string, source: string, hook: string, pitch: string): Promise<void> {
    if (!this.client) return;
    const { error } = await this.client
      .from('orders')
      .update({ hook, pitch })
      .eq('order_id', orderId)
      .eq('source', source);
    if (error) throw new Error(error.message);
    logger.info({ orderId, source }, 'Питч обновлён в Supabase (вариант B)');
  }
}
