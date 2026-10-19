// Suite de scripts/test-collab.mjs (étape B) : après l'arrêt, Léa et Marc travaillent chacun de leur côté,
// puis Léa rouvre une session et Marc la rejoint : réunion sans second espace, version « Avant la
// reconnexion avec Léa », paragraphe modifié des deux côtés proposé au choix, carte : texte au choix,
// position (la dernière gagne), supprimé d'un côté / modifié de l'autre → gardé avec un message.
import { execFileSync } from 'node:child_process';

export async function run(ctx, h) {
  const { A, B, seeded } = ctx;
  const { ok, wait, st, until, shotBoth } = h;
  const draftOf = (X) => st(X.page, () => window.__store.getState().drafts.find((d) => d.title === 'Le parjure')?.id);
  async function openDraft(X) {
    const id = await draftOf(X);
    await X.page.evaluate((id) => window.__store.getState().navigate({ name: 'write', draftId: id }), id);
    await X.page.waitForFunction((id) => window.__ed && window.__ed.engine() && document.querySelector('.ed-engine-in') && window.__store.getState().route.draftId === id, id, { timeout: 60000 });
    await wait(800);
  }
  /** Remplace `from` par `to` dans l'écrit ouvert (comme une saisie), puis attend l'enregistrement. */
  async function replace(X, from, to) {
    const done = await X.page.evaluate(
      ({ from, to }) => {
        const ed = window.__ed.engine().debugEditor().editor;
        let pos = null;
        ed.state.doc.descendants((n, p) => {
          if (pos === null && n.isText && n.text.includes(from)) pos = p + n.text.indexOf(from);
        });
        if (pos === null) return false;
        document.querySelector('.ProseMirror')?.dispatchEvent(new Event('beforeinput', { bubbles: true }));
        ed.view.dispatch(ed.state.tr.insertText(to, pos, pos + from.length));
        return true;
      },
      { from, to },
    );
    return done;
  }
  async function closeEditor(X) {
    await X.page.evaluate((ws) => window.__store.getState().navigate({ name: 'workspace', workspaceId: ws, groupId: null }), await st(X.page, () => window.__store.getState().workspaces.find((w) => w.name.startsWith('Parjure'))?.id));
    await wait(2500);
  }
  const docText = async (X) => {
    const b64 = await st(X.page, async () => {
      const d = window.__store.getState().drafts.find((x) => x.title === 'Le parjure');
      const b = new Uint8Array(await window.marginalia.readFile(d.id, d.fileName));
      let s = '';
      for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
      return btoa(s);
    });
    const xml = execFileSync('python3', ['-I', '-c', 'import sys,zipfile,io,base64;print(zipfile.ZipFile(io.BytesIO(base64.b64decode(sys.stdin.read()))).read("word/document.xml").decode())'], { input: b64, encoding: 'utf8' });
    return xml.replace(/<\/w:p>/g, '\n').replace(/<[^>]+>/g, '');
  };
  const board = (X) => st(X.page, () => Object.entries(window.__store.getState().maps).find(([, m]) => m.kind === 'board'));

  // Mémoire de la session gardée chez chacun.
  for (const X of [A, B]) {
    const mem = await until(X.page, async () => {
      try {
        const idx = JSON.parse(new TextDecoder().decode(await window.marginalia.readFile('collab', 'index.json')));
        return idx.length === 1;
      } catch {
        return false;
      }
    }, null, 15000);
    ok(mem, `${X.name} : base commune de la session gardée (pour la prochaine réunion)`);
  }

  if (process.env.DBG) {
    for (const X of [A, B]) {
      const m = await st(X.page, async () => {
        const idx = JSON.parse(new TextDecoder().decode(await window.marginalia.readFile('collab', 'index.json')));
        const f = 'memoire-' + idx[0].replace(/[^A-Za-z0-9._-]/g, '_') + '.json';
        return JSON.parse(new TextDecoder().decode(await window.marginalia.readFile('collab', f))).drafts;
      });
      console.log('  [mémoire]', X.name, JSON.stringify(m).slice(0, 600));
      console.log('  [fichier]', X.name, (await docText(X)).slice(0, 400).replace(/\n/g, ' ¶ '));
    }
  }
  // ── Chacun de son côté ──
  await openDraft(A);
  ok(await replace(A, 'Premier paragraphe', 'Premier paragraphe selon Léa'), 'Léa (hors session) modifie le premier paragraphe');
  await A.page.evaluate(() => window.__ed.engine().appendParagraph('Ajout de Léa, fait hors session.'));
  await closeEditor(A);
  await openDraft(B);
  ok(await replace(B, 'Premier paragraphe', 'Premier paragraphe selon Marc'), 'Marc (hors session) modifie le même paragraphe');
  ok(await replace(B, 'la parole donnée engage', 'la parole donnée engage vraiment'), 'Marc modifie aussi le deuxième (Léa n’y touche pas)');
  await closeEditor(B);
  const [kA, mA] = await board(A);
  const [kB, mB] = await board(B);
  const nCid = mA.nodes.find((n) => n.text.startsWith('Carte d’Inès')).id;
  await A.page.evaluate(
    ({ k, nC }) => {
      const s = window.__store.getState();
      const m = s.maps[k];
      s.setMap(k, { ...m, nodes: m.nodes.map((n) => (n.id === nC ? { ...n, text: 'Carte d’Inès, relue par Léa' } : n.id === 'nB' ? { ...n, x: 900 } : n)) });
      const g = s.groups.find((x) => x.name === 'Arguments');
      s.patch('groups', g.id, { name: 'Arguments de Léa' });
    },
    { k: kA, nC: nCid },
  );
  await wait(400);
  await B.page.evaluate(
    ({ k, nC }) => {
      const s = window.__store.getState();
      const m = s.maps[k];
      s.setMap(k, { ...m, nodes: m.nodes.map((n) => (n.id === nC ? { ...n, text: 'Carte d’Inès, relue par Marc' } : n.id === 'nB' ? { ...n, text: 'Carte de Marc, revue' } : n)) });
      s.trashDelete('group', s.groups.find((x) => x.name === 'Arguments').id, { mode: 'lift', silent: true });
    },
    { k: kB, nC: nCid },
  );
  await wait(2500);

  // ── Léa rouvre une session ; Marc la rejoint ──
  await A.page.evaluate((ws) => window.__store.getState().navigate({ name: 'workspace', workspaceId: ws, groupId: null }), seeded.ws);
  await A.page.click('button[aria-label="Actions"]');
  await A.page.getByText('Travailler à plusieurs…').click();
  await A.page.waitForSelector('[data-testid="collab-start"]');
  ok((await A.page.inputValue('[data-testid="collab-name"]')) === 'Léa', 'Léa : prénom retenu');
  await A.page.click('[data-testid="collab-open"]');
  await A.page.waitForSelector('[data-testid="collab-code"]', { timeout: 30000 });
  const code = await A.page.getAttribute('[data-testid="collab-code"]', 'data-code');
  await A.page.keyboard.press('Escape');
  await B.page.evaluate(() => window.__store.getState().navigate({ name: 'import' }));
  await B.page.click('[data-testid="import-collab-open"]');
  await B.page.waitForSelector('[data-testid="join-form"]');
  ok((await B.page.inputValue('[data-testid="collab-name"]')) === 'Marc', 'Marc : prénom retenu');
  await B.page.fill('[data-testid="join-code"]', code);
  await B.page.click('[data-testid="join-go"]');
  await A.page.waitForSelector('[data-testid="collab-asks"] [data-testid="collab-accept"]', { timeout: 30000 });
  await A.page.click('[data-testid="collab-asks"] [data-testid="collab-accept"]');
  const asked = await B.page.waitForSelector('[data-testid="reunion-dialog"]', { timeout: 60000 }).then(() => true, () => false);
  ok(asked, 'Marc : fenêtre « Réunir avec Léa »');
  const items = await st(B.page, () => [...document.querySelectorAll('[data-testid="reunion-item"]')].map((e) => ({ kind: e.dataset.kind, mine: e.querySelector('[data-testid="reunion-mine"]').textContent, theirs: e.querySelector('[data-testid="reunion-theirs"]').textContent })));
  const para = items.find((i) => i.kind === 'paragraph');
  ok(para && para.mine === 'Premier paragraphe selon Marc : peut-on promettre sans mentir ?' && para.theirs === 'Premier paragraphe selon Léa : peut-on promettre sans mentir ?', 'paragraphe modifié des deux côtés : les deux versions entières, côte à côte (rien de mélangé)', para);
  const card = items.find((i) => i.kind === 'record');
  ok(card && card.mine === 'Carte d’Inès, relue par Marc' && card.theirs === 'Carte d’Inès, relue par Léa', 'carte : texte modifié des deux côtés → même choix', card);
  ok(items.length === 2, 'deux choix seulement (le reste est réuni tout seul)', items.length);
  const btns = await st(B.page, () => [...document.querySelector('[data-testid="reunion-item"]').querySelectorAll('button')].map((b) => b.textContent));
  ok(btns.join('|') === 'Garder la mienne|Garder celle de Léa|Garder les deux', 'choix : « Garder la mienne », « Garder celle de Léa », « Garder les deux »', btns);
  // Choix : les deux pour le paragraphe, celle de Léa pour la carte.
  await B.page.locator('[data-testid="reunion-item"][data-kind="paragraph"] [data-choice="both"]').click();
  await B.page.locator('[data-testid="reunion-item"][data-kind="record"] [data-choice="theirs"]').click();
  await shotBoth(B.page, '[data-testid="reunion-dialog"]', '10-reunion-choix');
  await B.page.click('[data-testid="reunion-go"]');
  ok(await until(B.page, () => window.__collab.state.getState().phase === 'live', null, 30000), 'Marc : réuni, en direct');

  // ── Vérifications chez Marc ──
  ok((await st(B.page, () => window.__store.getState().workspaces.filter((w) => w.name.startsWith('Parjure')).length)) === 1, 'aucun second espace chez Marc');
  const vB = await st(B.page, () => (window.__store.getState().drafts.find((d) => d.title === 'Le parjure').versions ?? []).map((v) => v.name).filter(Boolean));
  ok(vB.includes('Avant la reconnexion avec Léa'), 'Marc : version « Avant la reconnexion avec Léa » créée', vB);
  const tB = await docText(B);
  ok(/Premier paragraphe selon Marc/.test(tB) && /Premier paragraphe selon Léa/.test(tB), 'Marc : « Garder les deux » → les deux paragraphes', tB.split('\n').filter((l) => /Premier/.test(l)));
  ok(/engage vraiment/.test(tB) && /Ajout de Léa, fait hors session\./.test(tB) && (tB.match(/Deuxième paragraphe/g) ?? []).length === 1, 'Marc : sa modification (seul à l’avoir faite) et l’ajout de Léa réunis sans question, une seule fois');
  const order = tB.split('\n').filter((l) => l.trim()).map((l) => l.slice(0, 30));
  ok(order.findIndex((l) => /selon Marc/.test(l)) + 1 === order.findIndex((l) => /selon Léa/.test(l)) && order.findIndex((l) => /selon Léa/.test(l)) + 1 === order.findIndex((l) => /^Deuxième/.test(l)), 'ordre : le mien, celui de Léa, puis la suite', order);
  const [, mB2] = await board(B);
  const nC = mB2.nodes.find((n) => n.id === nCid);
  const nB = mB2.nodes.find((n) => n.id === 'nB');
  ok(nC?.text === 'Carte d’Inès, relue par Léa', 'carte : « Garder celle de Léa »', nC?.text);
  ok(nB?.text === 'Carte de Marc, revue' && nB?.x === 900, 'carte modifiée des deux côtés sur des points différents : texte de Marc, position de Léa', nB);
  const grpB = await st(B.page, () => window.__store.getState().groups.find((g) => g.name === 'Arguments de Léa') ? 'gardé' : 'absent');
  ok(grpB === 'gardé', 'groupe supprimé chez Marc mais renommé par Léa : gardé');
  const toasts = await st(B.page, () => [...document.querySelectorAll('.toast')].map((t) => t.textContent).join(' | '));
  ok(/supprimé chez vous, modifié par Léa — gardé/.test(toasts), 'message : « … supprimé chez vous, modifié par Léa — gardé. »', toasts.slice(0, 300));

  // ── Chez Léa ──
  ok(await until(A.page, (k) => window.__store.getState().maps[k].nodes.find((n) => n.id === 'nB')?.text === 'Carte de Marc, revue', kA, 20000), 'Léa reçoit le texte de carte de Marc');
  const tAok = await (async () => {
    for (let i = 0; i < 40; i++) {
      const t = await docText(A);
      if (/Premier paragraphe selon Marc/.test(t) && /engage vraiment/.test(t)) return t;
      await wait(500);
    }
    return docText(A);
  })();
  ok(/Premier paragraphe selon Marc/.test(tAok) && /Premier paragraphe selon Léa/.test(tAok) && /engage vraiment/.test(tAok) && /Ajout de Léa/.test(tAok), 'Léa : son exemplaire de l’écrit est réuni lui aussi', tAok.split('\n').slice(0, 6));
  const vA = await st(A.page, () => (window.__store.getState().drafts.find((d) => d.title === 'Le parjure').versions ?? []).map((v) => v.name).filter(Boolean));
  ok(vA.includes('Avant la reconnexion avec Marc'), 'Léa : version « Avant la reconnexion avec Marc » créée avant de recevoir', vA);
  // Ouvert ensuite en direct : le contenu réuni (la salle repart du fichier réuni).
  await openDraft(A);
  const live = await st(A.page, () => window.__ed.engine().plainText());
  ok(/selon Marc/.test(live) && /selon Léa/.test(live) && /engage vraiment/.test(live), 'Léa ouvre l’écrit en direct : le texte réuni');
  await openDraft(B);
  const liveB = await st(B.page, () => window.__ed.engine().plainText());
  ok(liveB === live, 'Marc ouvre le même écrit : même texte');
}
