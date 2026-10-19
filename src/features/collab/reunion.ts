// Travailler à plusieurs : réunion après un travail séparé (même espace, même shareId).
// (Version provisoire : remplacée par la réunion paragraphe par paragraphe.)
import type { Rec } from './records';
import type { RecordSync } from './records';

export interface ReuniteInput {
  records: RecordSync;
  hostRecs: Rec[];
  hostKeys: Set<string>;
  pkg: Uint8Array;
  hostName: string;
  me: string;
}
export interface ReuniteResult {
  /** Mes enregistrements à envoyer à tous après la réunion. */
  mine: Rec[];
  after?: () => void;
}

export async function reunite(_i: ReuniteInput): Promise<ReuniteResult> {
  return { mine: [] };
}

/** Fin de session : base commune gardée pour la prochaine réunion. */
export async function rememberSession(_shareId: string, _workspaceId: string | null, _records: RecordSync | null, _hostName: string | null): Promise<void> {}
