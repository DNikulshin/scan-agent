import type { Order } from '../types';

const TAG_RULES: { tag: string; keywords: string[] }[] = [
  { tag: 'React',      keywords: ['react', 'next.js', 'nextjs'] },
  { tag: 'Vue',        keywords: ['vue.js', 'vuejs', 'nuxt'] },
  { tag: 'Angular',    keywords: ['angular'] },
  { tag: 'Node.js',    keywords: ['node.js', 'nodejs', 'express', 'nest.js', 'nestjs'] },
  { tag: 'Python',     keywords: ['python', 'django', 'fastapi', 'flask'] },
  { tag: 'PHP',        keywords: ['php', 'laravel', 'symfony', 'wordpress', 'bitrix'] },
  { tag: '1C',         keywords: ['1с', '1cv8', '1с-предприятие'] },
  { tag: 'Telegram',   keywords: ['telegram', 'телеграм', 'телеграм-бот', 'telegram bot'] },
  { tag: 'Бот',        keywords: ['чат-бот', 'chatbot', 'tg bot', 'tg-бот'] },
  { tag: 'Mobile',     keywords: ['android', 'ios', 'flutter', 'react native', 'swift', 'kotlin'] },
  { tag: 'AI/ML',      keywords: ['chatgpt', 'нейросет', 'нейронн', 'llm', 'openai', 'машинное обучение'] },
  { tag: 'Парсинг',    keywords: ['парсинг', 'парсер', 'scraping', 'playwright', 'puppeteer', 'selenium'] },
  { tag: 'TypeScript', keywords: ['typescript'] },
];

/**
 * Извлекает теги из заказа на основе ключевых слов.
 * Быстро, бесплатно, без AI.
 */
export function extractTags(order: Order): string[] {
  const content = `${order.title} ${order.desc}`.toLowerCase();
  const tags: string[] = [];

  for (const { tag, keywords } of TAG_RULES) {
    if (keywords.some(kw => content.includes(kw))) {
      tags.push(tag);
    }
  }

  return tags;
}
