// Boîte de dépôt (window.marginalia.inbox) : dossier par défaut, création de « Traités », liste filtrée,
// lecture, rangement avec suffixe « (2) », noms dangereux refusés, avis de changement.
// MARGINALIA_INBOX_DIR (avec MARGINALIA_E2E=1) impose le dossier par défaut : le sélecteur natif n'est pas testable.
// Lancer : DISPLAY=:99 timeout 120 node scripts/test-electron-inbox.mjs  (ou xvfb-run -a node …)
// APP_DIR : l'app empaquetée si elle existe, sinon le dépôt (electron/main.cjs ; dist/ facultatif ici).
import { _electron as electron } from 'playwright-core';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const PACKAGED = path.join(ROOT, 'release/Marginalia-darwin-arm64/Marginalia.app/Contents/Resources/app');
// L'app empaquetée seulement si elle est à jour (même code Electron que le dépôt) : un paquet ancien,
// laissé par une fabrication précédente, n'a pas forcément les dernières fonctions.
const same = (f) => {
  try {
    return fs.readFileSync(path.join(PACKAGED, f), 'utf8') === fs.readFileSync(path.join(ROOT, f), 'utf8');
  } catch {
    return false;
  }
};
const APP_DIR = same('electron/main.cjs') && same('electron/preload.cjs') ? PACKAGED : ROOT;
const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'mg-inbox-'));
const INBOX = path.join(HOME, 'Documents/Marginalia');
const ok = (c, m, extra = '') => {
  console.log((c ? 'OK   ' : 'ÉCHEC ') + m + (extra !== '' ? ' — ' + (typeof extra === 'string' ? extra : JSON.stringify(extra)) : ''));
  if (!c) process.exitCode = 1;
};
const rejects = (p) => p.then(() => null, (e) => String((e && e.message) || e));

