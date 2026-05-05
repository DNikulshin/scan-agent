import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma, serializeOrder } from '@/lib/db';

function checkAuth(req: NextRequest): boolean {
  const key = process.env.DASHBOARD_API_KEY;
  if (!key) return false;
  return req.headers.get('authorization') === `Bearer ${key}`;
}

// GET /api/orders — список заказов с фильтрами (для дашборда)
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const status = searchParams.get('status');
  const source = searchParams.get('source');
  const minScore = searchParams.get('minScore');

  const where: Prisma.OrderWhereInput = {};
  if (status) where.status = status;
  if (source) where.source = source;
  if (minScore) where.score = { gte: Number(minScore) };

  const rows = await prisma.order.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: 100,
  });
  return NextResponse.json(rows.map(serializeOrder));
}

// POST /api/orders — сохранить заказ от агента (требует API-ключ)
export async function POST(req: NextRequest) {
  if (!checkAuth(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const b = await req.json();
  const data = {
    orderId: b.order_id,
    source: b.source,
    title: b.title ?? '',
    description: b.description ?? '',
    price: b.price ?? '',
    link: b.link ?? '',
    offersCount: b.offers_count ?? 0,
    score: b.score ?? 0,
    reason: b.reason ?? '',
    hook: b.hook ?? '',
    pitch: b.pitch ?? '',
    tags: b.tags ?? '',
    employer: b.employer ?? null,
    city: b.city ?? null,
  };

  await prisma.order.upsert({
    where: { orderId_source: { orderId: data.orderId, source: data.source } },
    create: { ...data, status: 'new' },
    update: {
      score: data.score,
      reason: data.reason,
      hook: data.hook,
      pitch: data.pitch,
      tags: data.tags,
      employer: data.employer,
      city: data.city,
    },
  });
  return NextResponse.json({ ok: true });
}

// PATCH /api/orders — обновить статус / outcome (из браузера, без авторизации)
export async function PATCH(req: NextRequest) {
  const { id, ...fields } = (await req.json()) as Record<string, unknown>;
  if (!id || typeof id !== 'string') {
    return NextResponse.json({ error: 'id required' }, { status: 400 });
  }

  const data: Prisma.OrderUpdateInput = {};
  if (typeof fields.status === 'string') data.status = fields.status;
  if (typeof fields.outcome === 'string') data.outcome = fields.outcome;
  if ('applied_at' in fields) {
    const v = fields.applied_at;
    data.appliedAt = v == null ? null : new Date(v as string);
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: 'no valid fields' }, { status: 400 });
  }

  await prisma.order.update({ where: { id }, data });
  return NextResponse.json({ ok: true });
}
