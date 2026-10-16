// Test B1 : carte d'argument + arguments. Port 5211. Captures dans shots/map/.
import { withApp, importFixture, shot } from './harness.mjs';

const PORT = 5211;
let failures = 0;
const check = (ok, msg) => {
  console.log(`${ok ? 'OK ' : 'ÉCHEC'} ${msg}`);
  if (!ok) failures++;
};

const QUOTES = [
  ['probleme', 'ce n’est pas assez d’avoir l’esprit bon, mais le principal est de l’appliquer bien', 'Première partie'],
  ['these', 'la puissance de bien juger et distinguer le vrai d’avec le faux, qui est proprement ce qu’on nomme le bon sens ou la raison, est naturellement égale en tous les hommes', 'Première partie'],
  ['argument', 'la diversité de nos opinions ne vient pas de ce que les uns sont plus raisonnables que les autres, mais seulement de ce que nous conduisons nos pensées par diverses voies', 'Première partie'],
  ['argument', 'ceux qui ne marchent que fort lentement peuvent avancer beaucoup davantage, s’ils suivent toujours le droit chemin', 'Première partie'],
  ['objection', 'chacun pense en être si bien pourvu, que ceux même qui sont les plus difficiles à contenter en toute autre chose n’ont point coutume d’en désirer plus qu’ils en ont', 'Première partie'],
  ['exemple', 'je me trouvais embarrassé de tant de doutes et d’erreurs, qu’il me semblait n’avoir fait autre profit, en tâchant de m’instruire, sinon que j’avais découvert de plus en plus mon ignorance', 'Des études'],
  ['concept', 'ne recevoir jamais aucune chose pour vraie que je ne la connusse évidemment être telle', 'Les quatre préceptes'],
  ['these', 'souvent il n’y a pas tant de perfection dans les ouvrages composés de plusieurs pièces, et faits de la main de divers maîtres, qu’en ceux auxquels un seul a travaillé', 'Seconde partie'],
  [null, 'Je demeurais tout le jour enfermé seul dans un poêle, où j’avais tout le loisir de m’entretenir de mes pensées', 'Seconde partie'],
  ['exemple', 'les plus grandes âmes sont capables des plus grands vices, aussi bien que des plus grandes vertus', 'Première partie'],
].map(([c, t, l]) => [c, t.charAt(0).toUpperCase() === t.charAt(0) ? t : t, l]);

