/**
 * Тестовый скрипт для проверки push-уведомлений.
 * Отправляет тестовый пуш на все подписки из Dashboard API.
 * Автоматически удаляет устаревшие подписки (410/404).
 *
 * Запуск: npm run test-push
 */

import 'dotenv/config';
import webpush from 'web-push';
import axios from 'axios';

const VAPID_SUBJECT = process.env.VAPID_SUBJECT ?? 'mailto:admin@example.com';
const VAPID_PUBLIC  = process.env.VAPID_PUBLIC_KEY ?? '';
const VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY ?? '';
const DASHBOARD_URL = (process.env.DASHBOARD_URL ?? '').replace(/\/$/, '');
const DASHBOARD_KEY = process.env.DASHBOARD_API_KEY ?? '';

const missing = [
  !VAPID_PUBLIC   && 'VAPID_PUBLIC_KEY',
  !VAPID_PRIVATE  && 'VAPID_PRIVATE_KEY',
  !DASHBOARD_URL  && 'DASHBOARD_URL',
  !DASHBOARD_KEY  && 'DASHBOARD_API_KEY',
].filter(Boolean);

if (missing.length) {
  console.error('❌ Не заданы переменные окружения:', missing.join(', '));
  process.exit(1);
}

webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);

const headers = { Authorization: `Bearer ${DASHBOARD_KEY}` };

async function deleteSubscription(endpoint: string) {
  try {
    await axios.delete(`${DASHBOARD_URL}/api/push-subscriptions`, {
      headers,
      data: { endpoint },
    });
    console.log('     → удалена из БД');
  } catch {
    console.error('     → не удалось удалить из БД');
  }
}

async function main() {
  console.log(`🔍 Запрашиваю подписки с ${DASHBOARD_URL}/api/push-subscriptions ...`);

  let subscriptions: Array<{ endpoint: string; p256dh: string; auth: string }>;
  try {
    const { data } = await axios.get(`${DASHBOARD_URL}/api/push-subscriptions`, { headers });
    subscriptions = data;
  } catch (err: any) {
    console.error('❌ Не удалось получить подписки:', err.response?.data ?? err.message);
    process.exit(1);
  }

  if (!subscriptions.length) {
    console.warn('⚠️  Подписок нет. Открой https://scan.nikulshin-dev.online/ и нажми "Включить уведомления".');
    process.exit(0);
  }

  console.log(`📋 Найдено подписок: ${subscriptions.length}\n`);

  const payload = {
    title: '✅ ScanAgent — тест',
    body: `Push работает! Время: ${new Date().toLocaleTimeString('ru-RU')}`,
  };

  let ok = 0, stale = 0, fail = 0;

  for (const sub of subscriptions) {
    const short = sub.endpoint.slice(0, 70) + '...';
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        JSON.stringify(payload),
      );
      console.log(`  ✅ Отправлено → ${short}`);
      ok++;
    } catch (err: any) {
      const status = err.statusCode ?? err.status ?? '?';
      if (status === 410 || status === 404) {
        console.error(`  🗑️  Устарела [${status}] → ${short}`);
        await deleteSubscription(sub.endpoint);
        stale++;
      } else {
        console.error(`  ❌ Ошибка [${status}] → ${short}`);
        if (status === 403) {
          console.error('     (подписка создана с другими VAPID-ключами — удали и подпишись заново)');
          await deleteSubscription(sub.endpoint);
          stale++;
        } else {
          fail++;
        }
      }
    }
  }

  console.log(`\n📊 Итог: ${ok} успешно, ${stale} устаревших удалено, ${fail} с ошибкой`);

  if (stale > 0) {
    console.log('\n👉 Открой браузер → https://scan.nikulshin-dev.online/ → "Включить уведомления"');
    console.log('   Затем запусти npm run test-push снова.');
  }
}

main();
