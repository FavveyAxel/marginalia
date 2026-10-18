// Réception par le Wi-Fi, côté interface (hôte simulé du navigateur : window.__inbox.wifi) — port 5297.
// Fenêtre « Recevoir depuis le téléphone » (QR code, téléphone connecté, envois reçus, fermeture) ;
// boîte vide : deux façons de recevoir ; notes d'un livre collées → plusieurs extraits avec leurs notes.
// Lancer : timeout 300 node scripts/test-inbox-wifi-ui.mjs        Captures : shots/wifi/
import { withApp, importFixture, shot } from './harness.mjs';

const PORT = 5297;
const SHOTS = 'shots/wifi';
let failed = 0;
let passed = 0;
const ok = (cond, msg, extra = '') => {
  console.log(`${cond ? 'OK  ' : 'FAIL'} ${msg}${extra !== '' ? ' — ' + extra : ''}`);
  if (cond) passed++;
  else failed++;
};

// Notes du Discours copiées depuis l'app Livres (passages entre guillemets, mentions, notes).
const NOTES = `“Le bon sens est la chose du monde la mieux partagée ; car chacun pense en être si bien pourvu”

Extrait de
Discours de la méthode
René Descartes
Ce document est peut-être protégé par des droits d’auteur.

“Car ce n'est pas assez d'avoir l'esprit bon, mais le principal est de l'appliquer bien.”

La méthode compte plus que le talent : bon pour l’introduction.

“Les plus grandes âmes sont capables des plus grands vices, aussi bien que des plus grandes vertus”

“Une phrase qui n’est dans aucun livre de la bibliothèque, citée par erreur.”`;

