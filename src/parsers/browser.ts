import { chromium } from 'playwright-extra';
import stealth from 'puppeteer-extra-plugin-stealth';
import type { BrowserContext, Page } from 'playwright';

chromium.use(stealth());

/** Общая конфигурация браузера для всех парсеров */
export async function createBrowser(): Promise<{
  context: BrowserContext;
  close: () => Promise<void>;
}> {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    locale: 'ru-RU',
    viewport: { width: 1920, height: 1080 },
  });

  return {
    context,
    close: () => browser.close(),
  };
}

/**
 * Безопасно извлекает число откликов из текста.
 * Ищет любое число в строке вида "12 ответов", "Предложений: 5", "3 отклика"
 */
export function parseOffersCount(text: string): number {
  const match = text.match(/\d+/);
  return match ? parseInt(match[0], 10) : 999;
}

/**
 * Извлекает ID из URL по паттерну.
 * Если паттерн не сработал — использует хэш URL как fallback ID.
 */
export function extractId(url: string, pattern: RegExp): string {
  const match = url.match(pattern);
  if (match?.[1]) return match[1];
  // Fallback: используем последний сегмент URL
  const segments = url.replace(/\/$/, '').split('/');
  return segments[segments.length - 1] || '';
}

/**
 * Делает скриншот для отладки.
 * Не бросает исключений — если скриншот не удался, это не критично.
 */
export async function debugScreenshot(page: Page, name: string): Promise<void> {
  try {
    await page.screenshot({ path: `debug-${name}.png` });
    console.log(`📸 Скриншот: debug-${name}.png`);
  } catch {
    // не критично
  }
}
