// Types MIME des glisser-déposer du module Plans.
import type { PlanItemRef } from '../../lib/types';

export const RES_MIME = 'application/x-marginalia-res';
export const NODE_MIME = 'application/x-marginalia-node';
export const ITEM_MIME = 'application/x-marginalia-item';

export type ResRef = Exclude<PlanItemRef, { kind: 'text' }>;

export const hasType = (e: { dataTransfer: DataTransfer | null }, t: string) =>
  Array.from(e.dataTransfer?.types ?? []).includes(t);
