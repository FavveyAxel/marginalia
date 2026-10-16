// Compagnons : le cerveau, ou un philosophe dessiné dans le même style (encre, couleurs chaudes).
// Chaque philosophe réutilise toutes les poses du cerveau (marche, saut, lecture, guitare…) : il ne
// fournit que sa tête, son vêtement et ce qui grandit avec le nombre de documents (niveau 0 à 4).
//
// Repère (viewBox 100 × 130, le même que Sprite.tsx) :
//  - la tête remplace le cerveau : de face, environ x 14..86, y 8..62 ; de profil (regard vers la
//    droite), environ x 18..90, y 4..60 ;
//  - le visage (yeux, bouche, joues) est dessiné PAR-DESSUS par Sprite, aux mêmes endroits que pour le
//    cerveau : de face, yeux (37, 43) et (59, 43), bouche vers (48, 52) ; de profil, œil (75, 30),
//    bouche vers (84, 42). La tête doit donc laisser ces zones libres (peau) ; une barbe peut entourer
//    la bouche, mais pas la recouvrir ;
//  - les hanches sont vers (42, 64) et (57, 64) de face, (50, 58) de profil ; les jambes et les bras sont
//    dessinés par Sprite (traits d'encre, comme pour le cerveau) ;
//  - assis de profil, Sprite remonte tout le haut du corps de 8 unités (les jambes allongées restent
//    sur le bord) : le vêtement et la tête sont dans ce même groupe, rien à faire de plus.
import type { ReactNode } from 'react';
import type { Level, Pose, View } from '../Sprite';

export type CharId = 'brain' | 'socrate' | 'platon' | 'aristote' | 'rousseau';

export type DrawArgs = {
  /** Vue dessinée (face, profil regard à droite, dos). */
  view: View;
  /** 0 à 4 : ce qui grandit (barbe, épaules, rouleaux, bonnet…). */
  level: Level;
  frame: number;
  pose: Pose;
  /** Assis sur le bord d'un encadré (jambes qui pendent de face, allongées de profil). */
  seated: boolean;
  /** Identifiant unique pour les dégradés/filtres éventuels (id SVG). */
  uid: string;
};

export interface CharacterDef {
  id: CharId;
  /** Nom affiché (réglages). */
  name: string;
  /** Ce qui grandit avec les documents, pour les réglages : « sa barbe », « ses épaules »… */
  grows: string;
  /** Vêtement ou buste, dessiné devant les jambes et derrière la tête. */
  body?: (a: DrawArgs) => ReactNode;
  /** Tête (sans les yeux ni la bouche, ajoutés par-dessus). */
  head: (a: DrawArgs) => ReactNode;
  /** Ce qui se dessine par-dessus le visage (sourcils, nez, barbe autour de la bouche…). */
  overFace?: (a: DrawArgs) => ReactNode;
  /** Accessoire devant tout (après les bras) : rouleaux sous le bras, etc. */
  front?: (a: DrawArgs) => ReactNode;
  /** Couleur de peau (joues, mains éventuelles). */
  skin?: string;
}
