// Registre des activités ajoutées (une par fichier). Ajouter ici une nouvelle activité.
import type { ActivityDef, PoseDef } from './types';
import type { CharId } from '../characters/types';
import * as coffee from './coffee';
import * as juggle from './juggle';
import * as spyglass from './spyglass';
import * as plane from './plane';
import * as paint from './paint';
import * as question from './question';
import * as geometry from './geometry';
import * as classify from './classify';
import * as herborize from './herborize';
import * as meditate from './meditate';
import * as dangle from './dangle';

export const EXTRA_POSE_NAMES = ['coffee', 'juggle', 'spyglass', 'plane', 'paint', 'question', 'geometry', 'classify', 'herborize', 'meditate', 'dangle'] as const;
export type ExtraPose = (typeof EXTRA_POSE_NAMES)[number];

export const EXTRA_POSES: Record<ExtraPose, PoseDef> = {
  coffee: coffee.pose,
  juggle: juggle.pose,
  spyglass: spyglass.pose,
  plane: plane.pose,
  paint: paint.pose,
  question: question.pose,
  geometry: geometry.pose,
  classify: classify.pose,
  herborize: herborize.pose,
  meditate: meditate.pose,
  dangle: dangle.pose,
};
export const EXTRA_ACTIVITIES: ActivityDef[] = [coffee, juggle, spyglass, plane, paint, question, geometry, classify, herborize, meditate, dangle].map((m) => m.activity);
export const extraPose = (p: string): PoseDef | undefined => (EXTRA_POSES as Record<string, PoseDef>)[p];

/** Une phrase de l'activité pour ce compagnon (les siennes d'abord, sinon celles de tous). */
export function activityLine(id: string, char: CharId): string | null {
  const a = EXTRA_ACTIVITIES.find((x) => x.id === id);
  const list = a?.lines?.[char]?.length ? a.lines[char]! : a?.lines?.all ?? [];
  return list.length ? list[Math.floor(Math.random() * list.length)] : null;
}
