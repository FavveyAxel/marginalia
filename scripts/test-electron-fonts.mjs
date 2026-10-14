// Vérifie que l'app empaquetée liste les polices installées (IPC natif) et que le menu Police les propose.
import { _electron as electron } from 'playwright-core';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const APP_DIR = path.join(ROOT, 'release/Marginalia-darwin-arm64/Marginalia.app/Contents/Resources/app');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'mg-fonts-'));
const app = await electron.launch({
  executablePath: path.join(ROOT, 'node_modules/electron/dist/electron'),
  args: ['--no-sandbox', APP_DIR],
  env: { ...process.env, XDG_CONFIG_HOME: TMP, VITE_DEV_SERVER_URL: '' },
  timeout: 60000,
});
try {
  const page = await app.firstWindow();
  await page.waitForFunction(() => !!window.marginalia, null, { timeout: 30000 });
  const fonts = await page.evaluate(() => window.marginalia.listFonts());
  console.log('polices listées :', fonts.length, fonts.slice(0, 8));
  if (!fonts.length) throw new Error('aucune police');
  console.log('OK');
} finally {
  await app.close();
}
