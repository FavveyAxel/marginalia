// Contrat d'une activité du compagnon (un fichier par activité dans ce dossier).
// Repère : celui du Sprite (viewBox 100 × 130, de face). Debout, pieds à y = 124 ; assis, assise à y = 70.
// Les épaules du cerveau sont vers (21, 54) et (78, 54) ; celles des philosophes sont recalées
// automatiquement sur le torse (37, 47) / (61, 47) : seuls les coudes (b) et les mains (c) comptent.
import type { ReactNode } from 'react';
import type { Level } from '../Sprite';
import type { Act } from '../scenes';
import type { CharId } from '../characters/types';

export type Pt = [number, number];
export type Limb = { a: Pt; b: Pt; c: Pt };
export type Rig = {
  arms: [Limb, Limb];
  legs: [Limb, Limb];
  /** Décalage vertical du corps (négatif : vers le haut). */
  lift: number;
  /** Regard (décalage des pupilles). */
  gaze: Pt;
  feet: 'stand' | 'hang' | 'flat' | 'none';
  armsBehind?: boolean;
  /** Main posée au visage : elle suit la tête (taille du cerveau, tête des philosophes). */
  faceHand?: 0 | 1;
};

/** Ce que reçoivent les fonctions de dessin d'une activité. */
export type PropArgs = {
  frame: number;
  rig: Rig;
  /** Position réelle de la bouche (après grossissement du cerveau ou réduction de la tête). */
  mouth: Pt;
  /** Point du visage (repère du cerveau) → position réelle. */
  onFace: (p: Pt) => Pt;
  char: CharId;
  level: Level;
  /** Identifiant unique du rendu (pour des id de dégradés / filtres sans collision). */
  uid: string;
};

export type EyesKind = 'open' | 'closed' | 'happy' | 'lidded';
export type MouthKind = 'smile' | 'flat' | 'o' | 'sleep' | 'tongue' | 'cigar' | 'puff' | 'smirk';

/** Une pose nouvelle (toujours dessinée de face). */
export type PoseDef = {
  /** Assis au bord de l'encadré (assise à y = 70) ou debout (pieds à y = 124). */
  seated: boolean;
  /** Images par seconde de l'animation (3 par défaut). */
  fps?: number;
  /** Squelette pour l'image `f` (repère du cerveau, de face). */
  rig: (f: number) => Rig;
  /** Philosophes : bras raccourcis comme dans les poses où les mains ne tiennent rien. */
  freeHands?: boolean;
  /** Derrière tout le personnage (chevalet, dessin au sol, piles de fiches…). */
  back?: (p: PropArgs) => ReactNode;
  /** Entre la tête et les bras proches (objet tenu, que la main recouvre). */
  mid?: (p: PropArgs) => ReactNode;
  /** Par-dessus tout (vapeur, avion en vol, « ? », étoiles…). */
  over?: (p: PropArgs) => ReactNode;
  /** Expression (sinon : yeux ouverts, sourire). */
  eyes?: (f: number) => EyesKind;
  mouth?: (f: number) => MouthKind;
};

/** Une activité : la suite d'actions jouée sur place, et ses phrases. */
export type ActivityDef = {
  id: string;
  /** Poids du tirage (0 : jamais tirée au hasard). */
  w: number;
  /** Réservée à certains compagnons ; absente : pour tous. */
  chars?: CharId[];
  acts: () => Act[];
  /** Phrases de la bulle (`say: 'act:<id>'`), par compagnon, ou pour tous ('all'). */
  lines?: Partial<Record<CharId | 'all', string[]>>;
};
