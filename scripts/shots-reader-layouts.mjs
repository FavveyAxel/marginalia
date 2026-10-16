// Revue visuelle des mises en page du lecteur HTML (EPUB) : une capture 1440×900 par combinaison
// readerLayout (défilement, feuilles, pages simples, pages doubles) × mise en page livre × aspect papier
// en thème clair, plus sombre et sépia pour les 4 « vitrines », le panneau Affichage ouvert et une vue
// avec panneaux latéraux. Sorties dans shots/revue/ du dépôt principal :
//   NN-<combinaison>.png, planche.png (planche contact), index.html (galerie locale), revue.json.
// Lancer : timeout 600 node scripts/shots-reader-layouts.mjs   (REVUE_OUT=… pour un autre dossier)
import fs from 'node:fs';
import path from 'node:path';
import { withApp } from './harness.mjs';
import { combos, applyCombo, setupBook, showSpan, tidy, rootState, implemented, hasNewLayouts, OUT_DIR, LAYOUTS } from './reader-layouts-common.mjs';

const PORT = Number(process.env.PORT || 5415);
fs.mkdirSync(OUT_DIR, { recursive: true });
for (const f of fs.readdirSync(OUT_DIR)) if (/^\d\d-.*\.png$/.test(f)) fs.unlinkSync(path.join(OUT_DIR, f));

const entries = [];
const pad = (n) => String(n).padStart(2, '0');

await withApp(PORT, async (page, errors) => {
  await page.evaluate(() => window.__store.getState().updateSettings({ theme: 'light' }));
  const { hl } = await setupBook(page);
  // Sonde : le code connaît-il readerLayout ? (sinon on approxime par pageMarks)
  await applyCombo(page, combos()[4]);
  const legacy = !(await hasNewLayouts(page));
  console.log(legacy ? 'Code sans readerLayout : rendu par défaut, approximé par pageMarks.' : 'Code avec readerLayout.');

  const capture = async (c, file, label, extra = {}) => {
    await tidy(page);
    const abs = path.join(OUT_DIR, file);
    await page.screenshot({ path: abs });
    const st = await rootState(page);
    const missing = c ? implemented(c, st) : [];
    const indicator = await page.evaluate(() => document.querySelector('.reader-page[data-pane="a"] [data-testid=page-indicator]')?.textContent ?? null);
    entries.push({ file, label, missing, state: st, indicator, newErrors: errors.length - (extra.errBefore ?? errors.length), ...extra });
    console.log(`capture: ${file}${missing.length ? '  (non reconnu : ' + missing.join(', ') + ')' : ''}`);
  };

  const all = combos();
  for (const c of all) {
    const errBefore = errors.length;
    await applyCombo(page, c, { legacy });
    await showSpan(page, hl.span);
    await capture(c, `${pad(c.n)}-${c.slug}.png`, c.label, { errBefore, theme: c.theme, layout: c.layout.id });
  }

  // Panneau « Mise en page et affichage » ouvert : défaut et vitrine pages doubles.
  let n = all.length;
  const hero = (id) => all.find((c) => c.layout.id === id && c.bookLayout && c.paperLook && c.theme === 'light');
  for (const c of [all[0], hero('paged2')]) {
    n++;
    await applyCombo(page, c, { legacy });
    await showSpan(page, hl.span);
    await page.click('[data-testid=reader-display-btn]');
    await page.waitForTimeout(600);
    await capture(c, `${pad(n)}-reglages-${c.layout.id}.png`, `Panneau « Mise en page et affichage » · ${c.label}`, { theme: c.theme, layout: c.layout.id });
    await page.keyboard.press('Escape');
    await page.waitForTimeout(250);
  }
  // Usage réel : sommaire et extraits ouverts, vitrine pages doubles puis feuilles.
  for (const id of ['paged2', 'sheets']) {
    n++;
    const c = hero(id);
    await applyCombo(page, c, { legacy, panels: true });
    await showSpan(page, hl.span);
    await capture(c, `${pad(n)}-panneaux-${id}.png`, `Sommaire + extraits · ${c.label}`, { theme: c.theme, layout: id });
  }
  await page.evaluate(() => window.__store.getState().updateSettings({ showToc: true, showExtracts: true, theme: 'light' }));

  // ── Planche contact : composée dans le navigateur (HTML + images en data:), puis capturée.
  const thumbs = entries.map((e) => ({ ...e, src: 'data:image/png;base64,' + fs.readFileSync(path.join(OUT_DIR, e.file)).toString('base64') }));
  const sheet = await page.context().newPage();
  await sheet.setViewportSize({ width: 1600, height: 900 });
  await sheet.setContent(contactHtml(thumbs, legacy), { waitUntil: 'load' });
  await sheet.evaluate(() => Promise.all([...document.images].map((i) => i.decode().catch(() => {}))));
  await sheet.screenshot({ path: path.join(OUT_DIR, 'planche.png'), fullPage: true });
  await sheet.close();
  console.log('capture: planche.png');
});

