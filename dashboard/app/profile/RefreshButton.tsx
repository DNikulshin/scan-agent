'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export function RefreshButton(): React.ReactElement {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function handle(): Promise<void> {
    const apiKey = prompt('Введите DASHBOARD_API_KEY:');
    if (!apiKey) return;

    setBusy(true);
    try {
      const res = await fetch('/api/profile/refresh', {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(`Ошибка: ${body.error ?? res.status}`);
        return;
      }
      alert(`Обновлено: ${body.repos} репов, ${body.languages} языков.`);
      router.refresh();
    } catch (err) {
      alert(`Сетевая ошибка: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      onClick={handle}
      disabled={busy}
      className="px-3 py-1.5 text-sm rounded-md bg-green-700 hover:bg-green-600 disabled:opacity-50 text-white transition-colors text-center"
    >
      {busy ? '⏳ Обновляется…' : '🔄 Обновить'}
    </button>
  );
}
