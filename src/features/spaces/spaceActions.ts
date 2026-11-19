// Espaces chiffrés : actions de l'interface (chiffrer, déverrouiller, verrouiller, retirer le
// chiffrement). La logique des données est dans src/lib/spaces.ts ; les clés et le scellement dans le
// processus principal (electron/spaces.cjs).
import { create } from 'zustand';
import { host } from '../../lib/platform';
import { useStore, spaceOpened, spaceClosing, spaceUnsealed, saveDbNow, flushPendingSave, capsuleOf } from '../../lib/store';
import { parseCapsule } from '../../lib/spaces';
import type { Route } from '../../lib/types';
import { isLiveIn, stopCollab, useCollab } from '../collab/collabState';

export const spacesAvailable = () => !!host.spaces;

export type SpaceDialog =
  | { t: 'encrypt'; wsId: string }
  | { t: 'decrypt'; wsId: string }
  | { t: 'password' }
  | null;
/** Fenêtre ouverte (une à la fois) ; `configured` / `touchId` : état lu au processus principal. */
export const useSpaceUi = create<{ dialog: SpaceDialog; configured: boolean | null; keysLost: boolean; touchId: { available: boolean; enabled: boolean } }>(() => ({
  dialog: null,
  configured: null,
  keysLost: false,
  touchId: { available: false, enabled: false },
}));
export async function refreshSpaceStatus() {
  if (!host.spaces) return;
  const st = await host.spaces.status();
  useSpaceUi.setState({ configured: st.configured, keysLost: !!st.keysLost, touchId: st.touchId });
  // Un espace qui a un contenu scellé EST chiffré, quoi qu'en dise la base (marque retirée à la main) :
  // sinon il s'afficherait comme un espace ordinaire et vide.
  const sealed = new Set(st.encrypted);
  const s = useStore.getState();
  if (s.workspaces.some((w) => sealed.has(w.id) && !w.encrypted)) s.applyExternal((x) => ({ workspaces: x.workspaces.map((w) => (sealed.has(w.id) && !w.encrypted ? { ...w, encrypted: true } : w)) }));
}
export const openSpaceDialog = (dialog: SpaceDialog) => {
  void refreshSpaceStatus();
  useSpaceUi.setState({ dialog });
};

type Result = { ok: true } | { ok: false; error: string; waitMs?: number };
const fail = (e: unknown): Result => ({ ok: false, error: String((e as Error)?.message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '') });