for (const dark of [false, true]) {
  await withApp(
    PORT + (dark ? 1 : 0),
    async (page, errors) => {
      const st = (fn, a) => page.evaluate(fn, a);
      const discours = await importFixture(page, 'fixtures/discours.epub');
      ok(!!discours, `${dark ? '[sombre] ' : ''}livre de test importé`);
      await st(() => window.__store.getState().navigate({ name: 'inbox' }));
      await page.waitForSelector('.ib-ways');
      ok((await page.locator('.ib-way').count()) === 2 && (await page.locator('.ib-way.is-main h3').innerText()) === 'Par le Wi-Fi', 'boîte vide : deux façons, le Wi-Fi d’abord');
      if (!dark) await shot(page, `${SHOTS}/01-boite-vide.png`);

      await page.click('[data-testid="wifi-open"]');
      await page.waitForSelector('[data-testid="wifi-receive"] .wr-qr');
      ok(true, 'fenêtre ouverte : QR code affiché');
      ok((await page.locator('.wr-addr').innerText()) === '192.168.1.24:47800', 'adresse courte affichée (sans le jeton)');
      ok((await page.locator('.wr-status').innerText()).includes('En attente du téléphone'), 'en attente du téléphone');
      // Le QR code se lit : les trois repères de position sont là (module du coin sombre, zone calme claire).
      const qr = await st(() => {
        const svg = document.querySelector('.wr-qr');
        return { w: svg.getBoundingClientRect().width, rect: svg.querySelector('rect').getAttribute('fill'), path: svg.querySelector('path').getAttribute('d').startsWith('M0 0h1v1h-1z') };
      });
      ok(qr.w >= 180 && qr.rect === '#fff' && qr.path, 'QR code : fond blanc, repère en haut à gauche, taille lisible', qr);
      await shot(page, `${SHOTS}/${dark ? '06-fenetre-sombre' : '02-fenetre'}.png`);
      if (dark) return;

      // Envois depuis le « téléphone »
      // Petite image PNG valide (2 × 2 px), comme une photo envoyée.
      const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGP8z8DAwMDAxMDAwMDAAAANHQEDasKb6QAAAABJRU5ErkJggg==';
      await st((b64) => window.__inbox.wifi('Photo du 2026-10-18 14.32.05.png', Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)), 'iPhone'), PNG);
      await page.waitForSelector('.wr-status.is-on');
      ok((await page.locator('.wr-status').innerText()).includes('iPhone connecté'), 'iPhone connecté');
      await st((t) => window.__inbox.wifi('Texte du 2026-10-18 14.33.10.txt', t, 'iPhone'), NOTES);
      await page.waitForFunction(() => document.querySelectorAll('.wr-got li').length === 2);
      ok((await page.locator('.wr-got li').first().getAttribute('data-name')).startsWith('Texte du'), 'envois listés dans la fenêtre, le plus récent en haut');
      await shot(page, `${SHOTS}/03-recus.png`);

      // Notes collées → 3 extraits, la note rattachée, la citation inconnue reste dans la boîte.
      await page.waitForFunction(() => window.__store.getState().highlights.length >= 3, null, { timeout: 30000 });
      const hs = await st(() => window.__store.getState().highlights.map((h) => ({ t: h.text.slice(0, 40), note: h.note, plain: !!h.plain })));
      ok(hs.length === 3, '3 extraits créés à partir des notes collées', JSON.stringify(hs));
      const appl = hs.find((h) => h.t.startsWith('Car ce n'));
      ok(!!appl && appl.note === 'La méthode compte plus que le talent : bon pour l’introduction.' && !appl.plain, 'la note suit son passage');
      ok(hs.filter((h) => h.plain).length === 2, 'passages sans note : surlignage simple');
      // Chaque envoi dit ce qu'il est devenu, avec de quoi le retrouver.
      await page.waitForFunction(() => [...document.querySelectorAll('.wr-got-row')].every((r) => !r.classList.contains('is-busy')), null, { timeout: 30000 });
      const rows = await page.$$eval('.wr-got-row', (rs) => rs.map((r) => ({ state: r.className.match(/is-(\w+)/)?.[1], text: r.querySelector('.wr-got-kind').innerText, btn: r.querySelector('.wr-got-go')?.innerText ?? '' })));
      ok(rows[0].state === 'waiting' && /3 extraits ajoutés à « Discours de la méthode » ; 1 passage non retrouvé/.test(rows[0].text) && rows[0].btn === 'Voir dans la boîte', 'notes : « 3 extraits ajoutés… ; 1 passage non retrouvé »', JSON.stringify(rows[0]));
      ok(rows[1].state === 'waiting' && /Photo reçue : à ranger dans la Boîte/.test(rows[1].text) && rows[1].btn === 'Voir dans la boîte', 'photo sans texte : « à ranger dans la Boîte » + bouton', JSON.stringify(rows[1]));
      await shot(page, `${SHOTS}/05-devenir.png`);
      await page.click('.wr-head .icon-btn');
      await page.waitForSelector('[data-testid="wifi-receive"]', { state: 'detached' });
      ok(true, 'fenêtre fermée');
      await page.waitForFunction(() => [...document.querySelectorAll('.ib-card')].some((c) => c.dataset.name?.startsWith('Texte du') && !c.classList.contains('is-busy')), null, { timeout: 30000 });
      const card = page.locator('.ib-card[data-name^="Texte du"]');
      ok((await card.locator('.ib-meta').innerText()).includes('par le Wi-Fi'), 'carte marquée « reçu par le Wi-Fi »');
      const left = await card.locator('textarea').inputValue().catch(() => '');
      ok(left === 'Une phrase qui n’est dans aucun livre de la bibliothèque, citée par erreur.', 'reste dans la boîte : seulement la citation non retrouvée', left);
      await shot(page, `${SHOTS}/04-boite-apres.png`);

      // Renvoi du même texte : pas de doublon.
      await st((t) => window.__inbox.wifi('Texte du 2026-10-18 14.40.00.txt', t, 'iPhone'), NOTES);
      await page.waitForTimeout(4000);
      ok((await st(() => window.__store.getState().highlights.length)) === 3, 'même texte renvoyé : pas d’extrait en double');
      ok(errors.length === 0, 'aucune erreur dans la console', errors.slice(0, 3).join(' | '));
    },
    { dark },
  );
}

console.log(`\n${passed} OK, ${failed} échec(s)`);
process.exit(failed ? 1 : 0);
