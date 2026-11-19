// Espaces chiffrés, cœur (sans l'app) : chiffrement des capsules et des fichiers (electron/spaces.cjs)
// et partage de la base entre le fichier commun et les capsules (src/lib/spaces.ts).
// Lancer : npx tsx scripts/test-spaces-core.mjs
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const require = createRequire(import.meta.url);
const K = require(path.join(ROOT, 'electron/spaces.cjs'));
const { spaceScope, splitDb, mergeCapsule, withoutCapsule, parseCapsule } = await import(path.join(ROOT, 'src/lib/spaces.ts'));
const ok = (c, m, extra = '') => {
  console.log((c ? 'OK   ' : 'ÉCHEC ') + m + (extra !== '' ? ' — ' + (typeof extra === 'string' ? extra : JSON.stringify(extra)) : ''));
  if (!c) process.exitCode = 1;
};
const fails = (fn) => { try { fn(); return false; } catch { return true; } };

// ── 1. Clés et scellement ──
const { ks, sk, recoveryKey } = await K.createKeystore('mot de passe commun');
ok(K.validKeystore(ks) && !JSON.stringify(ks).includes(sk.toString('base64').slice(0, 10)), 'fichier de clés : la clé maîtresse n’y est pas en clair');
ok((await K.unlock(ks, 'mot de passe commun')).equals(sk), 'bon mot de passe : clé rendue');
ok((await K.unlock(ks, recoveryKey)).equals(sk), 'clé de secours : clé rendue');
ok((await K.unlock(ks, 'mauvais')) === null && (await K.unlock(ks, '')) === null, 'mauvais mot de passe : refusé');
const secret = 'JOURNAL-' + crypto.randomBytes(6).toString('hex');
const blob = K.sealCapsule(sk, 'ws-a', JSON.stringify({ v: 1, wsId: 'ws-a', texte: secret.repeat(50) }));
ok(!Buffer.from(blob, 'base64').includes(Buffer.from(secret)) && !blob.includes(secret), 'capsule scellée : aucun fragment du contenu');
ok(K.openCapsule(sk, 'ws-a', blob).includes(secret), 'capsule rouverte avec la clé de son espace');
ok(fails(() => K.openCapsule(sk, 'ws-b', blob)), 'capsule d’un espace : illisible avec la clé d’un autre espace');
ok(fails(() => K.openCapsule(crypto.randomBytes(32), 'ws-a', blob)), 'autre clé maîtresse : refusé');
const raw = Buffer.from(blob, 'base64');
let accepted = 0;
for (let i = 0; i < raw.length; i += 3) { const t = Buffer.from(raw); t[i] ^= 4; if (!fails(() => K.openCapsule(sk, 'ws-a', t.toString('base64')))) accepted++; }
ok(accepted === 0, 'capsule altérée (un bit, partout) : toujours refusée', accepted);
const f = K.seal(sk, 'ws-a', Buffer.from('contenu du fichier ' + secret));
ok(K.isSealed(f) && K.ownerOf(sk, f, ['ws-b', 'ws-a']) === 'ws-a' && K.ownerOf(sk, f, ['ws-b']) === null, 'fichier scellé : reconnu comme celui de son espace, pas d’un autre');
ok(K.open(sk, 'ws-a', f).toString().includes(secret) && fails(() => K.open(sk, 'ws-b', f)), 'fichier : lisible avec son espace seulement');
const g = K.seal(sk, 'ws-b', Buffer.from('autre'));
ok(fails(() => K.open(sk, 'ws-a', Buffer.concat([f.subarray(0, 16), g.subarray(16)]))), 'greffe d’un fichier d’un autre espace sous cet en-tête : refusée');
ok(!K.isSpaceId('__proto__') && !K.isSpaceId('../x') && K.isSpaceId('ws-a'), 'identifiants d’espace contrôlés');

