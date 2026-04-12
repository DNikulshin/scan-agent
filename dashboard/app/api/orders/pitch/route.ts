import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

function checkAuth(req: NextRequest): boolean {
  const key = process.env.DASHBOARD_API_KEY;
  if (!key) return false;
  return req.headers.get('authorization') === `Bearer ${key}`;
}

// POST /api/orders/pitch — обновить питч (вариант B) от агента
export async function POST(req: NextRequest) {
  if (!checkAuth(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { order_id, source, hook, pitch } = await req.json();
  await db.query(
    `UPDATE orders SET hook = $1, pitch = $2 WHERE order_id = $3 AND source = $4`,
    [hook, pitch, order_id, source],
  );
  return NextResponse.json({ ok: true });
}
