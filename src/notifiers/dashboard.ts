import axios from 'axios';
import { config } from '../config';
import { logger } from '../utils/logger';
import type { ScoredOrder, Notifier } from '../types';

/**
 * Dashboard-нотифайер — сохраняет заказ через HTTP API дашборда на VPS.
 * Активен только если задан DASHBOARD_URL и DASHBOARD_API_KEY.
 */
export class DashboardNotifier implements Notifier {
  name = 'dashboard';

  get enabled(): boolean {
    return !!config.dashboard.url && !!config.dashboard.apiKey;
  }

  private get headers() {
    return {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.dashboard.apiKey}`,
    };
  }

  async send(scored: ScoredOrder): Promise<void> {
    if (!this.enabled) return;

    const { order, score, pitch } = scored;

    await axios.post(`${config.dashboard.url}/api/orders`, {
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
      employer: order.meta?.employer ?? null,
      city: order.meta?.city ?? null,
    }, { headers: this.headers });

    logger.info({ orderId: order.id, source: order.source }, 'Сохранено в Dashboard');
  }

  async updatePitch(orderId: string, source: string, hook: string, pitch: string): Promise<void> {
    if (!this.enabled) return;

    await axios.post(`${config.dashboard.url}/api/orders/pitch`, {
      order_id: orderId,
      source,
      hook,
      pitch,
    }, { headers: this.headers });

    logger.info({ orderId, source }, 'Питч обновлён в Dashboard (вариант B)');
  }
}
