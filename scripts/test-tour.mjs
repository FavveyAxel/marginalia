// Visite guidée (navigateur, port 5341) : toutes les étapes (vue ouverte, zone mise en lumière, carte
// dans l'écran), Précédent / Suivant au clavier, Passer (Échap) → tourDone ; relance depuis l'Aide.
// Lancer : timeout 300 node scripts/test-tour.mjs        Captures : shots/tour/
import { withApp, shot } from './harness.mjs';

let failed = 0, passed = 0;
const ok = (c, m, extra = '') => { console.log(`${c ? 'OK  ' : 'FAIL'} ${m}${extra !== '' ? ' — ' + extra : ''}`); c ? passed++ : failed++; };

for (const [label, w, h, char] of [['large', 1440, 900, 'rousseau'], ['petit', 1100, 700, 'brain']]) {
  await withApp(5341 + (label === 'petit' ? 1 : 0), async (page, errors) => {
    await page.evaluate((c) => window.__store.getState().updateSettings({ mascotCharacter: c }), char);
    await page.evaluate(async () => (await import('/src/features/tour/Tour.tsx')).startTour());
    await page.waitForSelector('[data-testid="tour"] .tour-card.is-placed');
    const n = await page.evaluate(async () => (await import('/src/features/tour/Tour.tsx')).TOUR.length);
    const seen = [];
    for (let k = 0; k < n; k++) {
      await page.waitForTimeout(450);
      const st = await page.evaluate(() => {
        const t = document.querySelector('[data-testid="tour"]');
        const c = t.querySelector('.tour-card').getBoundingClientRect();
        const hole = t.querySelector('.tour-hole')?.getBoundingClientRect();
        return { id: t.dataset.step, route: window.__store.getState().route.name, card: [c.left, c.top, c.right, c.bottom], hole: hole ? [hole.left, hole.top, hole.width, hole.height] : null, vw: innerWidth, vh: innerHeight, overlap: hole ? !(c.right < hole.left || c.left > hole.right || c.bottom < hole.top || c.top > hole.bottom) : false };
      });
      seen.push(st);
      if (label === 'large') await shot(page, `shots/tour/${String(k + 1).padStart(2, '0')}-${st.id}.png`);
      // Une étape à la fois : bouton « Suivant » ou flèche →, en alternance.
      if (k < n - 1) {
        if (k % 2) await page.keyboard.press('ArrowRight');
        else await page.click('[data-testid="tour-next"]');
      }
    }
    const ids = seen.map((s) => s.id);
    ok(new Set(ids).size === n, `[${label}] ${n} étapes parcourues dans l’ordre`, ids.join(' › '));
    const inScreen = seen.every((s) => s.card[0] >= 0 && s.card[1] >= 0 && s.card[2] <= s.vw && s.card[3] <= s.vh);
    ok(inScreen, `[${label}] la carte reste dans l’écran à chaque étape`);
    const lit = seen.filter((s) => s.hole);
    ok(lit.length >= n - 3, `[${label}] zones mises en lumière`, `${lit.length}/${n} (${seen.filter((s) => !s.hole).map((s) => s.id).join(', ')} au centre)`);
    ok(!lit.some((s) => s.overlap), `[${label}] la carte ne cache jamais la zone montrée`, lit.filter((s) => s.overlap).map((s) => s.id).join(', '));
    const routes = Object.fromEntries(seen.map((s) => [s.id, s.route]));
    ok(routes.cartes === 'maps' && routes.ecrits === 'write' && routes.importer === 'import' && routes.extraits === 'extracts', `[${label}] chaque étape ouvre sa vue`, JSON.stringify(routes));
    await page.keyboard.press('ArrowLeft');
    await page.waitForTimeout(300);
    ok((await page.getAttribute('[data-testid="tour"]', 'data-step')) === seen[n - 2].id, `[${label}] ← revient à l’étape précédente`);
    await page.keyboard.press('Escape');
    await page.waitForSelector('[data-testid="tour"]', { state: 'detached' });
    ok(await page.evaluate(() => window.__store.getState().settings.tourDone === true), `[${label}] Échap : visite passée, notée (ne revient plus d’elle-même)`);
    if (label === 'large') {
      await page.evaluate(() => window.__store.getState().navigate({ name: 'help' }));
      await page.click('[data-testid="help-tour"]');
      await page.waitForSelector('[data-testid="tour"]');
      ok(true, 'relance depuis l’Aide');
      await page.click('.tour-skip');
      await page.waitForSelector('[data-testid="tour"]', { state: 'detached' });
      ok(true, '« Passer le tutoriel » ferme la visite');
    }
    ok(errors.length === 0, `[${label}] aucune erreur dans la console`, errors.slice(0, 2).join(' | '));
  }, { width: w, height: h });
}
console.log(`\n${passed} OK, ${failed} échec(s)`);
process.exit(failed ? 1 : 0);
