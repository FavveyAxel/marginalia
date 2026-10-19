// Éléments visuels communs aux fenêtres de partage et de travail à plusieurs :
//  - Bridge : deux ordinateurs reliés par le réseau local (attente, demande, transfert, arrivé) ;
//  - Steps : ce qu'il faut faire sur l'autre ordinateur, en trois petites étapes illustrées ;
//  - ContentChips : ce qui part ou arrive, en vignettes avec icônes plutôt qu'en phrase ;
//  - Trouble : l'aide repliée (« Ça ne trouve pas ? ») — point d'accès, pare-feu, adresse.
import type { ReactNode } from 'react';
import { BookOpen, Check, ChevronRight, FilePen, GraduationCap, Highlighter, Laptop, Lightbulb, ListTree, Network, ScrollText, Sigma } from 'lucide-react';
import { host } from '../../lib/platform';
import { hotspotHint } from './shareUi';

export type BridgeState = 'wait' | 'ask' | 'flow' | 'done' | 'idle';

export interface Face {
  letter: string;
  color: string;
}

function Computer({ label, face, done }: { label: string; face?: Face | null; done?: boolean }) {
  return (
    <div className="br-pc">
      <span className="br-screen">
        <Laptop size={34} strokeWidth={1.4} />
        {face && (
          <span className="br-face" style={{ background: face.color }} aria-hidden="true">
            {face.letter}
          </span>
        )}
        {done && (
          <span className="br-done" aria-hidden="true">
            <Check size={13} strokeWidth={3} />
          </span>
        )}
      </span>
      <span className="br-label">{label}</span>
    </div>
  );
}

/**
 * Deux ordinateurs et le lien entre eux. `dir` : 'out' (d'ici vers l'autre) ou 'in'. `progress` (0..1)
 * remplit le lien pendant un transfert.
 */
export function Bridge({
  state,
  dir = 'out',
  left = 'Cet ordinateur',
  right = 'L’autre ordinateur',
  leftFace,
  rightFace,
  progress,
}: {
  state: BridgeState;
  dir?: 'out' | 'in';
  left?: string;
  right?: string;
  leftFace?: Face | null;
  rightFace?: Face | null;
  progress?: number;
}) {
  const pct = progress != null ? Math.max(0, Math.min(1, progress)) : null;
  return (
    <div className={`br br-${state} br-${dir}`} aria-hidden="true">
      <Computer label={left} face={leftFace} done={state === 'done' && dir === 'in'} />
      <div className="br-link">
        <span className="br-track" />
        {pct != null && <span className="br-fill" style={{ width: `${pct * 100}%` }} />}
        <span className="br-dot" />
        <span className="br-dot" />
        <span className="br-dot" />
      </div>
      <Computer label={right} face={rightFace} done={state === 'done' && dir === 'out'} />
    </div>
  );
}

/** Ce qu'il faut faire sur l'autre ordinateur : une vraie suite d'étapes, donc numérotée. */
export function Steps({ items }: { items: { icon: ReactNode; label: ReactNode }[] }) {
  return (
    <ol className="br-steps" aria-label="Sur l’autre ordinateur">
      {items.map((it, i) => (
        <li key={i}>
          <span className="br-step-wrap">
            <span className="br-step-ico">
              {it.icon}
              <span className="br-step-n">{i + 1}</span>
            </span>
            <span className="br-step-label">{it.label}</span>
          </span>
          {i < items.length - 1 && <ChevronRight className="br-step-sep" size={14} aria-hidden="true" />}
        </li>
      ))}
    </ol>
  );
}

/** Le code en grand, d'un seul tenant (« 735-700 »). */
export function BigCode({ code, testid }: { code: string; testid: string }) {
  const d = code.replace(/\D/g, '');
  return (
    <div className="sh-code" data-testid={testid} data-code={d} aria-label={`Code ${d.split('').join(' ')}`}>
      {d.slice(0, 3)}
      <span className="sh-dash" aria-hidden="true">-</span>
      {d.slice(3)}
    </div>
  );
}