// ── 2. Appartenance et partage de la base ──
const book = (id) => ({ id, title: 'Livre ' + id });
const db = {
  version: 2,
  workspaces: [{ id: 'A', name: 'Privé', encrypted: true }, { id: 'B', name: 'Autre chiffré', encrypted: true }, { id: 'P', name: 'Normal' }],
  wsItems: [
    { id: 'i1', workspaceId: 'A', kind: 'draft', refId: 'd-secret', groupId: 'g1', order: 0 },
    { id: 'i2', workspaceId: 'A', kind: 'book', refId: 'b-secret', groupId: null, order: 1 },
    { id: 'i3', workspaceId: 'A', kind: 'book', refId: 'b-commun', groupId: null, order: 2 },
    { id: 'i4', workspaceId: 'P', kind: 'book', refId: 'b-commun', groupId: null, order: 0 },
    { id: 'i5', workspaceId: 'A', kind: 'plan', refId: 'p-secret', groupId: null, order: 3 },
    { id: 'i6', workspaceId: 'P', kind: 'draft', refId: 'd-normal', groupId: null, order: 1 },
    { id: 'i7', workspaceId: 'B', kind: 'draft', refId: 'd-b', groupId: null, order: 0 },
    { id: 'i8', workspaceId: 'A', kind: 'map', refId: 'board-s', groupId: null, order: 4 },
  ],
  groups: [{ id: 'g1', workspaceId: 'A', parentId: null, name: 'Groupe secret' }, { id: 'g2', workspaceId: 'P', parentId: null, name: 'Groupe normal' }],
  books: [book('b-secret'), book('b-commun'), book('b-libre')],
  drafts: [{ id: 'd-secret', title: 'Journal' }, { id: 'd-normal', title: 'Dissertation' }, { id: 'd-plan', title: 'Écrit du plan' }, { id: 'd-b', title: 'Écrit de B' }, { id: 'd-libre', title: 'Sans espace' }],
  plans: [{ id: 'p-secret', title: 'Plan', draftId: 'd-plan', parts: [{ id: 'n', title: '', note: '', items: [{ id: 'x', ref: { kind: 'concept', id: 'c-secret' } }], children: [] }] }],
  highlights: [
    { id: 'h1', bookId: 'b-secret', text: 'extrait secret', conceptIds: ['c-secret', 'c-partage'] },
    { id: 'h2', bookId: 'b-commun', text: 'extrait commun', conceptIds: ['c-partage'] },
  ],
  concepts: [{ id: 'c-secret', name: 'Concept secret', senses: [], links: [] }, { id: 'c-partage', name: 'Concept partagé', senses: [], links: [] }, { id: 'c-libre', name: 'Libre', senses: [], links: [] }],
  maps: { 'b-secret': { bookId: 'b-secret', nodes: [], edges: [] }, 'board-s': { id: 'board-s', kind: 'board', bookId: '', nodes: [{ id: 'n1', conceptId: 'c-secret' }], edges: [] }, 'b-commun': { bookId: 'b-commun', nodes: [], edges: [] } },
  arguments: [{ id: 'a1', bookId: 'b-secret', title: 'Arg secret' }, { id: 'a2', bookId: 'b-commun', title: 'Arg commun' }],
  studies: [{ id: 's1', bookId: 'b-secret', title: 'Fiche secrète' }],
  cards: [{ id: 'k1', bookId: 'b-secret', highlightId: 'h1', conceptId: null }, { id: 'k2', bookId: null, highlightId: null, conceptId: 'c-secret' }, { id: 'k3', bookId: 'b-commun', highlightId: 'h2', conceptId: null }],
  bookmarks: [{ id: 'm1', bookId: 'b-secret' }, { id: 'm2', bookId: 'b-commun' }],
  trash: [{ id: 't1', refId: 'd-old', bookId: null, changes: [{ col: 'wsItems', id: 'z', before: { id: 'z', workspaceId: 'A' }, after: null }], files: [{ ownerId: 'd-old', fileName: 'x.docx' }] }, { id: 't2', refId: 'x', bookId: 'b-commun', changes: [], files: [] }],
  activity: [{ id: 'e1', at: 3, refId: 'd-secret', bookId: null, title: 'Journal modifié' }, { id: 'e2', at: 2, refId: 'd-normal', bookId: null, title: 'Dissertation' }, { id: 'e3', at: 1, refId: 'h1', bookId: 'b-secret', title: 'Extrait' }],
  mapVersions: [{ id: 'v1', mapKey: 'board-s', map: { nodes: [] } }, { id: 'v2', mapKey: 'b-commun', map: { nodes: [] } }],
  settings: {},
};
const c = spaceScope(db, 'A');
const ids = (l) => l.map((x) => x.id).sort().join(',');
ok(ids(c.drafts) === 'd-plan,d-secret', 'écrits de l’espace (dont celui de son plan)', ids(c.drafts));
ok(ids(c.books) === 'b-secret', 'livre seulement dans l’espace : chiffré ; livre aussi rangé ailleurs : commun', ids(c.books));
ok(ids(c.highlights) === 'h1' && ids(c.bookmarks) === 'm1' && ids(c.arguments) === 'a1' && ids(c.studies) === 's1', 'extraits, signets, reconstructions et fiches du livre de l’espace');
ok(Object.keys(c.maps).sort().join(',') === 'b-secret,board-s' && ids(c.mapVersions) === 'v1', 'cartes de l’espace et leurs versions', Object.keys(c.maps));
ok(ids(c.concepts) === 'c-secret', 'concept utilisé seulement dans l’espace : chiffré ; concept partagé avec un livre commun : commun', ids(c.concepts));
ok(ids(c.cards) === 'k1,k2', 'cartes de révision de ce contenu', ids(c.cards));
ok(ids(c.trash) === 't1' && ids(c.activity) === 'e1,e3', 'corbeille et journal : ce qui parle de l’espace le suit', [ids(c.trash), ids(c.activity)]);
ok(ids(c.groups) === 'g1' && c.wsItems.length === 5, 'groupes et rangements de l’espace');

