import type { Page } from 'playwright';
import { createBrowser, debugScreenshot } from '../../parsers/browser';
import { config } from '../../config';

function randomUA(): string {
  const uas = config.fl.userAgents;
  return uas[Math.floor(Math.random() * uas.length)];
}

/**
 * Запускает callback с новой stealth-страницей и гарантированно закрывает браузер.
 * Используется парсерами профилей FL/Kwork/Freelance.ru (которым нужен антибот).
 *
 * Если callback бросает — делаем debug screenshot перед re-throw, чтобы можно было
 * понять, что произошло на проде (cron-инвокация без интерактивной сессии).
 */
export async function withStealthPage<T>(
  label: string,
  fn: (page: Page) => Promise<T>,
): Promise<T> {
  const { context, close } = await createBrowser({ userAgent: randomUA() });
  const page = await context.newPage();
  try {
    return await fn(page);
  } catch (err) {
    await debugScreenshot(page, `profile-${label}`);
    throw err;
  } finally {
    await close();
  }
}
