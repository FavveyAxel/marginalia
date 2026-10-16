// Aristote : ébauche provisoire (tête ronde), à remplacer par le vrai dessin.
import type { CharacterDef } from './types';

export const aristote: CharacterDef = {
  id: 'aristote',
  name: 'Aristote',
  grows: '…',
  skin: '#f1d3b8',
  head: ({ view }) => <ellipse cx={view === 'side' ? 54 : 49} cy={36} rx={30} ry={27} fill="#f1d3b8" stroke="currentColor" strokeWidth={2.4} />,
};
