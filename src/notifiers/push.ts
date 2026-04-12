import axios from 'axios';
import webpush from 'web-push';
import { config } from '../config';
import { logger } from '../utils/logger';

webpush.setVapidDetails(
  config.push.vapid.subject,
  config.push.vapid.publicKey,
  config.push.vapid.privateKey,
);

export class PushNotifier {
  async send(subscription: webpush.PushSubscription, payload: object) {
    try {
      await webpush.sendNotification(subscription, JSON.stringify(payload));
      logger.info('Push notification sent');
    } catch (error) {
      logger.error({ error }, 'Failed to send push notification');
    }
  }

  async sendToAll(payload: object) {
    if (!config.dashboard.url || !config.dashboard.apiKey) return;

    let subscriptions: Array<{ endpoint: string; p256dh: string; auth: string }>;
    try {
      const { data } = await axios.get(`${config.dashboard.url}/api/push-subscriptions`, {
        headers: { 'Authorization': `Bearer ${config.dashboard.apiKey}` },
      });
      subscriptions = data;
    } catch (err) {
      logger.error({ err }, 'Не удалось получить push-подписки');
      return;
    }

    for (const sub of subscriptions) {
      await this.send(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        payload,
      );
    }
  }
}