async function run(dark) {
  const tag = dark ? 'dark' : 'light';
  await withApp(
    PORT,
    async (page, errors) => {
      const bookId = await importFixture(page, 'fixtures/discours.md', { open: true });
      check(!!bookId, `[${tag}] livre importé`);
      const openMap = () =>
        page.evaluate((bookId) => window.__store.setState({ route: { name: 'reader', bookId, tab: 'carte', splitBookId: null } }), bookId);
      const theme = dark ? 'dark' : 'light';
      await page.evaluate((t) => window.__store.getState().updateSettings({ theme: t }), theme);

      // ── Carte vide, sans extraits
      await openMap();
      await page.waitForSelector('[data-testid=map-root]');
      await page.waitForTimeout(500);
      await shot(page, `shots/map/${tag}-1-vide.png`);

      // ── Extraits injectés
      const ids = await page.evaluate(
        ({ bookId, quotes }) => {
          const st = window.__store;
          const hs = quotes.map(([category, text, locationLabel], i) => ({
            id: `h${i}`,
            bookId,
            category,
            text,
            note: i === 1 ? 'Définition du bon sens : point de départ de tout le Discours.' : '',
            noteKind: i === 1 ? 'reformulation' : null,
            conceptIds: [],
            anchor: { kind: 'html', chapter: 0, start: i * 10, end: i * 10 + 5, prefix: '', suffix: '' },
            locationLabel,
            printedPage: String(3 + i * 2),
            createdAt: Date.now() + i,
            updatedAt: Date.now() + i,
          }));
          st.setState({ highlights: hs });
          return hs.map((h) => h.id);
        },
        { bookId, quotes: QUOTES },
      );
      await page.evaluate(() => window.__store.setState({ toasts: [] }));
      await page.locator('[data-testid=map-drawer-open]').click();
      await page.waitForTimeout(500);
      await shot(page, `shots/map/${tag}-2-vide-extraits.png`);

      // ── Placement via « + » du tiroir (3 extraits)
      for (let i = 0; i < 3; i++) {
        await page.locator('.map-drawer-item .add').first().click();
        await page.waitForTimeout(120);
      }
      let m = await page.evaluate((b) => window.__store.getState().getMap(b), bookId);
      check(m.nodes.length === 3, `[${tag}] 3 extraits placés par « + » (${m.nodes.length})`);

      // ── Glisser un nœud : position persistée
      const n0 = m.nodes[0];
      const box = await page.locator(`.react-flow__node[data-id="${n0.id}"]`).boundingBox();
      await page.mouse.move(box.x + box.width / 2, box.y + 20);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width / 2 + 150, box.y + 140, { steps: 8 });
      await page.mouse.up();
      await page.waitForTimeout(300);
      const m2 = await page.evaluate((b) => window.__store.getState().getMap(b), bookId);
      const moved = m2.nodes.find((n) => n.id === n0.id);
      check(moved.x !== n0.x || moved.y !== n0.y, `[${tag}] déplacement enregistré (${n0.x},${n0.y}) → (${moved.x},${moved.y})`);

      // ── Placement des autres extraits par setMap (positions étalées) + 1 idée
      const layoutPos = [
        [60, 0], [520, 0], [60, 270], [460, 270], [860, 270], [60, 540], [460, 540], [860, 540], [860, 0], [1260, 270],
      ];
      await page.evaluate(
        ({ bookId, ids, layoutPos }) => {
          const st = window.__store.getState();
          const nodes = ids.map((hid, i) => ({ id: `n${i}`, highlightId: hid, text: '', x: layoutPos[i][0], y: layoutPos[i][1] }));
          nodes.push({ id: 'nidea', highlightId: null, text: 'Le bon sens suffit-il sans méthode ?', x: 1260, y: 0 });
          st.setMap(bookId, { bookId, nodes, edges: [], viewport: null });
        },
        { bookId, ids, layoutPos },
      );
      await page.waitForTimeout(300);
      await page.evaluate(() => document.querySelector('.react-flow__controls button')); // noop
      await page.locator('[data-act=fit]').click();
      await page.waitForTimeout(700);
      await shot(page, `shots/map/${tag}-3-noeuds.png`);
      await page.locator('.map-drawer header .icon-btn').click();
      await page.waitForTimeout(300);
      await page.locator('[data-act=fit]').click();
      await page.waitForTimeout(700);

      // ── Connexion par glisser, menu de relation, persistance
      const handle = async (nid, side) => page.locator(`.react-flow__node[data-id="${nid}"] .map-h-${side}`).boundingBox();
      const dragConnect = async (from, fromSide, to, toSide) => {
        const a = await handle(from, fromSide);
        const b = await handle(to, toSide);
        await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
        await page.mouse.down();
        await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 12 });
        await page.mouse.up();
        await page.waitForTimeout(250);
      };
      // n2 (argument) → n1 (thèse)
      await dragConnect('n2', 't', 'n1', 'b');
      check((await page.locator('[data-testid=map-edge-menu]').count()) === 1, `[${tag}] menu de relation à la connexion`);
      let mm = await page.evaluate((b) => window.__store.getState().getMap(b), bookId);
      check(mm.edges.length === 1 && mm.edges[0].relation === 'lien' && mm.edges[0].source === 'n2' && mm.edges[0].target === 'n1', `[${tag}] nouvelle connexion = « lien » neutre, dans le sens du geste`);
      await page.locator('[data-rel=objecte]').click();
      await page.waitForTimeout(200);
      mm = await page.evaluate((b) => window.__store.getState().getMap(b), bookId);
      check(mm.edges.length === 1 && mm.edges[0].relation === 'objecte', `[${tag}] changement de relation → objecte à`);

      // Cartes complètes : une arête par relation + co-prémisses
      await page.evaluate((bookId) => {
        const st = window.__store.getState();
        const e = (id, source, target, relation, groupId = null) => ({ id, source, target, relation, groupId });
        const m = st.getMap(bookId);
        st.setMap(bookId, {
          ...m,
          edges: [
            e('e1', 'n2', 'n1', 'soutient'),
            e('e2', 'n4', 'n1', 'objecte'),
            e('e3', 'n5', 'n2', 'illustre'),
            e('e4', 'n6', 'n3', 'precise'),
            e('e5', 'nidea', 'n4', 'repond'),
          ],
        });
      }, bookId);
      await page.waitForTimeout(400);
      await page.locator('[data-act=fit]').click();
      await page.waitForTimeout(700);
      await page.mouse.click(5, 5); // referme tout menu
      await shot(page, `shots/map/${tag}-4-relations.png`);

      // Co-prémisses : n2 et n3 → n1, groupés via le menu
      await dragConnect('n3', 't', 'n1', 'b');
      await page.keyboard.press('Escape');
      mm = await page.evaluate((b) => window.__store.getState().getMap(b), bookId);
      const toN1 = mm.edges.filter((x) => x.target === 'n1');
      check(toN1.length === 3, `[${tag}] 3 liens vers la thèse (${toN1.length})`);
      const eN2 = toN1.find((x) => x.source === 'n2');
      const eN3 = toN1.find((x) => x.source === 'n3');
      // ouvrir le menu de l'arête n2→n1 par clic sur sa pastille
      await page.evaluate(() => {});
      const pills = page.locator('.map-pill');
      const pillCount = await pills.count();
      let opened = false;
      for (let i = 0; i < pillCount && !opened; i++) {
        await pills.nth(i).click({ force: true });
        await page.waitForTimeout(150);
        const sel = await page.evaluate(() => document.querySelector('[data-testid=map-edge-menu] .map-menu-sub')?.textContent || '');
        if (sel.includes('Argument') && sel.includes('Thèse')) {
          const mates = await page.evaluate((id) => id, eN2.id);
          opened = !!mates;
          // vérifier qu'on a bien l'arête n2→n1
          const edgeId = await page.evaluate(() => document.querySelector('.map-pill.sel') && true);
          if (!edgeId) opened = false;
          else {
            await page.locator('[data-act=group]').click();
            const mateBtns = page.locator('.map-menu-mate');
            const c = await mateBtns.count();
            if (c > 0) {
              // choisir le lien dont l'étiquette commence par « Argument » (n3), à défaut le premier
              let done = false;
              for (let k = 0; k < c && !done; k++) {
                const t = await mateBtns.nth(k).innerText();
                if (t.startsWith('Argument')) {
                  await mateBtns.nth(k).click();
                  done = true;
                }
              }
              if (!done) await mateBtns.first().click();
            } else opened = false;
          }
        } else await page.keyboard.press('Escape');
      }
      await page.waitForTimeout(300);
      mm = await page.evaluate((b) => window.__store.getState().getMap(b), bookId);
      const grouped = mm.edges.filter((x) => x.groupId);
      check(grouped.length >= 2 && new Set(grouped.map((x) => x.groupId)).size === 1 && grouped.every((x) => x.target === 'n1'), `[${tag}] co-prémisses : groupId partagé sur ${grouped.length} liens`);
      await page.mouse.click(5, 5);
      await page.waitForTimeout(300);
      await shot(page, `shots/map/${tag}-5-coprémisses.png`);
      check((await page.locator('.map-together').count()) === 1, `[${tag}] faisceau étiqueté « ensemble »`);

      // Menu d'arête ouvert (capture)
      await page.locator('.map-pill').first().click({ force: true });
      await page.waitForTimeout(300);
      await shot(page, `shots/map/${tag}-6-menu-relation.png`);
      await page.keyboard.press('Escape');

      // Suppression au clavier : arête sélectionnée
      const before = mm.edges.length;
      await page.locator('.map-pill').last().click({ force: true });
      await page.keyboard.press('Escape');
      await page.locator('.react-flow__edge').last().click({ force: true, position: { x: 5, y: 5 } }).catch(() => {});

      // Persistance après remontage
      await page.evaluate((bookId) => window.__store.setState({ route: { name: 'reader', bookId, tab: 'lecture', splitBookId: null } }), bookId);
      await page.waitForTimeout(500);
      await openMap();
      await page.waitForSelector('.react-flow__node');
      await page.waitForTimeout(500);
      const after = await page.evaluate((b) => window.__store.getState().getMap(b), bookId);
      check(after.edges.length >= before - 1 && after.nodes.length === 11, `[${tag}] carte conservée après remontage (${after.nodes.length} nœuds, ${after.edges.length} liens)`);
      const domPos = await page.evaluate(() => {
        const n = document.querySelector('.react-flow__node[data-id="n1"]');
        return n ? n.style.transform : '';
      });
      check(domPos.includes('520px'), `[${tag}] position relue dans le DOM (${domPos})`);

      // Organiser
      await page.locator('[data-act=organise]').click();
      await page.waitForTimeout(1100);
      await shot(page, `shots/map/${tag}-7-organiser.png`);
      const org = await page.evaluate((b) => window.__store.getState().getMap(b), bookId);
      const y = (id) => org.nodes.find((n) => n.id === id).y;
      check(y('n1') < y('n2') && y('n2') < y('n5'), `[${tag}] organiser : thèse au-dessus des arguments, au-dessus des exemples`);

      // Double-clic sur un extrait → saute au livre
      // ── Arguments
      await page.evaluate(() => window.__store.setState({ route: { name: 'arguments', argumentId: null } }));
      await page.waitForSelector('[data-testid=arg-empty]');
      await page.waitForTimeout(400);
      await shot(page, `shots/map/${tag}-8-arguments-vide.png`);

      await page.locator('[data-act=new-arg]').click();
      await page.waitForSelector('[data-testid=arg-editor]');
      console.log('N après clic', await page.evaluate(() => window.__store.getState().arguments.length));
      await page.waitForFunction(() => document.activeElement?.classList.contains('arg-title'));
      await page.keyboard.type('Pourquoi nos opinions divergent');
      // Lier le livre
      await page.selectOption('#arg-book-sel', bookId);
      const ta = (i) => page.locator('.arg-premises .arg-step-text').nth(i);
      await ta(0).click();
      await page.keyboard.type('Le bon sens est également partagé entre tous les hommes');
      await page.keyboard.press('Enter');
      await page.keyboard.type('Or les opinions diffèrent d’un homme à l’autre');
      await page.keyboard.press('Enter');
      const nPrem = await page.locator('.arg-premises .arg-step').count();
      check(nPrem === 3, `[${tag}] Entrée en fin de prémisse crée P3 (${nPrem})`);
      // P2 implicite
      await page.locator('.arg-step[data-step=P2] .arg-implicit input').check();
      // P3 depuis un extrait
      await page.locator('.arg-step[data-step=P3] [data-act=pick]').click();
      await page.waitForSelector('[data-testid=arg-picker]');
      await page.waitForTimeout(250);
      await shot(page, `shots/map/${tag}-9-selecteur-extraits.png`);
      await page.locator('.arg-picker-item[data-hl=h2]').click();
      await page.locator('.arg-step.conclusion .arg-step-text').click();
      await page.keyboard.type('La diversité des opinions ne tient pas à une inégalité de raison');
      await page.locator('.arg-comment').click();
      await page.keyboard.type('Valide si P2 est complétée ; P1 est la prémisse contestable.');
      await page.waitForTimeout(500);
      await page.mouse.click(700, 60);
      const arg = await page.evaluate(() => window.__store.getState().arguments.find((a) => a.title) ?? null);
      console.log('ARGS', await page.evaluate(() => window.__store.getState().arguments.map((a) => a.title + '/' + a.premises.length)));
      check(arg && arg.premises.length === 3, `[${tag}] argument créé avec 3 prémisses`);
      check(arg.premises[1].implicit === true && arg.premises[0].implicit === false, `[${tag}] P2 implicite`);
      check(arg.premises[2].highlightId === 'h2' && arg.premises[2].text.includes('diversité de nos opinions'), `[${tag}] P3 copiée depuis l’extrait et liée`);
      check(arg.conclusion.text.startsWith('La diversité') && arg.bookId === bookId && arg.title.startsWith('Pourquoi'), `[${tag}] conclusion, livre, titre`);
      const prev = await page.locator('[data-testid=arg-preview] pre').innerText();
      check(prev.includes('P1.') && prev.includes('[implicite]') && prev.includes('C. ') && prev.includes('Descartes'), `[${tag}] aperçu forme standard avec référence`);
      await page.locator('.arg-stage').evaluate((el) => (el.scrollTop = 0));
      await shot(page, `shots/map/${tag}-10-arguments.png`);
      await page.locator('.arg-stage').evaluate((el) => (el.scrollTop = el.scrollHeight));
      await page.waitForTimeout(200);
      await shot(page, `shots/map/${tag}-11-arguments-bas.png`);

      // Suppression avec confirmation maison
      await page.locator('[data-act=new-arg]').click();
      await page.waitForTimeout(300);
      check((await page.evaluate(() => window.__store.getState().arguments.length)) === 2, `[${tag}] second argument créé`);
      await page.locator('[data-act=delete]').click();
      await page.waitForTimeout(250);
      check((await page.locator('[data-act=confirm-delete]').count()) === 1, `[${tag}] confirmation maison affichée`);
      await page.locator('[data-act=confirm-delete]').click();
      await page.waitForTimeout(300);
      check((await page.evaluate(() => window.__store.getState().arguments.length)) === 1, `[${tag}] suppression confirmée`);
      check(errors.filter((e) => !/favicon|404/.test(e)).length === 0, `[${tag}] aucune erreur navigateur`);
    },
    { dark },
  );
}

await run(false);
await run(true);
console.log(failures ? `\n${failures} ÉCHEC(S)` : '\nTOUT PASSE');
process.exit(failures ? 1 : 0);