export interface ChipCounts {
  drafts?: number;
  maps?: number;
  highlights?: number;
  books?: number;
  plans?: number;
  arguments?: number;
  studies?: number;
  concepts?: number;
  cards?: number;
}

const KINDS: { k: keyof ChipCounts; one: string; many: string; icon: ReactNode }[] = [
  { k: 'drafts', one: 'écrit', many: 'écrits', icon: <FilePen size={16} /> },
  { k: 'maps', one: 'carte', many: 'cartes', icon: <Network size={16} /> },
  { k: 'highlights', one: 'extrait', many: 'extraits', icon: <Highlighter size={16} /> },
  { k: 'plans', one: 'plan', many: 'plans', icon: <ListTree size={16} /> },
  { k: 'arguments', one: 'argument', many: 'arguments', icon: <Sigma size={16} /> },
  { k: 'studies', one: 'fiche-texte', many: 'fiches-texte', icon: <ScrollText size={16} /> },
  { k: 'concepts', one: 'concept', many: 'concepts', icon: <Lightbulb size={16} /> },
  { k: 'cards', one: 'carte de révision', many: 'cartes de révision', icon: <GraduationCap size={16} /> },
];

/** Vignettes « 1 écrit », « 2 extraits »… ; `bookNote` précise l'état des livres (« fichier joint »). */
export function ContentChips({ counts, bookNote }: { counts: ChipCounts; bookNote?: string }) {
  const nb = counts.books ?? 0;
  return (
    <ul className="br-chips">
      {KINDS.filter((x) => (counts[x.k] ?? 0) > 0).map((x) => {
        const n = counts[x.k] ?? 0;
        return (
          <li key={x.k} className="br-chip">
            <span className="br-chip-ico">{x.icon}</span>
            <span>
              <strong>{n}</strong> {n > 1 ? x.many : x.one}
            </span>
          </li>
        );
      })}
      {nb > 0 && (
        <li className="br-chip is-book">
          <span className="br-chip-ico">
            <BookOpen size={16} />
          </span>
          <span>
            <strong>{nb}</strong> {nb > 1 ? 'livres' : 'livre'}
            {bookNote && <span className="br-chip-note">{bookNote}</span>}
          </span>
        </li>
      )}
    </ul>
  );
}

/** Aide repliée : ce qui empêche souvent de se trouver, et l'adresse à saisir en secours. */
export function Trouble({ address, children, summary = 'L’autre ordinateur ne trouve pas ?', internet = false }: { address?: string | null; children?: ReactNode; summary?: string; internet?: boolean }) {
  const p = host.platform;
  return (
    <details className="br-trouble">
      <summary>{summary}</summary>
      <ul>
        {internet ? (
          <>
            <li>Vérifiez le code : après un essai raté, il faut attendre 10 secondes avant d’en essayer un autre.</li>
            <li>Par Internet, la recherche peut prendre une dizaine de secondes. Sur le même Wi-Fi, c’est plus rapide.</li>
          </>
        ) : (
          <>
            <li>Les deux ordinateurs doivent être sur le même Wi-Fi.</li>
            <li>{hotspotHint(p)}</li>
          </>
        )}
        {p === 'win32' && <li>Sous Windows, si le pare-feu le demande, autorisez Marginalia sur les réseaux privés.</li>}
        {p === 'darwin' && <li>Sur Mac, autorisez Marginalia à accéder au réseau local si le système le demande.</li>}
        {address && (
          <li>
            Sur l’autre ordinateur, « Saisir une adresse » : <span className="sh-mono">{address}</span>
          </li>
        )}
      </ul>
      {children}
    </details>
  );
}

/** Un fichier « .marginalia » dessiné : page cornée, marque de l'app, extension. */
export function FileArt({ done }: { done?: boolean }) {
  return (
    <span className={`sh-file${done ? ' is-done' : ''}`} aria-hidden="true">
      <span className="sh-file-m">M</span>
      <span className="sh-file-ext">.marginalia</span>
      {done && (
        <span className="br-done">
          <Check size={13} strokeWidth={3} />
        </span>
      )}
    </span>
  );
}