const env = { ...process.env, HOME, XDG_CONFIG_HOME: path.join(HOME, '.config'), VITE_DEV_SERVER_URL: '', MARGINALIA_E2E: '1', MARGINALIA_INBOX_DIR: INBOX };
const app = await electron.launch({ executablePath: path.join(ROOT, 'node_modules/electron/dist/electron'), args: ['--no-sandbox', APP_DIR], env, timeout: 60000 });
try {
  const page = await app.firstWindow();
  await page.waitForFunction(() => !!(window.marginalia && window.marginalia.inbox), null, { timeout: 30000 });

  const info0 = await page.evaluate(() => window.marginalia.inbox.info());
  ok(info0.dir === INBOX && info0.defaultDir === INBOX && info0.isDefault === true, 'info : dossier par défaut', info0.dir);
  ok(info0.exists === false && info0.cloud === null, 'info : pas encore créé, pas de nuage reconnu');

  const info1 = await page.evaluate(() => window.marginalia.inbox.enable());
  ok(info1.exists === true && fs.statSync(path.join(INBOX, 'Traités')).isDirectory(), 'enable : dossier et « Traités » créés');
  await page.evaluate(() => window.marginalia.inbox.enable());
  ok(true, 'enable : idempotent');

  // Écoute des changements (posée avant d'ajouter des fichiers).
  await page.evaluate(() => {
    window.__inboxChanges = 0;
    window.__inboxOff = window.marginalia.inbox.onChange(() => window.__inboxChanges++);
  });
  const bytes = Buffer.from('%PDF-1.4 bonjour\n');
  fs.writeFileSync(path.join(INBOX, 'Note.pdf'), bytes);
  fs.writeFileSync(path.join(INBOX, '.cache'), 'x');
  fs.writeFileSync(path.join(INBOX, '.DS_Store'), 'x');
  fs.writeFileSync(path.join(INBOX, 'Thumbs.db'), 'x');
  fs.writeFileSync(path.join(INBOX, 'desktop.ini'), 'x');
  fs.writeFileSync(path.join(INBOX, '~$brouillon.docx'), 'x');
  fs.writeFileSync(path.join(INBOX, 'En cours.jpg'), ''); // copie en cours : vide et récente
  fs.writeFileSync(path.join(INBOX, '.Dans le nuage.epub.icloud'), 'x'); // fantôme iCloud
  fs.mkdirSync(path.join(INBOX, 'Sous-dossier'));
  fs.writeFileSync(path.join(INBOX, 'Sous-dossier', 'cache.txt'), 'x');
  fs.writeFileSync(path.join(INBOX, 'Traités', 'Ancien.txt'), 'x');
  fs.symlinkSync('/etc/hostname', path.join(INBOX, 'lien.txt'));
  const old = new Date(Date.now() - 60000);
  fs.writeFileSync(path.join(INBOX, 'Plus ancien.txt'), 'avant');
  fs.utimesSync(path.join(INBOX, 'Plus ancien.txt'), old, old);

  const t0 = Date.now();
  await page.waitForFunction(() => window.__inboxChanges > 0, null, { timeout: 4500 }).catch(() => {});
  const changes = await page.evaluate(() => window.__inboxChanges);
  ok(changes >= 1, `onChange appelé après l'ajout de fichiers (${Date.now() - t0} ms)`, changes);

  const list = await page.evaluate(() => window.marginalia.inbox.list());
  const names = list.map((f) => f.name + (f.pending ? '[nuage]' : ''));
  ok(JSON.stringify(list.filter((f) => !f.pending).map((f) => f.name)) === JSON.stringify(['Plus ancien.txt', 'Note.pdf']), 'list : fichiers ordinaires de premier niveau, triés du plus ancien au plus récent', names);
  const ghost = list.find((f) => f.pending);
  ok(ghost && ghost.name === 'Dans le nuage.epub' && ghost.size === 0, 'list : fantôme iCloud signalé « pending » sous son vrai nom', names);
  ok(list.find((f) => f.name === 'Note.pdf').size === bytes.length, 'list : taille');

  const r = await page.evaluate(async () => {
    const f = await window.marginalia.inbox.read('Note.pdf');
    return { name: f.name, isAb: f.data instanceof ArrayBuffer, text: new TextDecoder().decode(f.data) };
  });
  ok(r.name === 'Note.pdf' && r.isAb && r.text === bytes.toString(), 'read : octets exacts (ArrayBuffer)');

  for (const bad of ['../db.json', '..', '.', '', 'a/b', 'a\\b', 'Note.pdf\0', '/etc/hostname', 'Traités', 'lien.txt', 'Sous-dossier', 'absent.pdf']) {
    const err = await rejects(page.evaluate((n) => window.marginalia.inbox.read(n), bad));
    ok(!!err, `read refusé : ${JSON.stringify(bad)}`, err || '');
  }
  const errDone = await rejects(page.evaluate(() => window.marginalia.inbox.done('../inbox.json')));
  ok(!!errDone, 'done refusé : remontée de dossier', errDone || '');

  // Rangement, puis doublon : « Note (2).pdf ».
  await page.evaluate(() => window.marginalia.inbox.done('Note.pdf'));
  ok(!fs.existsSync(path.join(INBOX, 'Note.pdf')) && fs.readFileSync(path.join(INBOX, 'Traités/Note.pdf')).equals(bytes), 'done : rangé dans « Traités »');
  fs.writeFileSync(path.join(INBOX, 'Note.pdf'), 'deuxième');
  await page.evaluate(() => window.marginalia.inbox.done('Note.pdf'));
  fs.writeFileSync(path.join(INBOX, 'Note.pdf'), 'troisième');
  await page.evaluate(() => window.marginalia.inbox.done('Note.pdf'));
  const done = fs.readdirSync(path.join(INBOX, 'Traités')).sort();
  ok(fs.readFileSync(path.join(INBOX, 'Traités/Note (2).pdf'), 'utf8') === 'deuxième' && fs.readFileSync(path.join(INBOX, 'Traités/Note (3).pdf'), 'utf8') === 'troisième', 'done : « Note (2).pdf », « Note (3).pdf » en cas de doublon', done);
  const list2 = await page.evaluate(() => window.marginalia.inbox.list());
  ok(!list2.some((f) => f.name === 'Note.pdf'), 'list : fichier traité absent');

  // Désactivation : plus d'avis.
  await page.evaluate(() => window.marginalia.inbox.disable());
  await page.waitForTimeout(1800);
  await page.evaluate(() => { window.__inboxChanges = 0; });
  fs.writeFileSync(path.join(INBOX, 'Après.txt'), 'x');
  await page.waitForTimeout(2500);
  ok((await page.evaluate(() => window.__inboxChanges)) === 0, 'disable : plus d’avis de changement');

  const reset = await page.evaluate(() => window.marginalia.inbox.reset());
  ok(reset.dir === INBOX && reset.isDefault && reset.exists, 'reset : dossier par défaut');
  const userData = await app.evaluate(({ app }) => app.getPath('userData'));
  ok(JSON.stringify(JSON.parse(fs.readFileSync(path.join(userData, 'inbox.json'), 'utf8'))) === '{}', 'reset : choix enregistré dans inbox.json (aucun chemin imposé)');
} finally {
  await app.close();
  fs.rmSync(HOME, { recursive: true, force: true });
}
