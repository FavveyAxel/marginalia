# Mission Marginalia v2 — partition commune (FAITS FIGÉS)

Marginalia est une app de bureau macOS (Electron 33 + React 18 + Vite 5 + TypeScript strict) pour **lire, étudier et écrire en philosophie**. Utilisateur : étudiant / lecteur francophone (explication de texte, dissertation, fiches). Elle importe EPUB, PDF, DOCX, Markdown, TXT, HTML.

Projet : `/home/claude/marginalia` (`node_modules` installé). Interface **en français**, phrases au vouvoiement, libellés courts à l'infinitif (« Importer », « Exporter »).

Recherche préalable (à lire pour votre module) : `research/1-marginnote-liquidtext.md`, `research/2-readwise-zotero-heptabase-obsidian.md`, `research/3-besoins-philo.md` (méthodes et besoins, la plus importante), `research/4-editeur-docx.md` (éditeur), `research/5-ux-mobbin.md` (motifs d'interface avec liens Mobbin).

## Fonctionnalités (vue d'ensemble)
1. **Espaces de travail** avec groupes et sous-groupes (arborescence dans la barre latérale) contenant livres, écrits, plans, arguments, fiches-texte, cartes.
2. **Lecture** EPUB/PDF/DOCX/MD/TXT/HTML ; sommaire ; recherche ; thèmes ; **deux textes côte à côte** ; connecteurs logiques à la demande.
3. **Annotation** : 6 catégories (Problème, Thèse, Argument, Thèse adverse, Concept, Exemple — touches 1-6) ; **notes « ma voix »** typées (reformulation, question, ma critique, présupposé) séparées du texte ; note de marge pure = extrait sans catégorie (`category: null`) ; **page imprimée** corrigeable par extrait ; édition de référence par livre.
4. **Explication de texte** : fiche-texte (problème, thèse, enjeu) + **découpage en mouvements** (touche M dans la barre de sélection) + plan généré.
5. **Arguments** : reconstruction en forme standard (P1, P2… ⇒ C, prémisses implicites) ; **carte d'argument** (relations soutient / objecte à / répond à / précise / illustre ; co-prémisses via `groupId`).
6. **Concepts** : plusieurs sens par auteur, distinctions / oppositions entre concepts, notions et repères du programme de terminale (chargement optionnel), mentions détectées.
7. **Révision** : cartes tirées des extraits et concepts, répétition espacée FSRS (`ts-fsrs` 5.4.2), plafond de nouvelles cartes par livre.
8. **Écrire** : éditeur façon Word sur de vrais .docx (SuperDoc 1.47.2), plan des titres, compteur de mots, mode concentration, modèles, insertion de citations avec note de bas de page, **export .docx / PDF / Markdown / HTML / TXT**.
9. **Plans de dissertation** : sujet, définitions, problématique, parties et sous-parties où l'on glisse extraits, concepts, arguments → « Envoyer vers l'éditeur ».
10. Transversal : palette ⌘K, export Markdown Obsidian, citations prêtes à coller (`src/lib/citation.ts`).

À NE PAS faire (recherche) : générer automatiquement cartes ou plans à la place de l'utilisateur, logique formelle fine, fonctions sociales, IA.

## Fichiers figés (lire, NE PAS modifier)
- `src/lib/types.ts` — modèle de données v2 complet (lisez-le en entier).
- `src/lib/categories.ts` — CATEGORIES (6), NOTE_KINDS (4), RELATIONS (5), CONNECTORS.
- `src/lib/store.ts` — store zustand v4 + persistance. Actions génériques `insert(col, item)`, `patch(col, id, partial)`, `remove(col, id)` pour toutes les collections ; actions spécifiques avec cascade (removeBook, removeHighlight, removeConcept, removeDraft, removeGroup, removeWorkspace…). Utiliser `uid()` pour les ids. Sélection de tableaux dérivés : `useStore(useShallow(sel))` (`import { useShallow } from 'zustand/react/shallow'`).
- `src/lib/platform.ts` — pont hôte `host` (HostApi : loadDb, saveDb, pickFiles, storeFile/readFile/deleteFile(id, fileName), saveText, openDocx, writeExternal, saveBinary, printToPdf, onOpenFiles) ; fallback navigateur IndexedDB.
- `src/lib/citation.ts` — formatCitation, formatFootnote, referenceParts, locatorOf.
- `src/features/reader/engine.ts` — contrat des moteurs de lecture.
- `src/features/editor/api.ts` — `createDraft(opts)`, `openDocxFromDisk()` (implémentés dans `impl.ts` par l'agent Éditeur).
- `src/components/ui.tsx`, `src/components/SelectionToolbar.tsx`.
- `src/styles/tokens.css`, `src/styles/app.css` — tokens et primitives (.btn, .btn-primary, .btn-ghost, .btn-sm, .btn-danger, .icon-btn(.sm/.active), .input, .textarea, .kbd, .chip(.active), .segmented, .floating, .menu-item, .divider, .empty, .page-title, .panel, .topbar(+ .spacer), .muted, .truncate, .hl, .hl-<cat>, .hl-note, .hl.active, .hl.pulse, .search-hit, .connector, .cat-dot).
- `src/App.tsx`, `src/features/reader/ReaderView.tsx`, `src/features/reader/reader.css` — coquille (intégrateur).

Si un fichier figé vous bloque, ne le modifiez pas : décrivez le changement souhaité dans votre bon (rubrique HYPOTHÈSES) et contournez localement.

## Direction artistique (figée)
- Papier chaud, typographie éditoriale, sobriété macOS. Tout en variables CSS de `tokens.css` (aucune couleur en dur, sauf `color-mix()` sur des tokens). Thèmes clair / sépia / sombre via `:root[data-theme]` : votre UI doit rester lisible dans les trois.
- Polices : UI `var(--font-ui)` ; lecture `var(--font-read)` (Literata) ; grands titres `var(--font-display)` (Instrument Serif 400, jamais en gras).
- Icônes `lucide-react` 14-16 px. Pas d'emoji.
- Vues de premier niveau (rendues dans `.main` à droite de la barre latérale) : leur propre `<header className="topbar">` (52 px, zone de glissement de fenêtre ; les boutons y sont cliquables automatiquement), puis un contenu avec grand titre en Instrument Serif (`.page-title`), marges généreuses (40-56 px), largeur de lecture confortable.
- Panneaux arrondis flottants sur fond `--bg-app` (NotebookLM). Lecture façon Matter. Canevas façon ClickUp/Tana (points, barre d'outils flottante en bas). Bibliothèque façon Arcade/Loom. Éditeur façon Substack/Semrush (page centrée, barre compacte, plan des titres en marge, compteur de mots en pastille). Arborescence d'espaces façon hilos/Strut/Mintlify (menus contextuels « Ajouter un groupe », « Déplacer », « Dégrouper »).
- Micro-interactions sobres (`var(--dur)` 160 ms, `var(--ease)`). États vides soignés (`.empty` avec `h3` + une phrase + une action).
- **Animations (demande explicite de l'utilisateur : app agréable)** : utiliser les primitives figées de `app.css` — `.anim-view` (entrée de vue), `.anim-in` / `.anim-scale` (popover, carte), `.anim-slide` (panneau), `.anim-stagger` sur une liste (+ `style={{'--i': index}}` sur chaque enfant), `.lift` (cartes cliquables), `.skeleton` / `<Skeleton>` / `<PageSkeleton>` de `ui.tsx` pendant tout chargement (jamais d'écran vide ni de simple « Chargement… »), `.progress-indeterminate` pour une opération longue ; transitions de couleur/position 120–220 ms avec `var(--ease-out)`. Animations sobres, jamais gratuites ; `prefers-reduced-motion` est déjà géré globalement.
- Pas de `window.confirm/alert/prompt` : confirmations et saisies en ligne ou en popover maison.

## Propriété des fichiers (chacun n'écrit QUE dans ses chemins)
| Agent | Fichiers |
|---|---|
| A1 Moteur HTML | `src/features/reader/html/**` |
| A2 Moteur PDF | `src/features/reader/pdf/**`, `public/pdfjs/**` |
| A3 Éditeur | `src/features/editor/**` (sauf `api.ts`, figé) |
| A4 Bibliothèque & Electron | `src/features/library/**`, `src/lib/exportMarkdown.ts`, `electron/**`, `build/**`, `scripts/package.mjs` (+ script `package` dans package.json) |
| A5 Annotations & navigation | `src/features/annotations/ExtractsPanel.tsx`, `src/features/annotations/HighlightPopover.tsx`, `src/features/annotations/annotations.css`, `src/features/reader/TocPanel.tsx`, `src/features/reader/SearchBar.tsx`, `src/features/reader/TypographyPopover.tsx`, `src/features/reader/reader-tools.css`, `src/components/CommandPalette.tsx`, `src/components/command.css` |
| B1 Carte & Arguments | `src/features/map/**`, `src/features/arguments/**` |
| B2 Concepts & Extraits | `src/features/concepts/**`, `src/features/annotations/AllExtractsView.tsx`, `src/features/annotations/all-extracts.css` |
| B3 Fiche-texte & Plans | `src/features/study/**`, `src/features/plans/**` |
| B4 Révision | `src/features/revision/**` |
| B5 Espaces & Accueil | `src/features/workspaces/**`, `src/features/home/**` |

Les fichiers actuels de ces chemins sont des STUBS : remplacez-les en gardant **exactement** les signatures exportées. CSS : un fichier par module, importé par le composant, classes préfixées (`.html-`, `.pdf-`, `.ed-`, `.lib-`, `.ann-`, `.toc-`, `.cmd-`, `.map-`, `.arg-`, `.cpt-`, `.study-`, `.plan-`, `.rev-`, `.ws-`, `.home-`).

## Règles techniques
- **Aucune installation npm.** Disponibles : react 18, zustand 4.5, lucide-react, @xyflow/react 12, jszip, mammoth, marked 14, dompurify 3, pdfjs-dist 4.10.38, superdoc 1.47.2, ts-fsrs 5.4.2, @fontsource. Besoin d'autre chose : le dire dans le bon.
- TypeScript strict : `npx tsc --noEmit 2>&1 | grep -E '<vos chemins>'` doit être vide pour VOS fichiers (ignorez les erreurs des autres modules en cours).
- Tests visuels : `scripts/harness.mjs` (`withApp(port, fn, {dark})`, `importFixture(page, 'fixtures/x.epub', {open:true})`, `selectText(page, needle, rootSelector)`, `shot(page, 'shots/<dossier>/x.png')`). En dev, `window.__store` expose le store (`getState()`, `setState()`). Scripts dans `scripts/test-<module>.mjs`, lancés avec `timeout 170 node scripts/test-<module>.mjs`. **Utilisez uniquement votre port** : A1 5201, A2 5202, A3 5203, A4 5204, A5 5205, B1 5211, B2 5212, B3 5213, B4 5214, B5 5215. Regardez vos captures avec l'outil Read.
- Fixtures : `fixtures/discours.{epub,pdf,docx,md,html}`, `fixtures/premiere-partie.txt`, `fixtures/cover.png` (Descartes, Discours de la méthode : « Première partie », « Seconde partie », « Quatrième partie »).
- Les autres modules peuvent être des stubs pendant que vous travaillez : injectez vos données de test via `window.__store.setState(...)` ou les actions du store.