/** Déverrouille un espace : mot de passe, clé de secours, ou Touch ID (`secret` null). */
export async function unlockSpace(wsId: string, secret: string | null): Promise<Result> {
  if (!host.spaces) return { ok: false, error: 'Indisponible ici.' };
  try {
    const r = secret === null ? await host.spaces.unlockTouchId(wsId) : await host.spaces.unlock(wsId, secret);
    if (!r.ok) return r;
    let capsule = null;
    if (r.capsule !== null) {
      capsule = parseCapsule(r.capsule, wsId);
      if (!capsule) {
        await host.spaces.lock(wsId);
        return { ok: false, error: 'Le contenu de cet espace est illisible.' };
      }
    }
    spaceOpened(wsId, capsule);
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

/** La route affiche-t-elle un élément qui appartient à l'espace ? (On la quitte avant de verrouiller.) */
function routeInside(route: Route, wsId: string): boolean {
  const c = capsuleOf(useStore.getState(), wsId);
  if (!c) return false;
  const r = route as Record<string, unknown>;
  const has = (list: { id: string }[], id: unknown) => typeof id === 'string' && list.some((x) => x.id === id);
  return (
    has(c.books, r.bookId) ||
    has(c.books, r.splitBookId) ||
    has(c.drafts, r.draftId) ||
    has(c.plans, r.planId) ||
    has(c.arguments, r.argumentId) ||
    has(c.concepts, r.conceptId) ||
    has(c.studies, r.studyId) ||
    (typeof r.boardId === 'string' && r.boardId in c.maps) ||
    (typeof r.mapKey === 'string' && r.mapKey in c.maps)
  );
}

/** Verrouille un espace : tout est écrit, puis son contenu quitte la mémoire de l'interface. */
export async function lockSpace(wsId: string): Promise<Result> {
  if (!host.spaces) return { ok: false, error: 'Indisponible ici.' };
  const s = useStore.getState();
  if (!s.unlockedSpaces.includes(wsId)) return { ok: true };
  try {
    // Session « travailler à plusieurs » dans cet espace : arrêtée d'abord.
    if (isLiveIn(useCollab.getState(), wsId)) await stopCollab();
    // L'écran quitte ce qui va disparaître (l'éditeur enregistre en se fermant).
    if (routeInside(s.route, wsId)) {
      s.navigate({ name: 'workspace', workspaceId: wsId, groupId: null });
      await new Promise((r) => setTimeout(r, 60));
    }
    await spaceClosing(wsId);
    // Le processus principal remplace ensuite ce rendu par un processus neuf, qui reprend ici.
    await host.spaces.lock(wsId, useStore.getState().route);
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}
/**
 * Verrouille tous les espaces ouverts (verrouillage automatique : veille, écran verrouillé, inactivité) :
 * chacun est d'abord enregistré et retiré, comme un verrouillage à la main. Un espace qui ne peut pas
 * être enregistré reste ouvert (rien n'est perdu) ; rend false dans ce cas.
 */
export async function lockAllSpaces(): Promise<boolean> {
  if (!host.spaces) return true;
  const s = useStore.getState();
  const ids = [...s.unlockedSpaces];
  if (!ids.length) return true;
  let all = true;
  for (const wsId of ids) {
    try {
      if (isLiveIn(useCollab.getState(), wsId)) await stopCollab();
      if (routeInside(useStore.getState().route, wsId)) {
        useStore.getState().navigate({ name: 'workspace', workspaceId: wsId, groupId: null });
        await new Promise((r) => setTimeout(r, 60));
      }
      await spaceClosing(wsId);
    } catch (e) {
      all = false;
      console.warn('verrouillage', e);
    }
  }
  // Un espace qui n'a pas pu être enregistré reste ouvert ; les autres sont verrouillés d'un coup.
  const left = useStore.getState().unlockedSpaces;
  const closed = ids.filter((id) => !left.includes(id));
  if (closed.length) await host.spaces.lockAll(useStore.getState().route, left.length ? closed : undefined);
  return all && !left.length;
}

/** Choisit le mot de passe commun (premier espace chiffré). Rend la clé de secours, affichée une fois. */
export async function setupSpaces(password: string): Promise<{ ok: true; recoveryKey: string } | { ok: false; error: string }> {
  if (!host.spaces) return { ok: false, error: 'Indisponible ici.' };
  try {
    const r = await host.spaces.setup(password);
    if (r.ok) useSpaceUi.setState({ configured: true });
    return r;
  } catch (e) {
    return fail(e) as { ok: false; error: string };
  }
}

/** Chiffre un espace : son contenu propre quitte la base commune dès l'enregistrement qui suit. */
export async function encryptSpace(wsId: string, secret?: string): Promise<Result> {
  if (!host.spaces) return { ok: false, error: 'Indisponible ici.' };
  try {
    await flushPendingSave();
    const r = await host.spaces.open(wsId, secret);
    if (!r.ok) return r;
    spaceOpened(wsId, null);
    useStore.getState().applyExternal((s) => ({ workspaces: s.workspaces.map((w) => (w.id === wsId ? { ...w, encrypted: true } : w)) }));
    if (!(await saveDbNow())) {
      useStore.getState().applyExternal((s) => ({ workspaces: s.workspaces.map((w) => (w.id === wsId ? { ...w, encrypted: false } : w)) }));
      return { ok: false, error: 'Enregistrement impossible : l’espace n’a pas été chiffré.' };
    }
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

/** Retire le chiffrement d'un espace déverrouillé (mot de passe vérifié) : son contenu redevient commun. */
export async function decryptSpace(wsId: string, secret: string): Promise<Result> {
  if (!host.spaces) return { ok: false, error: 'Indisponible ici.' };
  try {
    if (!useStore.getState().unlockedSpaces.includes(wsId)) return { ok: false, error: 'Déverrouillez d’abord cet espace.' };
    const v = await host.spaces.verify(secret);
    if (!v.ok) return v;
    await flushPendingSave();
    useStore.getState().applyExternal((s) => ({ workspaces: s.workspaces.map((w) => (w.id === wsId ? { ...w, encrypted: false } : w)) }));
    if (!(await spaceUnsealed(wsId))) {
      useStore.getState().applyExternal((s) => ({ workspaces: s.workspaces.map((w) => (w.id === wsId ? { ...w, encrypted: true } : w)) }));
      return { ok: false, error: 'Enregistrement impossible : l’espace reste chiffré.' };
    }
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}
