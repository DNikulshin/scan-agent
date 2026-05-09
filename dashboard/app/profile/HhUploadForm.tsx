'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

const MAX_LEN = 256_000;

export function HhUploadForm(): React.ReactElement {
  const router = useRouter();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(): Promise<void> {
    setError(null);
    const trimmed = text.trim();
    if (trimmed.length === 0) {
      setError('Текст пустой');
      return;
    }
    if (trimmed.length > MAX_LEN) {
      setError(`Слишком длинный текст (${trimmed.length} > ${MAX_LEN})`);
      return;
    }

    const apiKey = prompt('Введите DASHBOARD_API_KEY:');
    if (!apiKey) return;

    setBusy(true);
    try {
      const res = await fetch('/api/profile/hh', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({ text: trimmed }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(`Ошибка ${res.status}: ${body.error ?? 'unknown'}`);
        return;
      }
      setText('');
      router.refresh();
    } catch (err) {
      setError(`Сетевая ошибка: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-lg p-4 space-y-3">
      <div>
        <h3 className="text-sm font-semibold text-white mb-1">Загрузить резюме HH</h3>
        <p className="text-xs text-gray-400">
          Скопируй текст резюме (например из текстовой выгрузки HH или прямо со страницы) и вставь сюда.
          Затирает предыдущий снимок при сохранении.
        </p>
      </div>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={10}
        placeholder="Вставь сюда текст резюме…"
        className="w-full bg-black/40 border border-gray-700 rounded p-2 text-sm font-mono text-gray-200 placeholder-gray-600 focus:outline-none focus:border-blue-500"
        spellCheck={false}
      />
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <span className="text-xs text-gray-500">
          {text.length.toLocaleString('ru-RU')} / {MAX_LEN.toLocaleString('ru-RU')} символов
        </span>
        <button
          onClick={handleSubmit}
          disabled={busy || text.trim().length === 0}
          className="px-3 py-1.5 text-sm rounded-md bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-white transition-colors"
        >
          {busy ? '⏳ Сохраняю…' : '💾 Сохранить резюме'}
        </button>
      </div>
      {error && (
        <div className="text-xs text-red-400 bg-red-900/20 border border-red-800 rounded p-2">
          {error}
        </div>
      )}
    </div>
  );
}
