import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

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
  const rows = await prisma.pushSubscription.findMany({
    select: { endpoint: true, p256dh: true, auth: true },
  });
  return NextResponse.json(rows);
}

// POST /api/push-subscriptions — сохранить подписку из браузера
export async function POST(req: NextRequest) {
  const { endpoint, p256dh, auth } = await req.json();
  await prisma.pushSubscription.upsert({
    where: { endpoint },
    create: { endpoint, p256dh, auth },
    update: { p256dh, auth },
  });
  return NextResponse.json({ ok: true });
}

// DELETE /api/push-subscriptions — удалить устаревшую подписку
export async function DELETE(req: NextRequest) {
  if (!checkAuth(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { endpoint } = await req.json();
  await prisma.pushSubscription.deleteMany({ where: { endpoint } });
  return NextResponse.json({ ok: true });
}
