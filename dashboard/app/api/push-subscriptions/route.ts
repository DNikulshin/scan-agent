import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

function checkAuth(req: NextRequest): boolean {
  const key = process.env.DASHBOARD_API_KEY;
  if (!key) return false;
  return req.headers.get('authorization') === `Bearer ${key}`;
}

// GET /api/push-subscriptions — список подписок для агента
export async function GET(req: NextRequest) {
  if (!checkAuth(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { rows } = await db.query('SELECT endpoint, p256dh, auth FROM push_subscriptions');
  return NextResponse.json(rows);
}

// POST /api/push-subscriptions — сохранить подписку из браузера
export async function POST(req: NextRequest) {
  const { endpoint, p256dh, auth } = await req.json();
  await db.query(
    `INSERT INTO push_subscriptions (endpoint, p256dh, auth)
     VALUES ($1, $2, $3)
     ON CONFLICT (endpoint) DO UPDATE SET p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth`,
    [endpoint, p256dh, auth],
  );
  return NextResponse.json({ ok: true });
}
