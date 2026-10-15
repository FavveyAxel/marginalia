// ─────────────────────────────────────────────────────────────
// Modèle de la carte d'argument (sans interface) — point d'entrée.
//
//   core.ts       outils communs (MapLookup, mapKeyOf, nodeText…)
//   geometry.ts   tailles estimées des cartes, rectangles
//   zones.ts      12. zones (créer autour, contenu, déplacer, replier, redimensionner)
//   boards.ts     13. cartes libres multi-livres ; 20. notes sur les liens ; placement d'extraits
//   copy.ts       copie de cartes d'une carte à l'autre (copyNodesFromMap), idées, concepts
//   guided.ts     14. lecture guidée
//   gaps.ts       15. signaux de manques
//   convert.ts    16. carte → plan, carte → écrit (HTML)
//   movements.ts  17. carte d'un mouvement de fiche-texte
//   svg.ts        18. export SVG autonome ; image.ts : PNG (canvas ×2), PDF (host.printToPdf)
//   versions.ts   19. instantanés
//   actions.ts    les mêmes fonctions branchées sur le store (annulables, corbeille)
//
// Les fichiers purs (tous sauf image.ts et actions.ts) ne dépendent ni du store ni du DOM.
// ─────────────────────────────────────────────────────────────
export * from './core';
export * from './geometry';
export * from './zones';
export * from './boards';
export * from './copy';
export * from './guided';
export * from './gaps';
export * from './convert';
export * from './movements';
export * from './svg';
export * from './versions';
