# Marginalia

App Mac et Windows pour lire, étudier et écrire en philosophie (Electron + React + TypeScript).

- Lecture EPUB, PDF, DOCX, Markdown, TXT, HTML ; deux textes côte à côte
- Surlignage en 6 catégories (problème, thèse, argument, thèse adverse, concept, exemple), notes « ma voix »
- Fiche-texte et mouvements, carte d'argument, reconstruction prémisses → conclusion
- Concepts (sens par auteur, distinctions, programme de terminale), révision espacée (FSRS)
- Plans de dissertation, éditeur .docx (SuperDoc) avec export .docx / PDF / Markdown / HTML / TXT
- Espaces de travail avec groupes et sous-groupes

## Télécharger

Les versions sont sur la page **Releases** du dépôt (privé : il faut être connecté à GitHub avec un compte
qui y a accès) : <https://github.com/FavveyAxel/marginalia/releases>. Dans la dernière version, ouvrez « Assets » :

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
```

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
la télémétrie de l'éditeur (SuperDoc) est désactivée, et l'app bloque toute requête réseau sortante. Seuls les liens cliqués
s'ouvrent dans votre navigateur.

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

Licence : l'éditeur s'appuie sur SuperDoc 1.47.2 (AGPL-3.0) — usage personnel.
