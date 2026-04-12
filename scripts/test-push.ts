/**
 * Тестовый скрипт для проверки push-уведомлений.
 * Отправляет тестовый пуш на все подписки из Dashboard API.
 *
 * Запуск: npx tsx scripts/test-push.ts
 * Требует: .env с VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, DASHBOARD_URL, DASHBOARD_API_KEY
 */

import 'dotenv/config';
import webpush from 'web-push';
import axios from 'axios';

const VAPID_SUBJECT  = process.env.VAPID_SUBJECT  ?? 'mailto:admin@example.com';
const VAPID_PUBLIC   = process.env.VAPID_PUBLIC_KEY ?? '';
const VAPID_PRIVATE  = process.env.VAPID_PRIVATE_KEY ?? '';
const DASHBOARD_URL  = process.env.DASHBOARD_URL ?? '';
const DASHBOARD_KEY  = process.env.DASHBOARD_API_KEY ?? '';

// ── Проверка конфига ──────────────────────────────────────────────────────────
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

// ── Получить подписки ─────────────────────────────────────────────────────────
console.log(`🔍 Запрашиваю подписки с ${DASHBOARD_URL}/api/push-subscriptions ...`);

let subscriptions: Array<{ endpoint: string; p256dh: string; auth: string }>;

try {
  const { data } = await axios.get(`${DASHBOARD_URL}/api/push-subscriptions`, {
    headers: { Authorization: `Bearer ${DASHBOARD_KEY}` },
  });
  subscriptions = data;
} catch (err: any) {
  console.error('❌ Не удалось получить подписки:', err.response?.data ?? err.message);
  process.exit(1);
}

if (!subscriptions.length) {
  console.warn('⚠️  Подписок нет. Открой https://scan.nikulshin-dev.online/ и нажми "Включить уведомления".');
  process.exit(0);
}

console.log(`📋 Найдено подписок: ${subscriptions.length}`);

// ── Отправить тестовый пуш ────────────────────────────────────────────────────
const payload = {
  title: '✅ ScanAgent — тест',
  body:  `Push работает! Время: ${new Date().toLocaleTimeString('ru-RU')}`,
};

let ok = 0;
let fail = 0;

for (const sub of subscriptions) {
  try {
    await webpush.sendNotification(
      { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
      JSON.stringify(payload),
    );
    console.log(`  ✅ Отправлено → ${sub.endpoint.slice(0, 60)}...`);
    ok++;
  } catch (err: any) {
    const status = err.statusCode ?? err.status ?? '?';
    console.error(`  ❌ Ошибка [${status}] → ${sub.endpoint.slice(0, 60)}...`);
    if (status === 410 || status === 404) {
      console.error('     (подписка устарела, браузер её удалил)');
    }
    fail++;
  }
}

console.log(`\n📊 Итог: ${ok} успешно, ${fail} с ошибкой`);
