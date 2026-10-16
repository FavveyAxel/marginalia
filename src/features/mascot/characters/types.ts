// Compagnons : le cerveau, ou un philosophe dessiné dans le même style (encre, couleurs chaudes).
// Chaque philosophe réutilise toutes les poses du cerveau (marche, saut, lecture, guitare…) : il ne
// fournit que sa tête, son vêtement et ce qui grandit avec le nombre de documents (niveau 0 à 4).
//
// Les philosophes ont un vrai corps : une tête plus petite posée sur un torse, des bras et des jambes
// pleins (couleur du vêtement ou de la peau, cernés d'encre) et des chaussures ; Sprite dessine les
// membres (selon `limbs`) et les mains, le personnage fournit la tête, le torse et le vêtement.
//
// Repère (viewBox 100 × 130, le même que Sprite.tsx) :
//  - la TÊTE se dessine dans le repère du cerveau (de face, environ x 14..86, y 8..62 ; de profil,
//    regard vers la droite, environ x 18..90, y 4..60) ; Sprite la réduit (× 0,64, depuis le haut du
//    crâne : (49, 4) de face, (52, 2) de profil). Une fois réduite, elle occupe de face environ
//    x 26..72, y 7..41 (menton vers y 41), de profil x 30..76, y 3..39 ;
//  - le CORPS (body) se dessine en coordonnées réelles, non réduites : cou vers (49, 42), épaules vers
//    (37, 47) et (61, 47) de face, (47..52, 47) de profil ; torse jusqu'aux hanches vers (42, 64) et
//    (57, 64) de face, (50, 58) de profil ; la tunique peut descendre plus bas (jusqu'aux genoux, vers
//    y 90 debout) ;
//  - le visage (yeux, bouche, joues) est dessiné PAR-DESSUS par Sprite, aux mêmes endroits que pour le
//    cerveau : de face, yeux (37, 43) et (59, 43), bouche vers (48, 52) ; de profil, œil (75, 30),
//    bouche vers (84, 42). La tête doit donc laisser ces zones libres (peau) ; une barbe peut entourer
//    la bouche, mais pas la recouvrir ;
//  - les hanches sont vers (42, 64) et (57, 64) de face, (50, 58) de profil ; les jambes et les bras sont
//    dessinés par Sprite (traits d'encre, comme pour le cerveau) ;
//  - assis de profil, Sprite remonte tout le haut du corps de 8 unités (les jambes allongées restent
//    sur le bord) : le vêtement et la tête sont dans ce même groupe, rien à faire de plus.
import type { ReactNode } from 'react';
import type { Expr, Level, Pose, View } from '../Sprite';

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
  /** Visage propre au philosophe (yeux, sourcils, nez, bouche), dessiné dans le repère de la TÊTE à la
   *  place des grands yeux ronds du cerveau. Il suit l'expression du moment (`expr`) : yeux ouverts,
   *  fermés, plissés ou mi-clos, bouche souriante, neutre, en « o », endormie, cigare aux lèvres
   *  (composant Cigar exporté par Sprite), etc. De face, yeux vers (37, 43) et (59, 43), bouche vers
   *  (48, 52) ; de profil, œil vers (75, 30), bouche vers (84, 42) : ces repères servent aux notes de
   *  musique et aux ronds de fumée, qui sortent de la bouche. */
  face?: (a: DrawArgs & { expr: Expr }) => ReactNode;
  /** Ce qui se dessine par-dessus le visage (sourcils, nez, barbe autour de la bouche…). */
  overFace?: (a: DrawArgs) => ReactNode;
  /** Accessoire devant tout (après les bras) : rouleaux sous le bras, etc. */
  front?: (a: DrawArgs) => ReactNode;
  /** Couleur de peau (mains, et visage si la tête la reprend). */
  skin?: string;
  /** Membres pleins : couleur des bras (manches ou peau), des jambes (peau, bas…) et des chaussures. */
  limbs?: { arm: string; leg: string; shoe: string };
}
