// État visible de « Travailler à plusieurs » (léger : lu par la barre latérale, les menus, l'éditeur).
// La session elle-même (réseau, réplication, Yjs) est dans session.ts, chargé à la demande.
import { create } from 'zustand';
import type { CollabMember, CollabRequest } from '../../lib/platform';
import type { WorkspaceItemKind } from '../../lib/types';
import type { ReunionItem } from './reunion';
import type { Choice } from './docxMerge';

export interface CollabProfile {
  name: string;
  color: string;
}

/** Couleurs proposées (lisibles en clair et en sombre). */
export const COLLAB_COLORS = ['#c2410c', '#1d4ed8', '#15803d', '#7e22ce', '#be123c', '#0f766e', '#a16207', '#4338ca'];

const PROFILE_KEY = 'marginalia.collab.profile';
export function readProfile(): CollabProfile | null {
  try {
    const p = JSON.parse(localStorage.getItem(PROFILE_KEY) || 'null');
    if (p && typeof p.name === 'string' && p.name.trim() && typeof p.color === 'string' && /^#[0-9a-f]{6}$/i.test(p.color)) return { name: p.name.trim().slice(0, 40), color: p.color };
  } catch {
    /* indisponible */
  }
  return null;
}
export function writeProfile(p: CollabProfile) {
  try {
    localStorage.setItem(PROFILE_KEY, JSON.stringify(p));
  } catch {
    /* indisponible */
  }
}

export type CollabPhase = 'idle' | 'starting' | 'joining' | 'live' | 'reconnecting' | 'stopping';

export interface CollabState {
  role: 'host' | 'guest' | null;
  phase: CollabPhase;
  /** Espace partagé, ici. */
  workspaceId: string | null;
  shareId: string | null;
  title: string;
  /** Mon id dans la session (« h » pour l'hôte). */
  me: string | null;
  members: CollabMember[];
  /** Hôte : demandes en attente. */
  requests: CollabRequest[];
  code: string | null;
  codeState: 'open' | 'tries';
  addresses: string[];
  /** Hôte : joignable aussi par Internet (le code suffit). */
  internet: boolean;
  /** Nombre de places de la session (2 à 6, hôte compris), choisi par l'hôte. */
  maxPeople: number;
  /** Écrits ouverts en direct : salle (gid de l'écrit) → personnes qui y écrivent. */
  rooms: Record<string, string[]>;
  /** Avancement de l'arrivée de l'espace chez un invité. */
  progress: string | null;
  /** Fenêtres. */
  panelFor: string | null;
  joinOpen: boolean;
  error: string | null;
  /** Réunion en attente des choix de l'utilisateur (reunion.ts). */
  reunion: { hostName: string; items: ReunionItem[]; resolve: (c: Record<string, Choice>) => void } | null;
  /** Invité, fin de session : garder l'espace reçu sur cet ordinateur, ou le retirer (corbeille). */
  afterSession: { workspaceId: string; name: string; hostName: string; targets: { kind: WorkspaceItemKind | 'highlight'; id: string }[] } | null;
}

export const useCollab = create<CollabState>(() => ({
  role: null,
  phase: 'idle',
  workspaceId: null,
  shareId: null,
  title: '',
  me: null,
  members: [],
  requests: [],
  code: null,
  codeState: 'open',
  addresses: [],
  internet: false,
  maxPeople: 6,
  rooms: {},
  progress: null,
  panelFor: null,
  afterSession: null,
  joinOpen: false,
  error: null,
  reunion: null,
}));

/** Session en cours dans cet espace ? */
export const isLiveIn = (s: CollabState, workspaceId: string) => s.workspaceId === workspaceId && s.role !== null && (s.phase === 'live' || s.phase === 'reconnecting' || s.phase === 'stopping');

/** Travail à plusieurs disponible (app de bureau). */
export const collabAvailable = () => typeof window !== 'undefined' && !!window.marginalia?.collabNet;

/** Ouvre la fenêtre « Travailler à plusieurs » d'un espace (l'hôte y ouvre la session). */
export const openCollabPanel = (workspaceId: string) => useCollab.setState({ panelFor: workspaceId, error: null });
/** Ouvre « Rejoindre un espace partagé ». */
export const openJoinDialog = () => useCollab.setState({ joinOpen: true, error: null });
/** « Arrêter le partage » (hôte) ou « Quitter » (invité). */
export async function stopCollab() {
  const m = await import('./session');
  await m.stopSession();
}
/** Code « 735-700 ». */
export const dashed = (code: string) => (code.length > 3 ? `${code.slice(0, 3)}-${code.slice(3)}` : code);
