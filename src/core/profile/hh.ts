import type { HhExperienceItem } from './types';

/** Текст резюме (rawText, ручная заливка через /profile) → trim + лимит для AI-промпта. */
export function summarizeRawText(text: string, maxChars = 800): string {
  const trimmed = text.trim();
  if (trimmed.length <= maxChars) return trimmed;
  return trimmed.slice(0, maxChars).trimEnd() + '…';
}

export function summarizeHhExperience(experience: HhExperienceItem[], maxChars = 800): string {
  // Переводим таймлайн в компактный текстовый блок для AI-промпта.
  // Используется для legacy-снимков HhResumePayload, у которых есть structured experience[].
  // Новые снимки (ручная заливка) идут через summarizeRawText.
  const lines: string[] = [];
  let used = 0;
  for (const item of experience) {
    const head = `- ${item.period}: ${item.company} — ${item.position}`;
    const body = item.summary ? `\n  ${item.summary}` : '';
    const candidate = head + body;
    if (used + candidate.length > maxChars) break;
    lines.push(candidate);
    used += candidate.length + 1;
  }
  return lines.join('\n');
}
