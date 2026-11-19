// Attaques sur le chiffrement local (electron/vault.cjs), en Node pur : quelqu'un qui a le disque (ordinateur
// volé, sauvegarde copiée) ou qui peut y écrire, sans le mot de passe.
// Lancer : node scripts/test-vault-attacks.mjs
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const vault = createRequire(import.meta.url)(path.join(ROOT, 'electron/vault.cjs'));
const ok = (c, m, extra = '') => {
  console.log((c ? 'OK   ' : 'ÉCHEC ') + m + (extra !== '' ? ' — ' + (typeof extra === 'string' ? extra : JSON.stringify(extra)) : ''));
  if (!c) process.exitCode = 1;
};
const fails = (fn) => { try { fn(); return false; } catch { return true; } };

const dek = vault.newDek();
const plain = Buffer.from('Journal intime : ' + 'secret '.repeat(500));
const sealed = vault.seal(dek, plain);

// 1. Confidentialité : rien du texte dans le fichier, deux écritures du même contenu sans rapport.
ok(!sealed.includes(Buffer.from('secret')) && !sealed.includes(Buffer.from('Journal')), 'fichier chiffré : aucun fragment du texte');
const again = vault.seal(dek, plain);
ok(!sealed.subarray(8).equals(again.subarray(8)) && !sealed.subarray(8, 20).equals(again.subarray(8, 20)), 'même contenu écrit deux fois : deux fichiers sans rapport (IV aléatoire)');
const ivs = new Set();
for (let i = 0; i < 200000; i++) ivs.add(vault.seal(dek, Buffer.alloc(1)).subarray(8, 20).toString('hex'));
ok(ivs.size === 200000, '200 000 écritures : aucun IV répété');
const bits = Buffer.concat([...Array(400)].map(() => vault.seal(dek, Buffer.alloc(4096)).subarray(20, 20 + 4096)));
let ones = 0;
for (const b of bits) for (let i = 0; i < 8; i++) ones += (b >> i) & 1;
ok(Math.abs(ones / (bits.length * 8) - 0.5) < 0.002, 'contenu chiffré d’un fichier de zéros : indistinguable du hasard', (ones / (bits.length * 8)).toFixed(4));

// 2. Intégrité : chaque octet modifié, toute troncature, tout ajout est refusé.
let accepted = 0;
for (let i = 0; i < sealed.length; i++) { const t = Buffer.from(sealed); t[i] ^= 1 << (i % 8); if (!fails(() => vault.open(dek, t))) accepted++; }
ok(accepted === 0, `fichier modifié : ${sealed.length} altérations d’un bit, toutes refusées`, accepted);
let trunc = 0;
for (let n = 0; n < sealed.length; n += 7) if (!fails(() => vault.open(dek, sealed.subarray(0, n)))) trunc++;
ok(trunc === 0 && fails(() => vault.open(dek, Buffer.concat([sealed, Buffer.from([0])]))), 'fichier tronqué ou rallongé : refusé');
ok(fails(() => vault.open(dek, Buffer.concat([sealed.subarray(0, sealed.length - 16), sealed.subarray(sealed.length - 16, sealed.length - 12)]))), 'étiquette d’authentification raccourcie (4 octets) : refusée');
ok(fails(() => vault.open(vault.newDek(), sealed)), 'autre clé : refusé');
const other = vault.seal(dek, Buffer.from('autre fichier'));
ok(fails(() => vault.open(dek, Buffer.concat([sealed.subarray(0, 20), other.subarray(20)]))), 'greffe du contenu d’un autre fichier sous cet IV : refusée');

// 3. Mot de passe : enveloppe, mauvais mot de passe, paramètres trafiqués dans keystore.json.
const t0 = Date.now();
const w = await vault.wrapWithPassword('correct horse battery', dek);
const ms = Date.now() - t0;
ok(w.N >= 2 ** 17 && w.r === 8, `dérivation scrypt N=2^${Math.log2(w.N)} (128 Mo par essai), ${ms} ms ici`);
ok((await vault.unwrapWithPassword('correct horse battery', w)).equals(dek), 'bon mot de passe : clé rendue');
ok((await vault.unwrapWithPassword('correct horse batterz', w)) === null && (await vault.unwrapWithPassword('', w)) === null, 'mauvais mot de passe ou vide : refusé');
ok(!JSON.stringify(w).includes(dek.toString('base64').slice(0, 12)) && !JSON.stringify(w).includes('correct'), 'keystore : ni la clé ni le mot de passe');
const weak = [{ ...w, N: 2 }, { ...w, N: 1024 }, { ...w, N: 2 ** 16 }, { ...w, N: 2 ** 17 + 1 }, { ...w, N: 2 ** 30 }, { ...w, N: '131072' }, { ...w, r: 1 }, { ...w, p: 0 }, { ...w, p: 1e9 }, { ...w, salt: '' }, { ...w, tag: Buffer.from(vault.unb64(w.tag).subarray(0, 4)).toString('base64') }, { ...w, kdf: 'none' }, { ...w, iv: '' }, { ...w, ct: '' }, null, {}];
let through = 0;
let threw = 0;
for (const x of weak) { try { if ((await vault.unwrapWithPassword('correct horse battery', x)) !== null) through++; } catch { threw++; } }
ok(through === 0 && threw === 0, `keystore trafiqué (${weak.length} variantes : dérivation affaiblie, démesurée, étiquette tronquée…) : refusé sans erreur`, { through, threw });
// Un attaquant qui remplace l'enveloppe par la sienne (son mot de passe, sa clé) n'ouvre pas les fichiers.
const evil = await vault.wrapWithPassword('pirate', vault.newDek());
const evilDek = await vault.unwrapWithPassword('pirate', evil);
ok(fails(() => vault.open(evilDek, sealed)), 'enveloppe remplacée par celle de l’attaquant : les fichiers restent illisibles');

// 4. Clé de secours : 160 bits, pas de biais grossier, saisie tolérante, fausse clé refusée.
const keys = [...Array(4000)].map(() => vault.newRecoveryKey());
ok(new Set(keys).size === 4000 && keys.every((k) => /^([0-9A-HJKMNP-TV-Z]{4}-){7}[0-9A-HJKMNP-TV-Z]{4}$/.test(k)), 'clés de secours : 32 caractères (160 bits), toutes différentes');
const freq = {};
for (const k of keys) for (const ch of k.replace(/-/g, '')) freq[ch] = (freq[ch] || 0) + 1;
const exp = (4000 * 32) / 32;
ok(Object.keys(freq).length === 32 && Object.values(freq).every((n) => Math.abs(n - exp) / exp < 0.08), 'clés de secours : les 32 symboles également fréquents');
const rk = keys[0];
const rw = vault.wrapWithRecovery(rk, dek);
ok(vault.unwrapWithRecovery(rk.toLowerCase().replace(/-/g, ' '), rw).equals(dek), 'clé de secours saisie en minuscules avec espaces : acceptée');
ok(vault.unwrapWithRecovery(keys[1], rw) === null && vault.unwrapWithRecovery('', rw) === null, 'autre clé de secours : refusée');

// 5. Identifiant de clé (public, dans keystore.json et les archives) : ne permet pas de remonter à la clé.
ok(vault.keyId(dek).length === 24 && vault.keyId(dek) !== vault.keyId(vault.newDek()) && !dek.toString('hex').includes(vault.keyId(dek)), 'identifiant de clé : empreinte HMAC, sans rapport lisible avec la clé');
console.log(process.exitCode ? '\nDes vérifications ont échoué.' : '\nToutes les vérifications sont passées.');
