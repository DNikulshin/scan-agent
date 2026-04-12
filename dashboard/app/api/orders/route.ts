import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

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

  const conditions: string[] = [];
  const values: unknown[] = [];
  let i = 1;

  if (status) { conditions.push(`status = $${i++}`); values.push(status); }
  if (source) { conditions.push(`source = $${i++}`); values.push(source); }
  if (minScore) { conditions.push(`score >= $${i++}`); values.push(Number(minScore)); }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const { rows } = await db.query(
    `SELECT * FROM orders ${where} ORDER BY created_at DESC LIMIT 100`,
    values,
  );
  return NextResponse.json(rows);
}

// POST /api/orders — сохранить заказ от агента (требует API-ключ)
export async function POST(req: NextRequest) {
  if (!checkAuth(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const b = await req.json();
  await db.query(
    `INSERT INTO orders
       (order_id, source, title, description, price, link, offers_count, score, reason, hook, pitch, tags, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'new')
     ON CONFLICT (order_id, source) DO UPDATE SET
       score        = EXCLUDED.score,
       reason       = EXCLUDED.reason,
       hook         = EXCLUDED.hook,
       pitch        = EXCLUDED.pitch,
       tags         = EXCLUDED.tags`,
    [b.order_id, b.source, b.title, b.description, b.price, b.link,
     b.offers_count, b.score, b.reason, b.hook, b.pitch, b.tags ?? ''],
  );
  return NextResponse.json({ ok: true });
}

// PATCH /api/orders — обновить статус / outcome (из браузера, без авторизации)
export async function PATCH(req: NextRequest) {
  const { id, ...fields } = await req.json() as Record<string, unknown>;
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

  const allowed = new Set(['status', 'outcome', 'applied_at']);
  const entries = Object.entries(fields).filter(([k]) => allowed.has(k));
  if (!entries.length) return NextResponse.json({ error: 'no valid fields' }, { status: 400 });

  const setClauses = entries.map(([k], idx) => `${k} = $${idx + 2}`).join(', ');
  const values = [id, ...entries.map(([, v]) => v)];
  await db.query(`UPDATE orders SET ${setClauses} WHERE id = $1`, values);
  return NextResponse.json({ ok: true });
}
