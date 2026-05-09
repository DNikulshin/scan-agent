// GET /api/profile/export — отдаёт MD-снимок профиля. Без auth (за Authelia).

import { NextResponse } from 'next/server';
import { getLatestSnapshot, formatProfileMd } from '@/lib/profile';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(): Promise<NextResponse> {
  const snap = await getLatestSnapshot();
  if (!snap) {
    return new NextResponse('# Нет снимка профиля\n\nЗапусти агента или нажми «Обновить» на /profile.', {
      status: 404,
      headers: { 'Content-Type': 'text/markdown; charset=utf-8' },
    });
  }

  const md = formatProfileMd(snap);
  const dateStr = snap.fetchedAt.slice(0, 10);

  return new NextResponse(md, {
    status: 200,
    headers: {
      'Content-Type': 'text/markdown; charset=utf-8',
      'Content-Disposition': `attachment; filename="profile-${snap.githubLogin}-${dateStr}.md"`,
    },
  });
}
