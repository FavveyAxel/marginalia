// Réécriture d'un .docx de l'utilisateur (window.marginalia.writeExternal, ⌘S d'un écrit lié) : seuls
// les fichiers choisis dans « Ouvrir un .docx » sont réécrits. La liste est tenue par le processus
// principal (docx-ouverts.json), pas déduite de la base que la page écrit.
// Vérifie : mise à jour depuis une version précédente (écrit déjà lié dans la base) → ce fichier reste
// réécrit ; un autre .docx est refusé ; une page qui glisse un chemin dans la base puis recharge →
// refusé, même après redémarrage ; « Ouvrir un .docx » → autorisé, aussi après redémarrage ; installation
// neuve : la liste est créée vide au premier lancement (la base n'est jamais relue ensuite).
// Lancer : DISPLAY=:99 timeout 300 node scripts/test-electron-docx-allow.mjs  (après npx vite build)
import { _electron as electron } from 'playwright-core';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const EXE = path.join(ROOT, 'node_modules/electron/dist/electron');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'mg-docx-allow-'));
const ok = (c, m, extra = '') => {
  console.log((c ? 'OK   ' : 'ÉCHEC ') + m + (extra !== '' ? ' — ' + (typeof extra === 'string' ? extra : JSON.stringify(extra)) : ''));
  if (!c) process.exitCode = 1;
};

const LINKED = path.join(TMP, 'lie.docx');
const VICTIM = path.join(TMP, 'victime.docx');
const PICKED = path.join(TMP, 'choisi.docx');
for (const f of [LINKED, VICTIM, PICKED]) fs.writeFileSync(f, 'ORIGINAL');

async function launch(ud) {
  const app = await electron.launch({
    executablePath: EXE,
    args: ['--no-sandbox', ROOT],
    env: { ...process.env, HOME: TMP, XDG_CONFIG_HOME: path.join(TMP, '.config'), VITE_DEV_SERVER_URL: '', MARGINALIA_E2E: '1', MARGINALIA_E2E_USER_DATA: ud },
    timeout: 60000,
  });
  const page = await app.firstWindow();
  await page.waitForFunction(() => !!(window.__store && window.marginalia), null, { timeout: 30000 });
  await page.waitForTimeout(800);
  return { app, page };
}
const tryWrite = (page, f, txt) =>
  page.evaluate(([f, txt]) => window.marginalia.writeExternal(f, new TextEncoder().encode(txt).buffer).then(() => 'accepté', (e) => String(e.message || e)), [f, txt]);

