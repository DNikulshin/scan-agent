// POST /api/profile/refresh — принудительно тащит свежий снимок из GitHub.
// Bearer DASHBOARD_API_KEY (вызывается из /profile UI с client-prompt'ом ключа).

import { NextRequest, NextResponse } from 'next/server';
import { refreshSnapshot } from '@/lib/profile';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest): Promise<NextResponse> {
  const auth = req.headers.get('authorization') ?? '';
  const expected = `Bearer ${process.env.DASHBOARD_API_KEY ?? ''}`;
  if (!process.env.DASHBOARD_API_KEY || auth !== expected) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const login = process.env.GH_PROFILE_LOGIN ?? '';
  if (!login) {
    return NextResponse.json(
      { error: 'GH_PROFILE_LOGIN не задан в env dashboard' },
      { status: 400 },
    );
  }

  try {
    const snap = await refreshSnapshot(login, process.env.GH_PROFILE_TOKEN);
    return NextResponse.json({
      ok: true,
      fetchedAt: snap.fetchedAt,
      repos: snap.repos.length,
      languages: Object.keys(snap.languagesAgg).length,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
