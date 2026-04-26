// ── Твой профиль ──
// Заполни реальными данными — это то, что отличает твой отклик от сотни шаблонных.
// AI будет использовать эту информацию для генерации персонализированных pitch.

export const profile = {
  name: 'Дмитрий',

  /** Главная специализация — одно предложение */
  headline: 'Fullstack-разработчик: Node.js / Next.js / TypeScript, закрываю весь стек от API до мобайла',

  /** Стек технологий */
  stack: [
    // Frontend
    'TypeScript', 'React', 'Next.js', 'Vue.js', 'Nuxt.js', 'Zustand', 'TanStack Query',
    // Backend
    'Node.js', 'NestJS', 'Fastify', 'Prisma', 'PostgreSQL', 'Redis', 'WebSocket', 'REST API',
    // Mobile
    'React Native', 'Expo',
    // Infra
    'Docker', 'GitHub Actions', 'Caddy', 'Cloudflare',
    // AI
    'AI/LLM-агенты', 'OpenAI API', 'Anthropic API',
  ],

  /** Реальные завершённые проекты */
  portfolio: [
    {
      title: 'Система управления корпоративным транспортом',
      result: 'Fastify API + React PWA + Expo-мобайл, real-time GPS-трекинг через Redis/WebSocket',
    },
    {
      title: 'Support Ticketing System — Helpdesk CRM',
      result: 'NestJS + Next.js, ролевая модель (admin/agent/user), файловые вложения, полный цикл обращений',
    },
    {
      title: 'AI-агент для мониторинга фриланс-бирж',
      result: 'Автопарсинг Kwork/FL.ru/Habr, AI-скоринг + генерация питча, Telegram-уведомления, экономит 2+ ч/день',
    },
  ],

  /** Средние сроки */
  typicalTimeline: '1–3 дня для типовых задач, 1–2 недели для полноценного продукта',

  /** Стиль общения */
  communicationStyle: 'Конкретно и по делу, без воды. Сразу к сути.',

  /** Преимущества */
  strengths: [
    'Закрываю весь стек: Node.js/NestJS/Fastify API → React/Next.js/Vue UI → Expo мобайл',
    'Строгий TypeScript, чистая архитектура, продакшн-опыт',
    'Реальные AI-интеграции (OpenAI, Anthropic, OpenRouter) в рабочих проектах',
    'Быстрая коммуникация, ежедневные апдейты по прогрессу',
  ],
};

/**
 * Формирует контекст профиля для промпта.
 * Вызывается в analyzer при генерации pitch.
 */
export function getProfileContext(): string {
  const projects = profile.portfolio
    .map(p => `  • ${p.title} → ${p.result}`)
    .join('\n');

  const strengths = profile.strengths
    .map(s => `  • ${s}`)
    .join('\n');

  return [
    `Имя: ${profile.name}`,
    `Специализация: ${profile.headline}`,
    `Стек: ${profile.stack.join(', ')}`,
    `\nПортфолио:`,
    projects,
    `\nСильные стороны:`,
    strengths,
    `\nСроки: ${profile.typicalTimeline}`,
    `Стиль: ${profile.communicationStyle}`,
  ].join('\n');
}