fs.writeFileSync(path.join(OUT_DIR, 'index.html'), galleryHtml(entries));
fs.writeFileSync(path.join(OUT_DIR, 'revue.json'), JSON.stringify(entries, null, 2));
console.log(`\n${entries.length} captures, planche et galerie dans ${OUT_DIR}`);

// ── Gabarits ─────────────────────────────────────────────────

function esc(s) {
  return String(s).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]);
}

function badge(e) {
  if (e.missing.length) return `<span class="b warn">non reconnu : ${esc(e.missing.join(', '))}</span>`;
  return `<span class="b ok">rendu demandé</span>`;
}

function contactHtml(items, legacy) {
  const date = new Date().toISOString().slice(0, 16).replace('T', ' ');
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><style>
  body{margin:0;padding:24px;background:#1f1d1a;color:#eee;font:13px/1.35 -apple-system,system-ui,sans-serif}
  h1{font-size:18px;margin:0 0 4px} p.sub{margin:0 0 18px;color:#aaa}
  .grid{display:grid;grid-template-columns:repeat(4,1fr);gap:18px 16px}
  figure{margin:0;background:#2b2925;border-radius:6px;padding:8px}
  img{width:100%;display:block;border-radius:3px;border:1px solid #444}
  figcaption{margin-top:6px} .n{font-weight:700;color:#f0b35c;margin-right:6px}
  .b{display:inline-block;margin-top:4px;padding:1px 6px;border-radius:9px;font-size:11px}
  .ok{background:#2f5d3a;color:#cfe9d4} .warn{background:#6b4a1c;color:#ffdca8}
  .meta{color:#999;font-size:11px}
  </style></head><body><h1>Marginalia — revue des mises en page du lecteur</h1>
  <p class="sub">${items.length} captures 1440×900 · ${esc(date)} · livre : Méditations métaphysiques (EPUB, pages imprimées v–vii, 1–7)${legacy ? ' · <b>code sans readerLayout : rendu par défaut</b>' : ''}</p>
  <div class="grid">${items
    .map(
      (e) => `<figure><img src="${e.src}"><figcaption><span class="n">${esc(e.file.slice(0, 2))}</span>${esc(e.label)}<br>${badge(e)} <span class="meta">${esc(e.indicator ?? 'pas d’indicateur')}${e.newErrors ? ' · ' + e.newErrors + ' erreur(s) console' : ''}</span></figcaption></figure>`,
    )
    .join('')}</div></body></html>`;
}

function galleryHtml(items) {
  const groups = [...LAYOUTS.map((L) => [L.label, items.filter((e) => e.layout === L.id && !/^\d\d-(reglages|panneaux)/.test(e.file))]), ['Réglages et panneaux', items.filter((e) => /^\d\d-(reglages|panneaux)/.test(e.file))]];
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Revue du lecteur</title><style>
  :root{color-scheme:light dark;--bg:#f6f3ee;--fg:#222;--card:#fff;--mute:#777}
  @media (prefers-color-scheme:dark){:root{--bg:#1d1b18;--fg:#eee;--card:#2a2824;--mute:#999}}
  body{margin:0;padding:24px 16px;background:var(--bg);color:var(--fg);font:14px/1.4 -apple-system,system-ui,sans-serif}
  h1{font-size:20px} h2{font-size:16px;margin:28px 0 10px}
  .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(340px,1fr));gap:16px}
  figure{margin:0;background:var(--card);border-radius:8px;padding:8px;box-shadow:0 1px 3px #0002}
  img{width:100%;display:block;border-radius:4px} a{color:inherit}
  figcaption{margin-top:6px} .meta{color:var(--mute);font-size:12px}
  .b{display:inline-block;padding:1px 7px;border-radius:9px;font-size:11px}
  .ok{background:#d7efdc;color:#1d5a2b} .warn{background:#fbe6c4;color:#7a4a00}
  </style></head><body><h1>Revue des mises en page du lecteur</h1>
  <p class="meta">Cliquer une vignette pour l’image en taille réelle. <a href="planche.png">Planche contact</a> · <a href="revue.json">revue.json</a></p>
  ${groups
    .map(
      ([title, list]) =>
        `<h2>${esc(title)}</h2><div class="grid">${list
          .map(
            (e) =>
              `<figure><a href="${esc(e.file)}"><img loading="lazy" src="${esc(e.file)}" alt="${esc(e.label)}"></a><figcaption><b>${esc(e.file.slice(0, 2))}</b> ${esc(e.label)}<br>${badge(e)} <span class="meta">${esc(e.indicator ?? '')}${e.newErrors ? ' · ' + e.newErrors + ' erreur(s) console' : ''}</span></figcaption></figure>`,
          )
          .join('')}</div>`,
    )
    .join('')}
  </body></html>`;
}