// ── 1. Mise à jour : base d'avant avec un écrit lié à lie.docx ──
const UD = path.join(TMP, 'ud-maj');
{
  // Base minimale écrite par une version précédente : on la fabrique avec l'app elle-même.
  const { app, page } = await launch(UD);
  await page.evaluate(async (f) => {
    const db = await window.marginalia.loadDb();
    const base = db && typeof db === 'object' ? db : {};
    const drafts = [{ id: 'd-lie', title: 'Lié', fileName: 'x.docx', externalPath: f, wordCount: 0, template: null, createdAt: 1, updatedAt: 1 }];
    await window.marginalia.saveDbJson(JSON.stringify({ ...base, version: base.version ?? 2, drafts }), { version: base.version ?? 2, items: 1 });
  }, LINKED);
  await app.close();
  // Comme avant la mise à jour : pas encore de liste tenue par le processus principal.
  fs.rmSync(path.join(UD, 'docx-ouverts.json'), { force: true });
}
{
  const { app, page } = await launch(UD);
  const list = (() => {
    try {
      return JSON.parse(fs.readFileSync(path.join(UD, 'docx-ouverts.json'), 'utf8')).paths;
    } catch {
      return null;
    }
  })();
  ok(Array.isArray(list) && list.includes(LINKED) && list.length === 1, 'mise à jour : liste créée avec le .docx déjà lié', list);
  ok((await tryWrite(page, LINKED, 'MODIFIE')) === 'accepté' && fs.readFileSync(LINKED, 'utf8') === 'MODIFIE', 'écrit lié : ⌘S réécrit le .docx');
  ok(fs.readFileSync(LINKED + '.bak', 'utf8') === 'ORIGINAL', 'copie .bak de l’ancienne version');
  const r = await tryWrite(page, VICTIM, 'PIRATE');
  ok(/pas été ouvert/.test(r) && fs.readFileSync(VICTIM, 'utf8') === 'ORIGINAL', 'autre .docx : refusé', r);

  // ── 2. Page détournée : chemin glissé dans la base, puis rechargement ──
  await page.evaluate(async (f) => {
    const db = await window.marginalia.loadDb();
    db.drafts = [...(db.drafts || []), { id: 'd-pirate', title: 'x', fileName: 'y.docx', externalPath: f, wordCount: 0, template: null, createdAt: 1, updatedAt: 1 }];
    await window.marginalia.saveDbJson(JSON.stringify(db), { version: db.version, items: 2 });
  }, VICTIM);
  await page.reload();
  await page.waitForFunction(() => !!(window.__store && window.marginalia), null, { timeout: 30000 });
  await page.waitForTimeout(800);
  const r2 = await tryWrite(page, VICTIM, 'PIRATE');
  ok(/pas été ouvert/.test(r2) && fs.readFileSync(VICTIM, 'utf8') === 'ORIGINAL', 'chemin glissé dans la base + rechargement : refusé', r2);

  // ── 3. « Ouvrir un .docx » (dialogue simulé dans le processus principal) ──
  await app.evaluate(({ dialog }, f) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [f] });
  }, PICKED);
  const opened = await page.evaluate(() => window.marginalia.openDocx().then((x) => x && x.path));
  ok(opened === PICKED, 'Ouvrir un .docx : fichier choisi', opened);
  ok((await tryWrite(page, PICKED, 'ENREGISTRE')) === 'accepté' && fs.readFileSync(PICKED, 'utf8') === 'ENREGISTRE', 'fichier choisi : réécrit');
  await app.close();
}
{
  // ── 4. Redémarrage ──
  const { app, page } = await launch(UD);
  ok((await tryWrite(page, LINKED, 'APRES')) === 'accepté', 'après redémarrage : l’écrit lié se réécrit toujours');
  ok((await tryWrite(page, PICKED, 'APRES')) === 'accepté', 'après redémarrage : le fichier choisi aussi');
  const r = await tryWrite(page, VICTIM, 'PIRATE');
  ok(/pas été ouvert/.test(r) && fs.readFileSync(VICTIM, 'utf8') === 'ORIGINAL', 'après redémarrage : le chemin glissé dans la base reste refusé', r);
  await app.close();
}

// ── 5. Installation neuve ──
const UD2 = path.join(TMP, 'ud-neuve');
{
  const { app, page } = await launch(UD2);
  const list = JSON.parse(fs.readFileSync(path.join(UD2, 'docx-ouverts.json'), 'utf8')).paths;
  ok(Array.isArray(list) && list.length === 0, 'installation neuve : liste créée vide au premier lancement', list);
  await page.evaluate(async (f) => {
    const db = (await window.marginalia.loadDb()) || {};
    db.version = db.version ?? 2;
    db.drafts = [{ id: 'd-pirate', title: 'x', fileName: 'y.docx', externalPath: f, wordCount: 0, template: null, createdAt: 1, updatedAt: 1 }];
    await window.marginalia.saveDbJson(JSON.stringify(db), { version: db.version, items: 1 });
  }, VICTIM);
  await app.close();
}
{
  const { app, page } = await launch(UD2);
  const r = await tryWrite(page, VICTIM, 'PIRATE');
  ok(/pas été ouvert/.test(r) && fs.readFileSync(VICTIM, 'utf8') === 'ORIGINAL', 'installation neuve : chemin glissé avant tout « Ouvrir » → refusé au lancement suivant', r);
  await app.close();
}

fs.rmSync(TMP, { recursive: true, force: true });
console.log(process.exitCode ? '\nDes vérifications ont échoué.' : '\nToutes les vérifications sont passées.');