const { main, capsules } = splitDb(db, ['A']);
const mainText = JSON.stringify(main);
ok(!/Journal|extrait secret|Concept secret|Arg secret|Fiche secrète|Groupe secret|b-secret|d-secret/.test(mainText), 'base commune : plus rien du contenu de l’espace', mainText.match(/Journal|extrait secret|Concept secret|Arg secret|Fiche secrète|Groupe secret|b-secret|d-secret/g));
ok(/Privé/.test(mainText) && /Dissertation/.test(mainText) && /Écrit de B/.test(mainText) && /Sans espace/.test(mainText), 'base commune : le nom de l’espace et tout le reste y sont');
ok(main.books === db.books ? false : main.settings === db.settings && main.workspaces === db.workspaces, 'collections non touchées : mêmes références (pas de réécriture inutile)');

// Aller-retour : verrouiller puis déverrouiller rend exactement les mêmes données.
const back = mergeCapsule(main, parseCapsule(JSON.stringify(capsules.A), 'A'));
const norm = (d) => JSON.stringify(Object.fromEntries(Object.entries(d).map(([k, v]) => [k, Array.isArray(v) ? [...v].sort((a, b) => String(a.id).localeCompare(String(b.id))) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).sort()) : v])));
ok(norm(back) === norm(db), 'verrouiller puis déverrouiller : aucune donnée perdue ni ajoutée');
const again = splitDb(back, ['A']);
ok(JSON.stringify(again.capsules.A) !== '' && norm(again.main) === norm(main) && norm(again.capsules.A) === norm(capsules.A), 'nouvel enregistrement après déverrouillage : même partage (stable)');
// Deux espaces chiffrés ouverts ensemble : rien ne revient en clair.
const two = splitDb(db, ['A', 'B']);
ok(!/Journal|Écrit de B/.test(JSON.stringify(two.main)) && ids(two.capsules.B.drafts) === 'd-b', 'deux espaces chiffrés ouverts : chacun garde son contenu, rien en clair');
// B verrouillé (absent du store) : le partage de A ne change pas.
const bLocked = withoutCapsule(db, spaceScope(db, 'B'));
ok(norm(splitDb(bLocked, ['A']).capsules.A) === norm(capsules.A), 'un autre espace verrouillé ne change pas ce qui appartient à celui-ci');
// Capsule piégée.
ok(parseCapsule('{"v":1,"wsId":"X"}', 'A') === null && parseCapsule('[]', 'A') === null && parseCapsule('{', 'A') === null, 'capsule d’un autre espace ou mal formée : refusée');
const evil = parseCapsule(JSON.stringify({ v: 1, wsId: 'A', wsItems: [{ id: 'e', workspaceId: 'P', kind: 'draft', refId: 'd-normal' }], groups: [{ id: 'g', workspaceId: 'P' }], maps: { __proto__: { nodes: [] } }, books: [null, 3, { id: 5 }] }), 'A');
ok(evil.wsItems.length === 0 && evil.groups.length === 0 && evil.books.length === 0 && {}.nodes === undefined, 'capsule piégée : rien d’étranger à l’espace, pas de pollution de prototype');
console.log(process.exitCode ? '\nDes vérifications ont échoué.' : '\nToutes les vérifications sont passées.');
