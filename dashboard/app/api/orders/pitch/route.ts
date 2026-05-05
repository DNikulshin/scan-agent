import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

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
  await prisma.order.update({
    where: { orderId_source: { orderId: order_id, source } },
    data: { hook, pitch },
  });
  return NextResponse.json({ ok: true });
}
