/**
 * Миграция данных из Supabase → VPS Dashboard
 * Запуск: SUPABASE_URL=... SUPABASE_ANON_KEY=... DASHBOARD_URL=... DASHBOARD_API_KEY=... npx tsx scripts/migrate-from-supabase.ts
 */
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_ANON_KEY!,
);

const DASHBOARD_URL = process.env.DASHBOARD_URL!;
const DASHBOARD_API_KEY = process.env.DASHBOARD_API_KEY!;

const headers = {
  'Content-Type': 'application/json',
  'Authorization': `Bearer ${DASHBOARD_API_KEY}`,
};

async function migrateOrders() {
  console.log('Загружаю заказы из Supabase...');
  const { data: orders, error } = await supabase
    .from('orders')
    .select('*')
    .order('created_at', { ascending: true });

  if (error) throw new Error(`Supabase error: ${error.message}`);
  if (!orders?.length) { console.log('Нет заказов для миграции'); return; }

  console.log(`Найдено ${orders.length} заказов. Загружаю на VPS...`);
  let ok = 0, fail = 0;

  for (const order of orders) {
    try {
      const res = await fetch(`${DASHBOARD_URL}/api/orders`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          order_id: order.order_id,
          source: order.source,
          title: order.title,
          description: order.description ?? '',
          price: order.price ?? '',
          link: order.link ?? '',
          offers_count: order.offers_count ?? 0,
          score: order.score ?? 0,
          reason: order.reason ?? '',
          hook: order.hook ?? '',
          pitch: order.pitch ?? '',
          tags: order.tags ?? '',
        }),
      });

      // Обновить статус и outcome если не 'new'
      if (res.ok && (order.status !== 'new' || order.outcome !== 'pending')) {
        // Получить id вставленной записи
        const check = await fetch(
          `${DASHBOARD_URL}/api/orders?source=${order.source}`,
          { headers }
        );
        const rows = await check.json();
        const inserted = rows.find((r: any) => r.order_id === order.order_id);
        if (inserted) {
          await fetch(`${DASHBOARD_URL}/api/orders`, {
            method: 'PATCH',
            headers,
            body: JSON.stringify({
              id: inserted.id,
              status: order.status,
              outcome: order.outcome,
              applied_at: order.applied_at,
            }),
          });
        }
      }

      ok++;
      process.stdout.write(`\r${ok}/${orders.length} перенесено...`);
    } catch (err) {
      fail++;
      console.error(`\nОшибка для ${order.order_id}:`, err);
    }
  }

  console.log(`\nГотово: ${ok} перенесено, ${fail} ошибок`);
}

async function migratePushSubscriptions() {
  console.log('\nЗагружаю push-подписки из Supabase...');
  const { data: subs, error } = await supabase
    .from('push_subscriptions')
    .select('*');

  if (error) throw new Error(`Supabase error: ${error.message}`);
  if (!subs?.length) { console.log('Нет подписок'); return; }

  console.log(`Найдено ${subs.length} подписок. Загружаю...`);
  for (const sub of subs) {
    await fetch(`${DASHBOARD_URL}/api/push-subscriptions`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ endpoint: sub.endpoint, p256dh: sub.p256dh, auth: sub.auth }),
    });
  }
  console.log('Push-подписки перенесены');
}

(async () => {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY) {
    console.error('Нужны: SUPABASE_URL, SUPABASE_ANON_KEY, DASHBOARD_URL, DASHBOARD_API_KEY');
    process.exit(1);
  }
  await migrateOrders();
  await migratePushSubscriptions();
})().catch(err => { console.error(err); process.exit(1); });
