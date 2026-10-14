// Empaquetage macOS (Apple Silicon) : vite build → @electron/packager → zip.
// Usage : npm run package     (exécutable depuis Linux ; l'app n'est PAS signée)
import { packager } from '@electron/packager';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RELEASE = path.join(ROOT, 'release');
const APP_DIR = path.join(RELEASE, 'Marginalia-darwin-arm64');
const APP = path.join(APP_DIR, 'Marginalia.app');
const ZIP = path.join(RELEASE, 'Marginalia-mac-arm64.zip');

const run = (cmd, args, opts = {}) => {
  const r = spawnSync(cmd, args, { stdio: 'inherit', cwd: ROOT, ...opts });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(' ')} a échoué (code ${r.status})`);
};

// 1. Rendu (bundlé dans dist/ : l'app embarquée n'a pas besoin de node_modules).
console.log('→ vite build');
run(process.execPath, [path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js'), 'build']);
if (!fs.existsSync(path.join(ROOT, 'dist', 'index.html'))) throw new Error('dist/index.html introuvable');

// 2. Seuls package.json, electron/ et dist/ entrent dans l'app.
const KEEP = [/^\/package\.json$/, /^\/electron(\/|$)/, /^\/dist(\/|$)/];
const ignore = (p) => p !== '' && !KEEP.some((re) => re.test(p));

const EXT = ['epub', 'pdf', 'docx', 'md', 'markdown', 'txt', 'html', 'htm'];
const docType = (name, exts, utis) => ({
  CFBundleTypeName: name,
  CFBundleTypeExtensions: exts,
  CFBundleTypeRole: 'Viewer',
  LSHandlerRank: 'Alternate', // proposé dans « Ouvrir avec », sans prendre la place du lecteur par défaut
  LSItemContentTypes: utis,
});

console.log('→ @electron/packager (darwin / arm64)');
fs.rmSync(APP_DIR, { recursive: true, force: true });
const out = await packager({
  dir: ROOT,
  out: RELEASE,
  name: 'Marginalia',
  executableName: 'Marginalia',
  platform: 'darwin',
  arch: 'arm64',
  overwrite: true,
  prune: false,
  asar: false,
  ignore,
  icon: path.join(ROOT, 'build', 'icon.icns'),
  appBundleId: 'com.axelbierne.marginalia',
  appCategoryType: 'public.app-category.education',
  appCopyright: '© Axel Bierne',
  darwinDarkModeSupport: true,
  extendInfo: {
    CFBundleDisplayName: 'Marginalia',
    CFBundleDocumentTypes: [
      docType('Livre EPUB', ['epub'], ['org.idpf.epub-container']),
      docType('Document PDF', ['pdf'], ['com.adobe.pdf']),
      docType('Document Word', ['docx'], ['org.openxmlformats.wordprocessingml.document']),
      docType('Document Markdown', ['md', 'markdown'], ['net.daringfireball.markdown']),
      docType('Texte brut', ['txt'], ['public.plain-text']),
      docType('Page web', ['html', 'htm'], ['public.html']),
    ],
  },
});
console.log('Application :', out.join(', '));
if (!fs.existsSync(APP)) throw new Error(`${APP} introuvable`);

// 3. Zip (-y : conserve les liens symboliques, indispensable pour les frameworks Electron).
console.log('→ zip');
fs.rmSync(ZIP, { force: true });
run('zip', ['-qry', ZIP, 'Marginalia.app'], { cwd: APP_DIR });

// 4. Rapport.
const mb = (n) => (n / 1024 / 1024).toFixed(1) + ' Mo';
const links = spawnSync('find', ['Marginalia.app', '-type', 'l'], { cwd: APP_DIR, encoding: 'utf8' }).stdout.trim().split('\n').filter(Boolean);
const zipLinks = spawnSync('sh', ['-c', `zipinfo "${ZIP}" | grep -c '^l'`], { encoding: 'utf8' }).stdout.trim();
console.log('\n── Résultat ──');
console.log('zip              :', path.relative(ROOT, ZIP), '—', mb(fs.statSync(ZIP).size));
console.log('liens symboliques dans l’.app :', links.length, '| dans le zip :', zipLinks);
console.log('liens (extrait)  :');
for (const l of links.slice(0, 8)) console.log('   ', l, '→', fs.readlinkSync(path.join(APP_DIR, l)));
console.log('\nNon signée : sur le Mac, si macOS refuse l’ouverture (« endommagée »), exécuter dans le Terminal :');
console.log('  xattr -cr /chemin/vers/Marginalia.app && codesign --force --deep -s - /chemin/vers/Marginalia.app');
