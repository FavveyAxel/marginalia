// Suite de scripts/test-collab.mjs (lancée par lui) : écrit et carte en direct, limites, coupure, arrêt, trafic.
import path from 'node:path';
import { execFileSync } from 'node:child_process';

export async function run(ctx, h) {
  const { A, B, C, seeded, code, headless, wire, proxyPort } = ctx;
  const { ok, wait, st, until, shotBoth, collabNet } = h;
  const draftOf = (X) => st(X.page, () => window.__store.getState().drafts.find((d) => d.title === 'Le parjure')?.id);
  const boardOf = (X) => st(X.page, () => Object.entries(window.__store.getState().maps).find(([, m]) => m.kind === 'board')?.[0]);
  const text = (X) => st(X.page, () => window.__ed?.engine()?.plainText() ?? '');
  async function openDraft(X) {
    const id = await draftOf(X);
    await X.page.evaluate((id) => window.__store.getState().navigate({ name: 'write', draftId: id }), id);
    await X.page.waitForFunction((id) => window.__ed && window.__ed.engine() && document.querySelector('.ed-engine-in') && window.__store.getState().route.draftId === id, id, { timeout: 60000 });
    await X.page.waitForSelector('[data-testid="ed-live"]', { timeout: 20000 });
    await wait(800);
    return id;
  }
  /** Frappe au clavier à la fin du document. */
  async function typeAtEnd(X, s) {
    await X.page.evaluate(() => {
      const e = window.__ed.engine();
      e.focus();
      e.goTo(e.docEnd());
    });
    await wait(150);
    await X.page.keyboard.press('End');
    await X.page.keyboard.type(s, { delay: 12 });
  }

  // ── 3. Écrit en direct ──
  await openDraft(A);
  await openDraft(B);
  ok((await text(A)).includes('Premier paragraphe') && (await text(B)).includes('Premier paragraphe'), 'Léa et Marc ouvrent l’écrit : même texte (Marc s’est synchronisé sur la salle)');
  const roomMode = await st(B.page, () => document.querySelector('[data-testid="ed-live"]')?.textContent);
  ok(/En direct/.test(roomMode), 'éditeur : « En direct »', roomMode);
  const TB = ' Marc écrit ici en direct.';
  await typeAtEnd(B, TB);
  const seenA = await until(A.page, (t) => window.__ed.engine().plainText().includes(t.trim()), TB, 15000);
  ok(seenA, 'texte tapé chez Marc visible chez Léa', (await text(A)).slice(-80));
  const TA = ' Léa répond aussitôt.';
  await typeAtEnd(A, TA);
  ok(await until(B.page, (t) => window.__ed.engine().plainText().includes(t.trim()), TA, 15000), 'texte tapé chez Léa visible chez Marc');
  await openDraft(C);
  ok((await text(C)).includes(TB.trim()) && (await text(C)).includes(TA.trim()), 'Inès ouvre l’écrit ensuite : elle a tout (salle gardée par l’hôte)');
  ok((await text(A)) === (await text(B)) && (await text(B)) === (await text(C)), 'les trois textes sont identiques');
  // Curseurs : Léa voit ceux de Marc et d'Inès (prénom et couleur).
  await B.page.evaluate(() => {
    const e = window.__ed.engine();
    e.goTo(Math.max(2, Math.floor(e.docEnd() / 2)));
  });
  await C.page.evaluate(() => window.__ed.engine().goTo(3));
  await wait(400);
  await typeAtEnd(B, ' ');
  await C.page.keyboard.type('·', { delay: 10 });
  const cursors = await until(A.page, () => {
    const labels = [...document.querySelectorAll('.presentation-editor__selection-layer--remote *')].map((e) => e.textContent.trim()).filter(Boolean);
    return labels.includes('Marc') && labels.includes('Inès');
  }, null, 15000);
  const labels = await st(A.page, () => [...new Set([...document.querySelectorAll('.presentation-editor__selection-layer--remote *')].map((e) => e.textContent.trim()).filter(Boolean))]);
  ok(cursors, 'Léa voit les curseurs nommés de Marc et d’Inès', labels);
  const colors = await st(A.page, () => [...document.querySelectorAll('.presentation-editor__selection-layer--remote *')].filter((e) => e.textContent.trim() === 'Marc').map((e) => getComputedStyle(e).backgroundColor));
  ok(colors.some((c) => c === 'rgb(29, 78, 216)'), 'curseur de Marc dans sa couleur', colors);
  const chip = await st(A.page, () => document.querySelector('[data-testid="ed-live"]')?.getAttribute('title'));
  ok(/Marc/.test(chip) && /Inès/.test(chip), 'éditeur de Léa : « Écrivent aussi ici : Marc, Inès »', chip);
  await shotBoth(A.page, '.ed-root', '08-ecrit-curseurs', { full: true });
  // Enregistrements : chacun a son exemplaire à jour.
  await wait(2500);

  // ── 4. Carte en direct, groupes, extraits ──
  const kA = await boardOf(A);
  const kB = await boardOf(B);
  await B.page.evaluate((k) => {
    const s = window.__store.getState();
    const m = s.maps[k];
    s.setMap(k, { ...m, nodes: [...m.nodes, { id: 'nB', highlightId: null, text: 'Carte de Marc', x: 120, y: 260 }], edges: [...m.edges, { id: 'eB', source: 'n2', target: 'nB', relation: 'soutient', groupId: null }] });
  }, kB);
  const mapSeen = await until(A.page, (k) => {
    const m = window.__store.getState().maps[k];
    return m.nodes.some((n) => n.text === 'Carte de Marc') && m.edges.some((e) => e.source === 'n2' && e.target === 'nB');
  }, kA, 15000);
  ok(mapSeen, 'carte ajoutée et reliée chez Marc : visible chez Léa');
  await A.page.evaluate((k) => {
    const s = window.__store.getState();
    const m = s.maps[k];
    s.setMap(k, { ...m, nodes: m.nodes.map((n) => (n.id === 'nB' ? { ...n, x: 640, y: 300 } : n)) });
  }, kA);
  ok(await until(B.page, (k) => window.__store.getState().maps[k].nodes.find((n) => n.id === 'nB')?.x === 640, kB, 15000), 'carte déplacée chez Léa : nouvelle position chez Marc');
  // Deux déplacements en même temps (deux cartes différentes) : les deux gagnent.
  await Promise.all([
    A.page.evaluate((k) => {
      const s = window.__store.getState();
      const m = s.maps[k];
      s.setMap(k, { ...m, nodes: m.nodes.map((n) => (n.id === 'n1' ? { ...n, x: -200 } : n)) });
    }, kA),
    B.page.evaluate((k) => {
      const s = window.__store.getState();
      const m = s.maps[k];
      s.setMap(k, { ...m, nodes: m.nodes.map((n) => (n.id === 'n2' ? { ...n, y: 500 } : n)) });
    }, kB),
  ]);
  await wait(1500);
  const posA = await st(A.page, (k) => window.__store.getState().maps[k].nodes.map((n) => `${n.id}:${n.x},${n.y}`).sort().join(' '), kA);
  const posB = await st(B.page, (k) => window.__store.getState().maps[k].nodes.map((n) => `${n.id}:${n.x},${n.y}`).sort().join(' '), kB);
  ok(posA === posB && posA.includes('n1:-200') && posA.includes(',500'), 'deux cartes déplacées en même temps (Léa, Marc) : les deux positions gardées, partout', posA);
  // Inès supprime une carte : disparue chez Léa et Marc, avec son lien.
  const kC = await boardOf(C);
  await C.page.evaluate((k) => {
    const s = window.__store.getState();
    const m = s.maps[k];
    s.setMap(k, { ...m, nodes: m.nodes.filter((n) => n.id !== 'n2'), edges: m.edges.filter((e) => e.source !== 'n2' && e.target !== 'n2') });
  }, kC);
  ok(await until(A.page, (k) => !window.__store.getState().maps[k].nodes.some((n) => n.id === 'n2') && !window.__store.getState().maps[k].edges.length, kA, 15000), 'carte supprimée chez Inès : disparue chez Léa (lien compris)');
  // Vue de la carte chez Léa (capture).
  await A.page.evaluate((k) => window.__store.getState().navigate({ name: 'board', boardId: k }), kA);
  await A.page.waitForSelector('.react-flow__node', { timeout: 20000 }).catch(() => {});
  await wait(1200);
  await shotBoth(A.page, 'main.main', '09-carte-en-direct');
  // Groupe créé par Inès, écrit rangé dedans.
  await C.page.evaluate(() => {
    const s = window.__store.getState();
    const ws = window.__collab.state.getState().workspaceId;
    const g = s.createGroup(ws, null, 'Arguments');
    const it = s.wsItems.find((i) => i.workspaceId === ws && i.kind === 'draft');
    s.moveWsItem(it.id, g.id);
  });
  ok(
    await until(A.page, (ws) => {
      const s = window.__store.getState();
      const g = s.groups.find((x) => x.workspaceId === ws && x.name === 'Arguments');
      return g && s.wsItems.some((i) => i.workspaceId === ws && i.kind === 'draft' && i.groupId === g.id);
    }, seeded.ws, 15000),
    'groupe créé par Inès (écrit rangé dedans) : chez Léa aussi',
  );
  ok(await until(B.page, () => window.__store.getState().groups.some((g) => g.name === 'Arguments'), null, 15000), '… et chez Marc');
  // Extrait : note modifiée par Marc, puis extrait supprimé → corbeille de chacun.
  await B.page.evaluate(() => {
    const s = window.__store.getState();
    const h = s.highlights.find((x) => x.text.startsWith('la diversité'));
    s.updateHighlight(h.id, { note: 'Note ajoutée par Marc' });
  });
  ok(await until(A.page, () => window.__store.getState().highlights.some((x) => x.note === 'Note ajoutée par Marc'), null, 15000), 'note d’extrait écrite par Marc : chez Léa');
  await B.page.evaluate(() => {
    const s = window.__store.getState();
    s.removeHighlight(s.highlights.find((x) => x.text.startsWith('la diversité')).id);
  });
  ok(await until(A.page, () => window.__store.getState().highlights.length === 1 && window.__store.getState().trash.some((t) => t.kind === 'highlight'), null, 15000), 'extrait supprimé par Marc : dans la corbeille de Léa');
  ok(await until(C.page, () => window.__store.getState().highlights.length === 1 && window.__store.getState().trash.some((t) => t.kind === 'highlight'), null, 15000), '… et dans celle d’Inès');
  // Nouvel écrit créé par Marc dans l'espace : arrive chez les autres (fichier compris).
  await B.page.evaluate(async () => {
    const ws = window.__collab.state.getState().workspaceId;
    window.__store.getState().navigate({ name: 'workspace', workspaceId: ws, groupId: null });
    await window.__store.getState().importFiles([{ name: 'Brouillon de Marc.md', data: new TextEncoder().encode('# Brouillon de Marc\n\nUne idée nouvelle.\n').buffer }]);
  });
  const newDraft = await until(A.page, () => window.__store.getState().drafts.some((d) => d.title === 'Brouillon de Marc') && window.__store.getState().wsItems.filter((i) => i.kind === 'draft').length === 2, null, 20000);
  ok(newDraft, 'nouvel écrit de Marc dans l’espace : chez Léa (référence et fichier)');
  if (newDraft) {
    const len = await st(A.page, async () => {
      const d = window.__store.getState().drafts.find((x) => x.title === 'Brouillon de Marc');
      return (await window.marginalia.readFile(d.id, d.fileName)).byteLength;
    });
    ok(len > 1000, 'son .docx est bien arrivé', len);
  }

  // ── 5. Limite de 6 personnes ; demande refusée ──
  await A.page.evaluate((ws) => window.__store.getState().navigate({ name: 'workspace', workspaceId: ws, groupId: null }), seeded.ws);
  const mk = (name) => {
    const ev = [];
    const g = collabNet.createCollabGuest({ emit: (e) => ev.push(e), deviceName: () => `Poste-de-${name}` });
    const x = { g, ev, name };
    headless.push(x);
    return x;
  };
  // Refus.
  const refused = mk('Refusé');
  const fr = await refused.g.find(code, { profile: { name: 'Refusé', color: '#be123c' } });
  const pr = refused.g.join(fr.ticket).then(() => null, (e) => e);
  await A.page.waitForSelector('[data-testid="collab-asks"] [data-testid="collab-request"]', { timeout: 20000 });
  await A.page.click('[data-testid="collab-asks"] [data-testid="collab-reject"]');
  const er = await pr;
  ok(er && /L’hôte a refusé votre demande/.test(er.message), 'demande refusée par Léa : « L’hôte a refusé votre demande. »', er && er.message);
  // Trois de plus : 6 personnes.
  for (const n of ['Paul', 'Zoé', 'Noé']) {
    const x = mk(n);
    const f = await x.g.find(code, { profile: { name: n, color: '#7e22ce' } });
    const p = x.g.join(f.ticket);
    await A.page.waitForSelector('[data-testid="collab-asks"] [data-testid="collab-request"]', { timeout: 20000 });
    await A.page.click('[data-testid="collab-asks"] [data-testid="collab-accept"]');
    await p;
  }
  const six = await until(A.page, () => window.__collab.state.getState().members.length === 6, null, 10000);
  ok(six, 'six personnes (hôte compris)');
  ok(await until(B.page, () => document.querySelector('[data-testid="ws-collab-badge"]')?.textContent.trim() === '6', null, 10000), 'encadré chez Marc : « 6 »');
  const seventh = mk('Septième');
  const e7 = await seventh.g.find(code, { profile: { name: 'Septième', color: '#0f766e' } }).then(() => null, (e) => e);
  ok(e7 && /déjà 6 personnes/.test(e7.message), '7e personne refusée : « Cet espace accueille déjà 6 personnes… »', e7 && e7.message);
  // La 7e par l'interface : message montré tel quel.
  await A.page.click('button[aria-label="Actions"]').catch(() => {});
  await A.page.keyboard.press('Escape');
  for (const x of headless) x.g.leave();
  ok(await until(A.page, () => window.__collab.state.getState().members.length === 3, null, 10000), 'les invités sans interface partent : retour à 3');

  // ── 6. Inès coupée : elle continue seule, revient, tout est réuni ──
  await openDraft(C).catch(() => {});
  await openDraft(A).catch(() => {});
  await C.page.evaluate(() => window.marginalia.collabNet.cut(7000));
  ok(await until(C.page, () => window.__collab.state.getState().phase === 'reconnecting', null, 10000), 'Inès coupée : « Connexion perdue : vous continuez seul »');
  ok(await until(C.page, () => /Connexion perdue/.test(document.querySelector('[data-testid="ed-live"]')?.textContent ?? ''), null, 5000), 'éditeur d’Inès : « Connexion perdue : vous continuez seul »');
  const TC = ' Inès écrit hors connexion.';
  await typeAtEnd(C, TC);
  const TA2 = ' Léa écrit pendant la coupure.';
  await typeAtEnd(A, TA2);
  await C.page.evaluate(() => {
    const s = window.__store.getState();
    const [k, m] = Object.entries(s.maps).find(([, m]) => m.kind === 'board');
    s.setMap(k, { ...m, nodes: [...m.nodes, { id: 'nC', highlightId: null, text: 'Carte d’Inès hors connexion', x: 0, y: 600 }] });
  });
  await wait(1000);
  ok(!(await text(A)).includes(TC.trim()), 'pendant la coupure : rien d’Inès n’arrive (elle est vraiment coupée)');
  const back = await until(C.page, () => window.__collab.state.getState().phase === 'live', null, 30000);
  ok(back, 'Inès revient d’elle-même');
  ok(await until(A.page, (t) => window.__ed.engine().plainText().includes(t), TC.trim(), 20000), 'son texte écrit hors connexion arrive chez Léa');
  ok(await until(C.page, (t) => window.__ed.engine().plainText().includes(t), TA2.trim(), 20000), 'le texte de Léa écrit pendant la coupure arrive chez Inès');
  ok(await until(A.page, () => Object.values(window.__store.getState().maps).some((m) => m.nodes.some((n) => n.text === 'Carte d’Inès hors connexion')), null, 20000), 'sa carte ajoutée hors connexion arrive chez Léa');
  ok(await until(B.page, () => Object.values(window.__store.getState().maps).some((m) => m.nodes.some((n) => n.text === 'Carte d’Inès hors connexion')), null, 20000), '… et chez Marc');
  await wait(1500);
  const [ta, tb, tc] = [await text(A), await st(B.page, () => window.__ed?.engine()?.plainText() ?? null), await text(C)];
  ok(ta === tc && ta.includes(TB.trim()) && ta.includes(TA.trim()) && ta.includes(TC.trim()) && ta.includes(TA2.trim()), 'après la reconnexion : Léa et Inès ont le même texte, rien de perdu');

  // ── 7. Léa arrête le partage : chacun garde son exemplaire à jour ──
  await wait(2500);
  await A.page.evaluate((ws) => window.__store.getState().navigate({ name: 'workspace', workspaceId: ws, groupId: null }), seeded.ws);
  await A.page.click('button[aria-label="Actions"]');
  await A.page.getByText('Arrêter le partage').click();
  ok(await until(B.page, () => window.__collab.state.getState().role === null, null, 20000), 'Marc : session terminée');
  ok(await until(C.page, () => window.__collab.state.getState().role === null, null, 20000), 'Inès : session terminée');
  const toasts = await st(B.page, () => [...document.querySelectorAll('.toast')].map((t) => t.textContent).join(' | '));
  ok(/a arrêté le partage : votre exemplaire est à jour/.test(toasts), 'Marc : « Léa a arrêté le partage : votre exemplaire est à jour. »', toasts.slice(0, 200));
  for (const X of [A, B, C]) ok(await until(X.page, () => !document.querySelector('.ws-node.ws-collab'), null, 10000), `${X.name} : l’encadré disparaît`);
  // Fichier .docx de Marc (écrit fermé chez lui) : à jour, avec tout le texte.
  const docB = await st(B.page, async () => {
    const d = window.__store.getState().drafts.find((x) => x.title === 'Le parjure');
    const b = new Uint8Array(await window.marginalia.readFile(d.id, d.fileName));
    let s = '';
    for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
    return btoa(s);
  });
  const xml = execFileSync('python3', ['-I', '-c', 'import sys,zipfile,io,base64;print(zipfile.ZipFile(io.BytesIO(base64.b64decode(sys.stdin.read()))).read("word/document.xml").decode())'], { input: docB, encoding: 'utf8' });
  const plain = xml.replace(/<[^>]+>/g, '');
  ok([TB, TA, TC, TA2].every((t) => plain.includes(t.trim())), 'exemplaire de Marc (.docx sur son disque) : à jour, tout le texte', plain.slice(-160));
  // Inès continue seule ; rien ne part plus.
  await typeAtEnd(C, ' Après l’arrêt.');
  await wait(1500);
  ok((await text(C)).includes('Après l’arrêt.') && !(await text(A)).includes('Après l’arrêt.'), 'après l’arrêt, Inès continue seule ; rien n’arrive chez Léa');

  // ── 8. Rien en clair dans le trafic (relais d'écoute sur le chemin de Marc) ──
  const all = Buffer.concat(wire);
  ok(all.length > 20000 && all.includes(Buffer.from('mg-collab')), 'le relais a bien vu passer la session de Marc', { octets: all.length, port: proxyPort });
  const secrets = ['Parjure', 'Léa', 'Marc', 'Inès', 'Promesse', 'Idée de Léa', 'Carte de Marc', 'Le bon sens', 'Premier paragraphe', TB.trim(), TA.trim(), TC.trim(), 'Note ajoutée par Marc', code];
  const hits = secrets.filter((x) => all.includes(Buffer.from(x)) || all.includes(Buffer.from(x, 'utf16le')));
  ok(hits.length === 0, 'ni code, ni prénoms, ni titre, ni texte, ni cartes en clair', hits);
  void path;
}
