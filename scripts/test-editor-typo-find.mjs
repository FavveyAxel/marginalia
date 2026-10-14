// Tests typographie française + rechercher/remplacer du module Écrire — port 5311.
// Lancer : timeout 300 node scripts/test-editor-typo-find.mjs
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import os from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const PORT = 5311;
const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'OK  ' : 'ÉCHEC'} ${name}${detail ? ' — ' + detail : ''}`);
}
const vis = (s) => s.replace(/ /g, '⍽').replace(/ /g, '␣');

const server = await createServer({ root: ROOT, cacheDir: path.join(os.tmpdir(), `marginalia-vite-${PORT}`), server: { port: PORT, strictPort: true }, logLevel: 'error' });
await server.listen();
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message + (process.env.STACK ? ' ' + String(e.stack).slice(0, 900) : '')));
page.on('console', (m) => m.type() === 'error' && errors.push('console: ' + m.text()));
try {
  await page.goto(`http://localhost:${PORT}/`);
  await page.waitForFunction(() => window.__store && window.__store.getState().ready, null, { timeout: 60000 });
  const d = await page.evaluate(async () => {
    const m = await import('/src/features/editor/api.ts');
    return m.createDraft({ title: 'Test typo', html: '<p>Début</p>' });
  });
  await page.evaluate((id) => window.__store.getState().navigate({ name: 'write', draftId: id }), d.id);
  await page.waitForFunction(() => window.__ed && window.__ed.engine() && document.querySelector('.ed-engine-in'), null, { timeout: 60000 });
  await page.waitForTimeout(1800); // laisse le temps à l'installation du plugin (1 s)
  const text = () => page.evaluate(() => window.__ed.engine().plainText());
  const lastPara = async () => {
    const t = (await text()).split('\n').filter((x) => x !== '');
    return t[t.length - 1] ?? '';
  };
  const newPara = async () => {
    // Le curseur doit être dans un NOUVEAU paragraphe vide (machine chargée : on revérifie).
    for (let i = 0; i < 4; i++) {
      const n0 = (await text()).split('\n').length;
      await page.evaluate(() => window.__ed.engine().focus());
      await page.waitForTimeout(200);
      await page.keyboard.press('Control+End');
      await page.keyboard.press('Enter');
      await page.waitForTimeout(150);
      if ((await text()).split('\n').length > n0) return;
    }
  };
  const type = async (s, delay = 12) => page.keyboard.type(s, { delay });

  // ── Typographie ──
  await newPara();
  await type('Bonjour !');
  check('espace fine insécable avant « ! » (espace tapée)', (await lastPara()) === 'Bonjour !', vis(await lastPara()));
  await newPara();
  await type('Vraiment?');
  check('insertion automatique avant « ? » (sans espace)', (await lastPara()) === 'Vraiment ?', vis(await lastPara()));
  await newPara();
  await type('Voici : un;deux');
  check('insécable avant « : », fine avant « ; »', (await lastPara()) === 'Voici : un ;deux', vis(await lastPara()));
  await newPara();
  await type('Il dit "bonjour" ok');
  check('guillemets « » avec insécables', (await lastPara()) === 'Il dit « bonjour » ok', vis(await lastPara()));
  await newPara();
  await type("l'été d'hier");
  check('apostrophe typographique', (await lastPara()) === 'l’été d’hier', await lastPara());
  await newPara();
  await type('Alors... bon -- non');
  check('… et –', (await lastPara()) === 'Alors… bon – non', await lastPara());
  await newPara();
  await type('-- Salut');
  check('espace insécable après le tiret de dialogue', (await lastPara()) === '– Salut', vis(await lastPara()));
  await newPara();
  await type('Voir https://exemple.fr/a?b=1&c=2 ou http://x.fr/it\'s...');
  check('URL non touchées', (await lastPara()) === "Voir https://exemple.fr/a?b=1&c=2 ou http://x.fr/it's...", vis(await lastPara()));
  await newPara();
  await type('Il est 12:30');
  check('heure 12:30 non touchée', (await lastPara()) === 'Il est 12:30', vis(await lastPara()));

  // Annulation : ⌘Z juste après une correction n'annule que la correction
  await newPara();
  await type('Fin...');
  const before = await lastPara();
  await page.keyboard.press('Control+z');
  const after = await lastPara();
  check('Cmd+Z annule la correction seulement', before === 'Fin…' && after === 'Fin...', `${before} -> ${after}`);
  await newPara();
  await type('Hé !');
  await page.keyboard.press('Control+z');
  check('Cmd+Z sur espace fine : le « ! » reste', (await lastPara()) === 'Hé !', vis(await lastPara()));

  // Interrupteur
  const btn = page.locator('[data-tb="typo"]');
  check('interrupteur présent et actif', (await btn.count()) === 1 && (await btn.getAttribute('aria-pressed')) === 'true');
  await btn.click();
  await newPara();
  await type('Off !...');
  check('interrupteur désactivé : texte inchangé', (await lastPara()) === 'Off !...', vis(await lastPara()));
  check('préférence persistée', (await page.evaluate(() => localStorage.getItem('marginalia.ed.frTypography'))) === '0');
  await btn.click();

  // ── Rechercher / remplacer ──
  await newPara();
  await type('le chat et le chien. Le Chat, CHAT, école ecole Ecole, chatte, chat-bot.', 2);
  await page.evaluate(() => window.__ed.engine().focus());
  await page.keyboard.press('Control+f');
  await page.waitForSelector('[data-find="bar"]');
  check('⌘F ouvre la barre (sans champ remplacer)', (await page.locator('[data-find="replacement"]').count()) === 0);
  await page.fill('[data-find="query"]', 'chat');
  await page.waitForTimeout(400);
  const count = () => page.locator('[data-find="count"]').innerText();
  check('compteur « 1 sur N » (insensible à la casse)', /^1 sur 5$/.test(await count()), await count());
  const hl = await page.evaluate(() => document.querySelectorAll('.ProseMirror-search-match, .ProseMirror-active-search-match').length);
  check('toutes les occurrences surlignées', hl >= 5, String(hl));
  await page.keyboard.press('Enter');
  await page.waitForTimeout(200);
  check('Entrée : occurrence suivante', /^2 sur 5$/.test(await count()), await count());
  check('le focus reste dans le champ', await page.evaluate(() => document.activeElement?.getAttribute('data-find') === 'query'));
  await page.keyboard.press('Shift+Enter');
  await page.keyboard.press('Shift+Enter');
  await page.waitForTimeout(200);
  check('Maj+Entrée : précédente (boucle)', /^5 sur 5$/.test(await count()), await count());
  await page.click('[data-find="case"]');
  await page.waitForTimeout(300);
  check('sensible à la casse', /^1 sur 3$/.test(await count()), await count());
  await page.click('[data-find="case"]');
  await page.click('[data-find="word"]');
  await page.waitForTimeout(300);
  check('mot entier', /^1 sur 4$/.test(await count()), await count());
  await page.click('[data-find="word"]');
  await page.fill('[data-find="query"]', 'ecole');
  await page.waitForTimeout(300);
  check('accents distingués par défaut', /^1 sur 1$/.test(await count()) || (await count()).includes('sur 2'), await count());
  const before1 = await count();
  await page.click('[data-find="accents"]');
  await page.waitForTimeout(300);
  check('ignorer les accents', /^1 sur 3$/.test(await count()), `${before1} -> ${await count()}`);
  await page.click('[data-find="accents"]');

  // Remplacer
  await page.keyboard.press('Escape');
  check('Échap ferme la barre', (await page.locator('[data-find="bar"]').count()) === 0);
  check('Échap efface le surlignage', (await page.evaluate(() => document.querySelectorAll('.ProseMirror-search-match,.ProseMirror-active-search-match').length)) === 0);
  await page.evaluate(() => window.__ed.engine().focus());
  await page.keyboard.press('Control+Shift+h');
  await page.waitForSelector('[data-find="replacement"]');
  check('⌘⇧H ouvre avec le champ remplacer', true);
  const nBefore = (await text()).length;
  await page.fill('[data-find="query"]', 'chat');
  await page.fill('[data-find="replacement"]', 'renard');
  await page.waitForTimeout(300);
  await page.click('[data-find="replace"]');
  await page.waitForTimeout(300);
  let t = await lastPara();
  check('Remplacer : une occurrence', (t.match(/renard/g) ?? []).length === 1 && /^1 sur 4$/.test(await count()), `${t} | ${await count()}`);
  await page.click('[data-find="replace-all"]');
  await page.waitForTimeout(400);
  t = await lastPara();
  check('Tout remplacer', !/chat/i.test(t.replace(/chat-bot/g, '')) || (t.match(/renard/g) ?? []).length >= 6, t);
  await page.evaluate(() => window.__ed.engine().focus());
  await page.keyboard.press('Escape');
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(300);
  t = await lastPara();
  const rn = (t.match(/renard/g) ?? []).length;
  check('Tout remplacer = une seule étape d’annulation', rn === 1, `${rn} « renard » restant(s) : ${t}`);
  void nBefore;
  await page.screenshot({ path: path.join(ROOT, 'shots/editor-typo-find.png') }).catch(() => {});
} catch (e) {
  check('exécution du test', false, String(e).slice(0, 400));
} finally {
  if (errors.length) console.log('ERREURS NAVIGATEUR:\n' + [...new Set(errors)].join('\n'));
  await browser.close();
  await server.close();
}
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} vérifications réussies`);
process.exit(failed.length ? 1 : 0);
