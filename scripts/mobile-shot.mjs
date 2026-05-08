import { chromium, devices } from 'playwright';

const URL = process.argv[2] || 'https://scan.nikulshin-dev.online/stats';
const OUT = process.argv[3] || '/tmp/stats-mobile.png';

const browser = await chromium.launch();
const ctx = await browser.newContext({
  ...devices['iPhone 14'],
  // Authelia: добавим basic-auth заголовок если задан
});
const page = await ctx.newPage();
await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 20000 });
await page.waitForTimeout(2000);
await page.screenshot({ path: OUT, fullPage: true });
const title = await page.title();
const consoleErrors = [];
page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });
console.log(JSON.stringify({ url: page.url(), title, out: OUT, errors: consoleErrors }, null, 2));
await browser.close();
