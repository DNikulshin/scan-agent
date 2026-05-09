// POST /api/profile/hh — ручная заливка текста резюме HH.
// Bearer DASHBOARD_API_KEY (паттерн как у /api/profile/refresh).
// Тело: { text: string }. Создаёт ProfileSnapshot(source='hh', payload.rawText).

import { NextRequest, NextResponse } from 'next/server';
import { ProfileSource } from '@prisma/client';
import { prisma } from '@/lib/db';
import type { HhResumePayload } from '@/lib/profile-types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_LEN = 256_000;

export async function POST(req: NextRequest): Promise<NextResponse> {
  const auth = req.headers.get('authorization') ?? '';
  const expected = `Bearer ${process.env.DASHBOARD_API_KEY ?? ''}`;
  if (!process.env.DASHBOARD_API_KEY || auth !== expected) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid JSON' }, { status: 400 });
  }

  const text = (body as { text?: unknown })?.text;
  if (typeof text !== 'string') {
    return NextResponse.json({ error: 'field "text" must be string' }, { status: 400 });
  }
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    return NextResponse.json({ error: 'text is empty' }, { status: 400 });
  }
  if (trimmed.length > MAX_LEN) {
    return NextResponse.json({ error: `text exceeds ${MAX_LEN} chars` }, { status: 413 });
  }

  const payload: HhResumePayload = { url: 'manual', rawText: trimmed };

  const row = await prisma.profileSnapshot.create({
    data: {
      source: ProfileSource.hh,
      payload: payload as unknown as object,
    },
    select: { id: true, fetchedAt: true },
  });

  return NextResponse.json({
    ok: true,
    id: row.id,
    fetchedAt: row.fetchedAt.toISOString(),
    length: trimmed.length,
  });
}
