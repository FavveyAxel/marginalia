// Rend build/icon.html en build/icon.png (1024 px, fond transparent) avec Chromium (Playwright).
// Usage : node build/make-icon.mjs && python3 build/make-icns.py
import { chromium } from 'playwright-core';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox', '--allow-file-access-from-files'] });
const page = await browser.newPage({ viewport: { width: 1024, height: 1024 } });
await page.goto('file://' + path.join(here, 'icon.html'));
await page.waitForSelector('body[data-ready="1"]');
await page.waitForTimeout(300);
await page.screenshot({ path: path.join(here, 'icon.png'), omitBackground: true, clip: { x: 0, y: 0, width: 1024, height: 1024 } });
await browser.close();
console.log('build/icon.png écrit');
