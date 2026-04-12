import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

function checkAuth(req: NextRequest): boolean {
  const key = process.env.DASHBOARD_API_KEY;
  if (!key) return false;
  return req.headers.get('authorization') === `Bearer ${key}`;
}

// POST /api/orders/reset — сброс outcome всех заказов в 'pending'
export async function POST(req: NextRequest) {
  if (!checkAuth(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { confirm } = await req.json();
  if (confirm !== 'RESET') {
    return NextResponse.json({ error: 'Confirmation required' }, { status: 400 });
  }
  const { rowCount } = await db.query(
    `UPDATE orders SET outcome = 'pending' WHERE outcome IN ('won', 'lost')`,
  );
  return NextResponse.json({ ok: true, updated: rowCount });
}
