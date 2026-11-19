// Journal de diagnostic : aucun texte de l'utilisateur cité dans les messages d'erreur (src/lib/diagScrub.ts).
// Lancer : npx tsx scripts/test-diag-scrub.mjs
import path from 'node:path';
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const { scrubDiag, diagError } = await import(path.join(ROOT, 'src/lib/diagScrub.ts'));
const ok = (c, m, extra = '') => {
  console.log((c ? 'OK   ' : 'ÉCHEC ') + m + (extra !== '' ? ' — ' + (typeof extra === 'string' ? extra : JSON.stringify(extra)) : ''));
  if (!c) process.exitCode = 1;
};

// ── 1. Erreur JSON de V8 qui cite le début du texte ──
let jsonErr;
try {
  JSON.parse('SECRET document du chapitre 3');
} catch (e) {
  jsonErr = e;
}
const j = scrubDiag(jsonErr.message);
ok(!j.includes('SECRET') && !j.includes('document'), 'JSON.parse : le texte cité disparaît', j);
ok(j.includes('is not valid JSON') && j.includes("'S'"), 'JSON.parse : la nature de l’erreur et le jeton court restent', j);
const jd = diagError(jsonErr);
ok(jd.startsWith('SyntaxError: ') && !jd.includes('SECRET'), 'diagError : « Nom: message » nettoyé, sans pile', jd);
const fake = scrubDiag('Unexpected token in JSON: "SECRET document tronqu');
ok(!fake.includes('SECRET') && /"\[\d+ car\.\]$/.test(fake), 'guillemet non refermé (message tronqué) : fin de ligne masquée', fake);
const esc = scrubDiag('Bad value "il a dit \\"bonjour madame\\" puis" ici');
ok(!esc.includes('bonjour') && esc.endsWith(' ici'), 'guillemets échappés dans une chaîne JSON', esc);

// ── 2. Guillemets français, typographiques, apostrophes ──
const g = scrubDiag('Livre « Le Rouge et le Noir » introuvable dans “Mes notes privées” et `ma clé` ou ‘mot caché’');
ok(!/Rouge|Noir|privées|clé|caché/.test(g), 'guillemets « », “ ”, ` ` et ‘ ’ : contenu remplacé', g);
ok(/« ?\[\d+ car\.\] ?»/.test(g) && g.startsWith('Livre ') && g.includes('introuvable'), 'longueur marquée, texte hors citation gardé', g);
const ap = scrubDiag("l'interface n'a pas pu lire 'L'été secret' aujourd'hui");
ok(ap.startsWith("l'interface n'a pas pu lire ") && ap.includes("aujourd'hui") && !ap.includes('secret'), 'apostrophes d’élision intactes, citation en apostrophes masquée', ap);
ok(scrubDiag("Cannot read properties of undefined (reading 'id')") === "Cannot read properties of undefined (reading 'id')", 'fragment court (≤ 3 caractères) gardé');
ok(!scrubDiag("ENOENT: no such file or directory, open '/Users/x/Boîte/Mon livre secret.pdf'").includes('secret'), 'chemin cité dans une erreur système : masqué');

// ── 3. Pile conservée ──
const err = new Error('Échec sur « Chapitre secret de Julie »');
const s = scrubDiag(err);
const lines = s.split('\n');
ok(lines[0] === 'Error: Échec sur « [24 car.] »', 'pile : première ligne (message) nettoyée', lines[0]);
ok(lines.length >= 2 && lines.slice(1).every((l) => /^\s+at\s/.test(l)) && s.includes('test-diag-scrub'), 'pile : lignes « at … » gardées (fonction, fichier:ligne)', lines[1]);
ok(lines.slice(1).join('\n') === err.stack.split('\n').slice(1).join('\n'), 'pile : cadres identiques à l’original');
const comp = '\n    at BookView (http://localhost/src/features/reader/BookView.tsx:12:3)\n    at ErrorBoundary (http://localhost/src/components/ErrorBoundary.tsx:30:1)';
ok(scrubDiag(comp) === comp, 'pile de composants React : inchangée');
const sneaky = scrubDiag('Error: x\n    at "Mon titre secret" de quelque chose');
ok(!sneaky.includes('secret'), 'ligne qui imite « at » sans position : traitée comme du texte', sneaky);

// ── 4. Longueurs bornées ──
const long = scrubDiag('x'.repeat(5000));
ok(long.length < 400 && /…\[\+4700 car\.\]$/.test(long), 'ligne très longue : bornée à 300 caractères avec marque', long.slice(-20));
const many = scrubDiag(Array.from({ length: 100 }, (_, i) => 'ligne ' + i + ' ' + 'y'.repeat(100)).join('\n'), 1000);
ok(many.length < 1100 && /…\[\+\d+ car\.\]$/.test(many), 'texte sur plusieurs lignes : borné à max', many.length);
ok(diagError(new Error('z'.repeat(1000))).length < 330, 'diagError : borné à 300 caractères');
const astral = scrubDiag('😀'.repeat(400));
ok([...astral.split('…')[0]].length === 300 && !astral.includes('�'), 'troncature sans couper un caractère hors BMP');

// ── 5. Valeurs qui ne sont pas des chaînes ──
ok(scrubDiag(undefined) === '' && scrubDiag(null) === '', 'undefined / null : chaîne vide');
ok(scrubDiag(42) === '42' && scrubDiag(true) === 'true' && scrubDiag(10n) === '10', 'nombre, booléen, bigint');
ok(scrubDiag(Symbol('s')) === 'Symbol(s)', 'symbole');
ok(scrubDiag(() => 1) === '[fonction]', 'fonction');
const obj = scrubDiag({ code: 'E1', titre: 'Mon roman inédit' });
ok(!obj.includes('roman') && obj.includes('"E1"'), 'objet : sérialisé, valeurs longues masquées', obj);
const circ = {};
circ.self = circ;
ok(scrubDiag(circ) === '[object Object]', 'objet circulaire : ne lève pas');
ok(scrubDiag({ message: 'Livre "Titre confidentiel"', name: 'DOMException' }) === 'DOMException: Livre "[18 car.]"', 'objet de forme Error sans pile : « Nom: message » nettoyé');
ok(diagError('texte "très secret" brut') === 'texte "[11 car.]" brut' && diagError(undefined) === '', 'diagError : valeur quelconque acceptée');
const hostile = { toJSON() { throw new Error('non'); } };
ok(scrubDiag(hostile) === '[object Object]', 'objet dont la sérialisation lève : ne lève pas');

console.log(process.exitCode ? '\nDes vérifications ont échoué.' : '\nToutes les vérifications sont passées.');
