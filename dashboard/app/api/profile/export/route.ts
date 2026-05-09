// GET /api/profile/export — отдаёт MD-снимок профиля (все источники). Без auth (за Authelia).

import { NextResponse } from 'next/server';
import { getAllSnapshots, formatProfileMd } from '@/lib/profile';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(): Promise<NextResponse> {
  const all = await getAllSnapshots();
  const hasAny =
    all.github !== null ||
    all.hh !== null ||
    all.fl !== null ||
    all.kwork !== null ||
    all.freelanceru !== null;

  if (!hasAny) {
    return new NextResponse('# Нет снимка профиля\n\nЗапусти агента или нажми «Обновить» на /profile.', {
      status: 404,
      headers: { 'Content-Type': 'text/markdown; charset=utf-8' },
    });
  }

  const md = formatProfileMd(all.github, all);
  const dateStr =
    all.github?.fetchedAt.slice(0, 10) ??
    all.hh?.fetchedAt.slice(0, 10) ??
    all.fl?.fetchedAt.slice(0, 10) ??
    new Date().toISOString().slice(0, 10);
  const slug = all.github?.githubLogin ?? 'profile';

  return new NextResponse(md, {
    status: 200,
    headers: {
      'Content-Type': 'text/markdown; charset=utf-8',
      'Content-Disposition': `attachment; filename="profile-${slug}-${dateStr}.md"`,
    },
  });
}
