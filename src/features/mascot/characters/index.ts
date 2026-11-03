// Registre des compagnons.
import type { CharId, CharacterDef } from './types';
import { socrate } from './socrate';
import { platon } from './platon';
import { aristote } from './aristote';
import { rousseau } from './rousseau';
import { mozart } from './mozart';
import { vivaldi } from './vivaldi';

export const BRAIN_DEF: CharacterDef = { id: 'brain', name: 'Cerveau', grows: 'ses muscles et ses veines', head: () => null };

export const CHARACTERS: Record<CharId, CharacterDef> = { brain: BRAIN_DEF, socrate, platon, aristote, rousseau, mozart, vivaldi };
export const CHARACTER_IDS: CharId[] = ['brain', 'socrate', 'platon', 'aristote', 'rousseau', 'mozart', 'vivaldi'];
export type { CharId, CharacterDef } from './types';
