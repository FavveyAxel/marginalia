# Marginalia

App macOS pour lire, étudier et écrire en philosophie (Electron + React + TypeScript).

- Lecture EPUB, PDF, DOCX, Markdown, TXT, HTML ; deux textes côte à côte
- Surlignage en 6 catégories (problème, thèse, argument, thèse adverse, concept, exemple), notes « ma voix »
- Fiche-texte et mouvements, carte d'argument, reconstruction prémisses → conclusion
- Concepts (sens par auteur, distinctions, programme de terminale), révision espacée (FSRS)
- Plans de dissertation, éditeur .docx (SuperDoc) avec export .docx / PDF / Markdown / HTML / TXT
- Espaces de travail avec groupes et sous-groupes

## Télécharger

[`downloads/Marginalia.dmg`](downloads/Marginalia.dmg) — Mac Apple Silicon (arm64).
Ouvrez le .dmg et glissez Marginalia dans Applications. L'app est signée ad hoc mais pas notariée :
au premier lancement, faites clic droit sur Marginalia › Ouvrir (ou Réglages Système › Confidentialité et sécurité › Ouvrir quand même).

## Confidentialité

Tout fonctionne en local sur le Mac : aucun compte, aucun serveur. Les livres, notes et écrits restent dans le dossier de l'app
(`~/Library/Application Support/Marginalia`). La reconnaissance du texte des images (tesseract.js) et le correcteur tournent hors ligne,
la télémétrie de l'éditeur (SuperDoc) est désactivée, et l'app bloque toute requête réseau sortante. Seuls les liens cliqués
s'ouvrent dans votre navigateur.

## Développement

```bash
npm install
npm run dev        # interface dans le navigateur
npm run typecheck
npm run package    # construit release/Marginalia-mac-arm64.zip (Apple Silicon)
```

Les tests visuels sont dans `scripts/test-*.mjs` (Chromium headless via playwright-core).

Licence : l'éditeur s'appuie sur SuperDoc 1.47.2 (AGPL-3.0) — usage personnel.
