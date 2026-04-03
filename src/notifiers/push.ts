import webpush from 'web-push';
import { createClient } from '@supabase/supabase-js';
import { config } from '../config';
import { logger } from '../utils/logger';

const supabase = createClient(
  config.supabase.url,
  config.supabase.anonKey,
);

webpush.setVapidDetails(
  config.push.vapid.subject,
  config.push.vapid.publicKey,
  config.push.vapid.privateKey,
);

export class PushNotifier {
  async send(subscription: any, payload: any) {
    try {
      await webpush.sendNotification(subscription, JSON.stringify(payload));
      logger.info('Push notification sent');
    } catch (error) {
      logger.error({ error }, 'Failed to send push notification');
    }
  }

  async sendToAll(payload: any) {
    const { data: subscriptions } = await supabase
      .from('push_subscriptions')
      .select('*');

    if (subscriptions) {
      for (const sub of subscriptions) {
        const subscription = {
          endpoint: sub.endpoint,
          keys: {
            p256dh: sub.p256dh,
            auth: sub.auth,
          },
        };
        await this.send(subscription, payload);
      }
    }
  }
}