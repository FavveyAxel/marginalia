# Marginalia

App Mac et Windows pour lire, étudier et écrire en philosophie (Electron + React + TypeScript).
Gratuite, sans compte, tout reste sur l'ordinateur. Site : <https://marginalia-bice.vercel.app>

- Lecture EPUB, PDF, DOCX, Markdown, TXT, HTML, photos et scans (texte reconnu hors ligne) ; deux textes côte à côte
- Synchronisation avec l'app Livres d'Apple (Mac) : livres, surlignages, notes, signets, position de lecture
- Page « Importer » : glisser-déposer de fichiers ou de dossiers entiers, choix de fichiers ou d'un dossier, QR code, dossier synchronisé, app Livres
- Depuis le téléphone (iPhone, Android) : par le Wi-Fi en scannant un QR code (photos, livres, documents, passages ou notes
  de l'app Livres collées, et chaque envoi dit où il est allé), ou par un dossier synchronisé (iCloud Drive, OneDrive) ; texte des photos reconnu et passage retrouvé dans vos livres
- Surlignage en 6 catégories (problème, thèse, argument, thèse adverse, concept, exemple), notes « ma voix »
- Fiche-texte et mouvements, reconstruction prémisses → conclusion
- Cartes pour organiser sa pensée : carte d'argument de chaque livre, cartes libres sur plusieurs livres,
  problématique au centre, rangements automatiques, présentation, plan tiré de la carte
- Concepts (sens par auteur, distinctions, programme de terminale), révision espacée (FSRS)
- Plans de dissertation, éditeur .docx (SuperDoc) avec export .docx / PDF / page web / Markdown / TXT
  fidèle à la mise en page de l'éditeur (sauts de page, numéros, notes de bas de page)
- Espaces de travail avec groupes et sous-groupes, historique et corbeille
- Chiffrement et verrouillage (mot de passe ou Touch ID) en option ; compagnons animés (Rousseau, Socrate…)

## Télécharger

Le plus simple : le site <https://marginalia-bice.vercel.app>, qui propose la bonne version pour votre ordinateur.

Liens directs vers la dernière version :
[Mac Apple Silicon](https://github.com/FavveyAxel/marginalia/releases/latest/download/Marginalia-mac-arm64.dmg) ·
[Mac Intel](https://github.com/FavveyAxel/marginalia/releases/latest/download/Marginalia-mac-x64.dmg) ·
[Windows](https://github.com/FavveyAxel/marginalia/releases/latest/download/Marginalia-win-x64-setup.exe) ·
[Windows ARM](https://github.com/FavveyAxel/marginalia/releases/latest/download/Marginalia-win-arm64-setup.exe)

Toutes les versions sont sur la page [Releases](https://github.com/FavveyAxel/marginalia/releases). Dans une version, ouvrez « Assets » :

| Fichier | Pour |
| --- | --- |
| `Marginalia-<version>-mac-arm64.dmg` | Mac Apple Silicon (M1, M2, M3, M4…) |
| `Marginalia-<version>-mac-x64.dmg` | Mac Intel |
| `Marginalia-<version>-win-x64-setup.exe` | Windows (PC classique) — installateur |
| `Marginalia-<version>-win-arm64-setup.exe` | Windows sur processeur ARM (Surface Pro X/11, Snapdragon) — installateur |
| `Marginalia-<version>-win-<arch>-portable.exe` | Windows sans installation (lancer directement le fichier) |

Les fichiers ne sont signés ni par Apple ni par Microsoft (pas de certificat payant) : chaque système
demande donc une confirmation au premier lancement.

**Mac.** Ouvrez le .dmg et glissez Marginalia dans Applications. Au premier lancement, faites
clic droit (ou ctrl-clic) sur Marginalia › **Ouvrir**, puis **Ouvrir** dans la fenêtre d'avertissement.
Sur macOS 15 et suivants, si seul « Placer dans la corbeille » est proposé : Réglages Système ›
Confidentialité et sécurité › en bas, **Ouvrir quand même**. En dernier recours, dans le Terminal :
`xattr -cr /Applications/Marginalia.app`.

**Windows.** Lancez `…-setup.exe`. Si SmartScreen affiche « Windows a protégé votre ordinateur »,
cliquez sur **Informations complémentaires** › **Exécuter quand même**. L'installation se fait pour votre
seul compte (sans droits administrateur) ; vous pouvez choisir le dossier, et des raccourcis sont créés
dans le menu Démarrer et sur le bureau. Marginalia s'associe aux .epub, .pdf, .docx et .md (une application par défaut déjà choisie dans Windows reste prioritaire ; sinon, clic droit › Ouvrir avec).
Désinstallation : Paramètres › Applications.

## Publier une version

```bash
git tag v3.2 && git push origin v3.2
# ou, sans étiquette locale (l'étiquette est créée par le workflow) :
gh workflow run release.yml -f version=3.2
```
On peut aussi passer par l'onglet Actions › Release › « Run workflow » en saisissant la version.

L'étiquette déclenche `.github/workflows/release.yml` : GitHub Actions fixe la version de l'app d'après
l'étiquette (`v3.2` → 3.2.0, affichée dans « À propos »), fabrique les .dmg (arm64, x64) sur un Mac et les .exe
(installateur et portable, x64 et arm64) sur Windows, lance chaque app fabriquée pour vérifier qu'elle démarre,
puis crée la Release avec les fichiers et des notes générées à partir des commits. Compter 15 à 25 minutes.
Une étiquette avec tiret (`v4.0.0-beta.1`) donne une pré-version.

Pour fabriquer sans publier : onglet **Actions** › **Release** › **Run workflow** ; les fichiers sont alors
dans les « Artifacts » de l'exécution (gardés 7 jours).

## Confidentialité

Tout fonctionne en local sur l'ordinateur : aucun compte, aucun serveur. Les livres, notes et écrits restent dans le dossier de l'app
(`~/Library/Application Support/Marginalia` sur Mac, `%APPDATA%\Marginalia` sur Windows). La reconnaissance du texte des images (tesseract.js) et le correcteur tournent hors ligne,
la télémétrie de l'éditeur (SuperDoc) est désactivée, et l'app bloque toute requête réseau sortante, sauf la vérification
des mises à jour au lancement (lecture de la dernière Release GitHub, sans aucune donnée envoyée ; désactivable dans les Réglages).
La réception par le Wi-Fi (QR code) n'accepte que des connexions du réseau local, et seulement pendant que sa fenêtre est
ouverte. Seuls les liens cliqués s'ouvrent dans votre navigateur.

En option (Réglages › Confidentialité et sécurité, désactivées par défaut) :
- **Chiffrement transparent** : base, fichiers de la bibliothèque, sauvegardes et journal chiffrés (AES-256-GCM) ; la clé de
  données est protégée par le trousseau du système (`safeStorage` : Trousseau sur Mac, DPAPI sous Windows). Rien à taper.
- **Verrouillage** : mot de passe (scrypt) ou Touch ID à l'ouverture, verrouillage après inactivité ou à la mise en veille.
- Dans les deux cas, une **clé de secours** (32 caractères) est affichée une seule fois. Sans mot de passe ni clé de secours,
  les données chiffrées sont définitivement illisibles. Détails : `electron/vault.cjs` et la section « Confidentialité » de
  `electron/main.cjs` ; test : `scripts/test-electron-encryption.mjs`.

## Développement

```bash
npm install
npm run dev        # interface dans le navigateur
npm run typecheck
npm run dist:mac   # .dmg arm64 + x64 dans release/builder/ (sur un Mac)
npm run dist:win   # setup + portable x64 + arm64 dans release/builder/ (sur Windows)
npm run dist:dir   # app non empaquetée pour l'OS courant (release/builder/*-unpacked), utile sous Linux
npm run smoke:packaged   # lance l'app de release/builder/ et vérifie qu'elle démarre (Linux : DISPLAY=:99)
npm run package    # ancien chemin : release/Marginalia-mac-arm64.zip via @electron/packager
```

L'empaquetage passe par electron-builder (configuration : clé `build` de `package.json`). Le rendu est entièrement
bundlé par Vite dans `dist/` : l'app n'embarque que `package.json`, `electron/` et `dist/` dans `app.asar`,
sans aucun `node_modules` (toutes les dépendances sont donc des `devDependencies`). Icônes : `build/icon.icns` (Mac),
`build/icon.png` (Windows, converti en .ico).

Les tests visuels sont dans `scripts/test-*.mjs` (Chromium headless via playwright-core).
Fidélité des exports : `scripts/test-export-fidelity.mjs` et `scripts/test-export-fidelity-edge.mjs` ; banc d'essai sur
un dossier de .docx : `node scripts/bench-export-corpus.mjs <dossier>` (pages de l'éditeur, du PDF et du .docx réexporté).

## Site de présentation

Le site (`site/`) réutilise la mascotte de l'app. Il est publié sur Vercel à chaque mise à jour de `main`
(réglages dans `vercel.json`). Ses boutons pointent vers les copies à nom fixe de la dernière version
(`Marginalia-mac-arm64.dmg`…), créées par le workflow de publication.

```bash
npm run dev:site     # http://localhost:5180
npm run build:site   # site/dist
```

Licence : l'éditeur s'appuie sur SuperDoc 1.47.2 (AGPL-3.0) — usage personnel.
