// GET /api/settings — динамические настройки агента (minScore/minPrice/maxOffers)
// для UI-дефолтов на /. Без auth (за Authelia).
//
// Источник правды — таблица `settings` (Setting в Prisma). Дефолты дублируют
// src/config.ts:filter — синхронизировать вручную при смене там.

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

export const dynamic = 'force-dynamic';

const DEFAULTS = {
  minScore: 7,
  minPrice: 1_000,
  maxOffers: 10,
};

export async function GET() {
  const rows = await prisma.setting.findMany();
  const map = Object.fromEntries(rows.map(r => [r.key, r.value]));

  const minScore = map.minScore ? parseInt(map.minScore, 10) : DEFAULTS.minScore;
  const minPrice = map.minPrice ? parseInt(map.minPrice, 10) : DEFAULTS.minPrice;
  const maxOffers = map.maxOffers ? parseInt(map.maxOffers, 10) : DEFAULTS.maxOffers;

  return NextResponse.json(
    { minScore, minPrice, maxOffers },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
