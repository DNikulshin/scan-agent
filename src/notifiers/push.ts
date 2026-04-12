import axios from 'axios';
import webpush from 'web-push';
import { config } from '../config';
import { logger } from '../utils/logger';

webpush.setVapidDetails(
  config.push.vapid.subject,
  config.push.vapid.publicKey,
  config.push.vapid.privateKey,
);

const headers = { Authorization: `Bearer ${config.dashboard.apiKey}` };
const baseUrl = config.dashboard.url.replace(/\/$/, '');

async function deleteSubscription(endpoint: string) {
  try {
    await axios.delete(`${baseUrl}/api/push-subscriptions`, {
      headers,
      data: { endpoint },
    });
    logger.info({ endpoint }, 'Удалена устаревшая push-подписка');
  } catch (err) {
    logger.warn({ err, endpoint }, 'Не удалось удалить push-подписку');
  }
}

export class PushNotifier {
  async send(subscription: webpush.PushSubscription, payload: object): Promise<boolean> {
    try {
      await webpush.sendNotification(subscription, JSON.stringify(payload));
      logger.info('Push notification sent');
      return true;
    } catch (error: any) {
      const status = error.statusCode ?? error.status;
      if (status === 410 || status === 404 || status === 403) {
        await deleteSubscription(subscription.endpoint);
      } else {
        logger.error({ error }, 'Failed to send push notification');
      }
      return false;
    }
  }

  async sendToAll(payload: object) {
    if (!baseUrl || !config.dashboard.apiKey) return;

    let subscriptions: Array<{ endpoint: string; p256dh: string; auth: string }>;
    try {
      const { data } = await axios.get(`${baseUrl}/api/push-subscriptions`, { headers });
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
