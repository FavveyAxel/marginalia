// Rousseau : ébauche provisoire (tête ronde), à remplacer par le vrai dessin.
import type { CharacterDef } from './types';

export const rousseau: CharacterDef = {
  id: 'rousseau',
  name: 'Rousseau',
  grows: '…',
  skin: '#f1d3b8',
  limbs: { arm: '#f1d3b8', leg: '#f1d3b8', shoe: '#8a5a36' },
  body: ({ view }) => <path d={view === 'side' ? 'M44 42 L56 42 L60 80 L40 80 Z' : 'M40 42 L58 42 L64 82 L34 82 Z'} fill="#ebe3cf" stroke="currentColor" strokeWidth={2} strokeLinejoin="round" />,
  head: ({ view }) => <ellipse cx={view === 'side' ? 54 : 49} cy={36} rx={30} ry={27} fill="#f1d3b8" stroke="currentColor" strokeWidth={2.4} />,
};
