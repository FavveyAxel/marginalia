// Éditeur pleine page d'un écrit (route { name: 'write', draftId }).
import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react';
import { AlertTriangle, ChevronLeft, ChevronDown, Download, FileDown, FileText, PanelRight, Printer, SearchCheck, Smartphone } from 'lucide-react';
import { SendToPhone } from './SendToPhone';
import { registerFlusher, useStore } from '../../lib/store';
import { host, type ExportFormat } from '../../lib/platform';
import type { Book, Draft, Highlight } from '../../lib/types';
import { formatFootnote } from '../../lib/citation';
import { Kbd, Skeleton } from '../../components/ui';
import type { DocEngine, EngineState, EngineStats, OutlineItem } from './engine';
import { ensureA4SectPr, parseDocx } from './docx';
import { exportText, safeFileName, toPrintHtml, usedFonts } from './exporters';
import { renderPagesForPrint } from './pagePrint';
import { bundledFontFaceCss } from './exportFonts';
import {
  fmtInt,
  words,
  getExternalDirty,
  guardedExport,
  lostText,
  rescueExport,
  setExternalDirty,
  testHooks,
  writeExternalFile,
  writeLibrary,
  type GuardedExport,
  type SaveSession,
} from './save';
import { quoteText } from './ExtractsPane';
import { SidePanel } from './SidePanel';
import { Popover, usePop } from './Popover';
import { Toolbar } from './Toolbar';
import { PageSetupButton, ZoomMenu } from './ViewControls';
import { SelectionBar } from './SelectionBar';
import { LinkEditor } from './LinkEditor';
import { usePrivateNotes } from './privateNotesUi';
import { stripForExport } from './privateNotes';
import { Outline, useSectionKeys } from './Outline';
import { SpellMenu, SpellToggle, useSpellcheck } from './spell/useSpellcheck';
import { StyleReview } from './StyleReview';
import { WordGoal } from './WordGoal';
import { FindReplace } from './FindReplace';
import { History as HistoryIcon } from 'lucide-react';
import type { DraftVersion } from '../../lib/types';
import { VersionsPanel } from './VersionsPanel';
import { CiteBar } from './CiteBar';
import { attachCiteLinks, tagInsertedCitation, type CiteHover } from './citeLink';
import { ActiveClock, addVersion, addVersionFromLibrary, registerSnapshotter, restoredTitle, fullDate, versionTitle, versionsOf } from './versions';
import { fmtKeys, isMac, isMod, matchKeys } from '../../lib/keys';
import { readZoomPref, stepZoom, usePageTint, writeZoomPref } from './view';
import { FocusButton, useChromeAutoHide, useFocusPrefs, useParagraphDim, useTypewriter } from './focus';
import { FormatReveal, useFormatMarks } from './marks';
import { CommentsButton, CommentsLayer, useComments } from './comments';
import { hasPrivateNotes } from './privateNotes';
import { shareableDocx } from '../share/sharePackage';
import type { CollabBinding } from '../collab/editorBridge';
import { LivePresence } from '../collab/LivePresence';
import { useFormatPainter } from './painter';
import { useTextDrag } from './dragText';

/** Accès de test : développement, ou app lancée par un test de bout en bout (MARGINALIA_E2E=1 → ?e2e). */
const TEST_HOOKS = typeof location !== 'undefined' && new URLSearchParams(location.search).has('e2e');

type Phase = 'loading' | 'ready' | 'error';
type Status = 'saved' | 'dirty' | 'saving' | 'blocked' | 'error';

const EXPORTS: { fmt: ExportFormat; label: string; ext: string }[] = [
  { fmt: 'docx', label: 'Word', ext: '.docx' },
  { fmt: 'pdf', label: 'PDF', ext: '.pdf' },
  { fmt: 'md', label: 'Markdown', ext: '.md' },
  { fmt: 'html', label: 'Page web', ext: '.html' },
  { fmt: 'txt', label: 'Texte brut', ext: '.txt' },
];

const EXTRACTS_KEY = 'marginalia.ed.extractsOpen';
const REVEAL_KEY = 'marginalia.ed.markReveal';
const readPref = (k: string, d: boolean) => {
  try {
    const v = localStorage.getItem(k);
    return v === null ? d : v === '1';
  } catch {
    return d;
  }
};
const writePref = (k: string, v: boolean) => {
  try {
    localStorage.setItem(k, v ? '1' : '0');
  } catch {
    /* indisponible */
  }
};

function baseName(p: string): string {
  return p.split(/[\\/]/).pop() ?? p;
}

const EMPTY_STATE: EngineState = {
  bold: false,
  italic: false,
  underline: false,
  strike: false,
  superscript: false,
  subscript: false,
  smallCaps: false,
  caps: false,
  fontFamily: null,
  fontSize: null,
  color: null,
  highlight: null,
  align: 'left',
  lineHeight: null,
  spaceBefore: 0,
  spaceAfter: 0,
  indentLeft: 0,
  firstLine: 0,
  style: 'body',
  styleId: null,
  list: null,
  listLevel: 0,
  inTable: false,
  link: null,
  empty: true,
  pos: 0,
};

/** La cible du clavier est-elle le texte du document (et non un champ de l'interface) ? */
function inDocument(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  if (!el || typeof el.closest !== 'function') return false;
  if (el.closest('.ProseMirror')) return true;
  return false;
}

export function EditorScreen({ draftId }: { draftId: string }) {
  const draft = useStore((s) => s.drafts.find((d) => d.id === draftId) ?? null);
  const navigate = useStore((s) => s.navigate);
  if (!draft) {
    return (
      <div className="ed-list">
        <header className="topbar">
          <button className="btn btn-ghost btn-sm" onClick={() => navigate({ name: 'write', draftId: null })}>
            <ChevronLeft size={16} /> Écrits
          </button>
        </header>
        <div className="empty" style={{ flex: 1 }}>
          <h3>Écrit introuvable</h3>
          <p>Cet écrit a peut-être été supprimé.</p>
          <button className="btn" onClick={() => navigate({ name: 'write', draftId: null })}>
            Revenir aux écrits
          </button>
        </div>
      </div>
    );
  }
  return <Editor draft={draft} />;
}

function Editor({ draft }: { draft: Draft }) {
  const navigate = useStore((s) => s.navigate);
  const toast = useStore((s) => s.toast);
  const patch = useStore((s) => s.patch);

  const hostRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<DocEngine | null>(null);
  const draftRef = useRef(draft);
  draftRef.current = draft;

  const [phase, setPhase] = useState<Phase>('loading');
  const [loadError, setLoadError] = useState('');
  const [status, setStatus] = useState<Status>('saved');
  const [extDirty, setExtDirtyState] = useState(() => !!draft.externalPath && getExternalDirty(draft.id));
  const [blocked, setBlocked] = useState<GuardedExport | null>(null);
  const [loadGuard, setLoadGuard] = useState<{ source: number; editor: number } | null>(null);
  const [outline, setOutline] = useState<OutlineItem[]>([]);
  const [fmt, setFmt] = useState<EngineState>(EMPTY_STATE);
  const [stats, setStats] = useState<EngineStats>({ words: draft.wordCount, chars: 0, charsNoSpaces: 0 });
  const [focusMode, setFocusMode] = useState(false);
  const focusPrefs = useFocusPrefs();
  // Marques de mise en forme (marks.tsx) : réglage conservé ; carte « Mise en forme » repliable.
  const showMarks = useStore((s) => !!s.settings.showFormatMarks);
  const toggleMarks = useCallback(() => {
    const st = useStore.getState();
    st.updateSettings({ showFormatMarks: !st.settings.showFormatMarks });
  }, []);
  const [revealOpen, setRevealOpen] = useState(() => readPref(REVEAL_KEY, true));
  const rootRef = useRef<HTMLDivElement>(null);
  const getEngine = useCallback(() => engineRef.current, []);
  const [extractsOpen, setExtractsOpen] = useState(() => readPref(EXTRACTS_KEY, true));
  const [styleOpen, setStyleOpen] = useState(false);
  const [title, setTitle] = useState(draft.title);
  const [busyExport, setBusyExport] = useState(false);

  const exportPop = usePop();
  const countPop = usePop();
  const linkPop = usePop();
  const [linkCtx, setLinkCtx] = useState<{ current: string | null; needsText: boolean }>({ current: null, needsText: false });
  const [selRect, setSelRect] = useState<DOMRect | null>(null);
  const [zoom, setZoomState] = useState(100);
  const [zoomFit, setZoomFit] = useState(() => readZoomPref() === 'fit');
  const [layoutBusy, setLayoutBusy] = useState(false);
  const dragging = useRef(false);
  const selFrame = useRef(0);
  /** Dernière opération non annulable par le moteur (mise en page, style) : instantané pour ⌘Z. */
  const structuralRef = useRef<{ snap: ArrayBuffer; seq: number } | null>(null);

  // références mutables pour les rappels du moteur
  const seq = useRef(0);
  const savedSeq = useRef(0);
  const saving = useRef<Promise<boolean> | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const uiTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const session = useRef<SaveSession>({ prevSaved: false });
  const guardRef = useRef(false); // chargement incomplet : aucun enregistrement
  const blockedRef = useRef(false);
  // Historique de versions (versions.ts) et lien citation → extrait (citeLink.ts)
  const versionClock = useRef(new ActiveClock());
  const versionChain = useRef<Promise<unknown>>(Promise.resolve());
  const [versionsOpen, setVersionsOpen] = useState(false);
  // Travailler à plusieurs : lien Yjs de l'écrit ('live'), ou invité coupé ('offline', lecture seule).
  const collabRef = useRef<CollabBinding | null>(null);
  const [liveMode, setLiveMode] = useState<'live' | 'offline' | null>(null);
  const [versionNonce, setVersionNonce] = useState(0);
  const [citeHover, setCiteHover] = useState<CiteHover | null>(null);

  const setExtDirty = useCallback((v: boolean) => {
    setExternalDirty(draftRef.current.id, v);
    setExtDirtyState(v);
  }, []);

  // Commentaires en marge (comments.tsx) : relus après chaque modification et réouverture.
  const [commentsTick, setCommentsTick] = useState(0);
  const refreshUi = useCallback(() => {
    const e = engineRef.current;
    if (!e) return;
    setCommentsTick((t) => t + 1);
    setOutline(e.outline());
    setStats(e.stats());
    setFmt(e.state());
  }, []);

  // Notes privées (⌘⌥N, affichage, presse-papiers) et ⌥⇧↑/↓ (sections) : avant les autres raccourcis.
  const [reloadTick, setReloadTick] = useState(0);
  const notesNotify = useCallback((m: string, t?: 'info' | 'error' | 'success') => toast(m, t ?? 'info'), [toast]);
  usePrivateNotes(engineRef, phase === 'ready', phase === 'ready' && !loadGuard, reloadTick, notesNotify, refreshUi);
  useSectionKeys(engineRef, phase === 'ready' && !loadGuard, notesNotify, refreshUi);

  /** Enregistrement dans la bibliothèque (et, si `external`, dans le fichier d'origine). */
  const save = useCallback(
    async (external: boolean): Promise<boolean> => {
      const e = engineRef.current;
      if (!e) return false;
      if (guardRef.current) {
        toast('Enregistrement désactivé : cet écrit ne s’est ouvert qu’en partie', 'error');
        return false;
      }
      // File d'attente stricte : un seul export / écriture à la fois, dans l'ordre d'appel
      // (sinon un instantané plus ancien pourrait être écrit après un plus récent).
      const prev = saving.current ?? Promise.resolve(true);
      const run = prev.catch(() => false).then(async () => {
        const target = seq.current;
        // enregistrement automatique sans modification depuis le dernier : rien à faire
        if (!external && target === savedSeq.current && !blockedRef.current) return true;
        setStatus('saving');
        try {
          const g = await guardedExport(e);
          if (!g.ok) {
            blockedRef.current = true;
            setBlocked(g);
            setStatus('blocked');
            return false;
          }
          blockedRef.current = false;
          setBlocked(null);
          const d = draftRef.current;
          const changed = target !== savedSeq.current;
          await writeLibrary(d, g.data, session.current, g.editorWords);
          collabRef.current?.onSaved(g.data, g.editorWords);
          savedSeq.current = target;
          if (d.externalPath) {
            if (external) {
              // Fichier de l'utilisateur : sans notes privées (la copie de la bibliothèque les garde).
              await writeExternalFile(d.externalPath, (await stripForExport(g.data)).data);
              setExtDirty(false);
              toast(`Enregistré dans « ${baseName(d.externalPath)} »`, 'success');
            } else if (changed) setExtDirty(true);
          } else if (external) toast('Enregistré', 'success');
          setStatus(seq.current === target ? 'saved' : 'dirty');
          return true;
        } catch (err) {
          console.error(err);
          setStatus('error');
          const d = draftRef.current;
          if (external && d.externalPath) {
            toast('Impossible d’écrire dans le fichier d’origine. Vos modifications restent dans Marginalia.', 'error', {
              label: 'Enregistrer sous…',
              run: () => void exportAs('docx'),
            });
          } else toast(fmtKeys('Enregistrement impossible. Vos modifications restent affichées : réessayez avec ⌘S.'), 'error');
          return false;
        }
      });
      saving.current = run;
      const ok = await run;
      if (saving.current === run) saving.current = null;
      return ok;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [toast, setExtDirty],
  );

  const scheduleSave = useCallback(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      saveTimer.current = null;
      if (!guardRef.current && seq.current !== savedSeq.current) void save(false);
    }, 1500);
  }, [save]);

  // Fermeture de la fenêtre (ou export / restauration d'une sauvegarde) : l'enregistrement différé
  // de 1,5 s est fait tout de suite, et on attend celui en cours.
  useEffect(
    () =>
      registerFlusher(async () => {
        if (saveTimer.current) {
          clearTimeout(saveTimer.current);
          saveTimer.current = null;
        }
        if (!guardRef.current && seq.current !== savedSeq.current) await save(false);
        else if (saving.current) await saving.current;
      }),
    [save],
  );

  const onChange = useCallback(() => {
    seq.current++;
    versionClock.current.touch();
    setStatus((s) => (s === 'blocked' ? s : 'dirty'));
    if (uiTimer.current) clearTimeout(uiTimer.current);
    uiTimer.current = setTimeout(refreshUi, 180);
    scheduleSave();
  }, [refreshUi, scheduleSave]);

  const updateSelBar = useCallback(() => {
    cancelAnimationFrame(selFrame.current);
    selFrame.current = requestAnimationFrame(() => {
      const e = engineRef.current;
      if (!e || dragging.current || guardRef.current) return setSelRect(null);
      setSelRect(e.selectionRect());
    });
  }, []);

  const onSelection = useCallback(() => {
    const e = engineRef.current;
    if (e) setFmt(e.state());
    updateSelBar();
  }, [updateSelBar]);

  const onReload = useCallback(() => {
    const e = engineRef.current;
    if (e) setZoomState(e.zoom());
    setReloadTick((t) => t + 1); // préférence « notes privées masquées » réappliquée
    setTimeout(() => {
      const x = engineRef.current;
      if (!x) return;
      setCommentsTick((t) => t + 1);
      setOutline(x.outline());
      setStats(x.stats());
      setFmt(x.state());
    }, 50);
  }, []);

  // ── Ouverture du document ──
  useEffect(() => {
    let cancelled = false;
    let eng: DocEngine | null = null;
    (async () => {
      const d = draftRef.current;
      const raw = await host.readFile(d.id, d.fileName);
      // G1 : A4 si sectPr absent ou vide (le test peut le désactiver pour démontrer G2)
      const data = testHooks().skipG1 ? raw : (await ensureA4SectPr(raw)).data;
      let sourceWords = 0;
      try {
        sourceWords = (await parseDocx(data)).bodyWords;
      } catch {
        /* le moteur tranchera */
      }
      const { openDocEngine } = await import('./engine');
      // Travailler à plusieurs : écrit d'un espace partagé en direct (src/features/collab).
      const { collabBindingFor } = await import('../collab/editorBridge');
      const binding = await collabBindingFor(d.id);
      if (cancelled || !hostRef.current) {
        if (binding && binding !== 'offline') binding.release();
        return;
      }
      let openData = data;
      if (binding && binding !== 'offline' && (await hasPrivateNotes(raw).catch(() => false))) {
        // Les notes privées ne sont jamais partagées : elles restent dans une version de cet écrit.
        await addVersion(d.id, raw, { kind: 'manual', name: 'Notes privées, avant le travail à plusieurs', force: true }).catch((err) => console.warn('version', err));
        if (binding.mode === 'seed') openData = (await shareableDocx(data)).data;
        toast('Les notes privées de cet écrit restent dans ses versions : elles ne sont pas partagées.', 'info');
      }
      const liveBinding = binding && binding !== 'offline' ? binding : null;
      collabRef.current = liveBinding;
      eng = await openDocEngine(hostRef.current, openData, { onChange, onSelection, onReload, collab: liveBinding });
      if (cancelled) {
        eng.destroy();
        return;
      }
      engineRef.current = eng;
      setLiveMode(liveBinding ? 'live' : binding === 'offline' ? 'offline' : null);
      if (liveBinding) liveBinding.onDetach = () => setLiveMode(null);
      const editorWords = eng.wordCount();
      if (binding === 'offline') {
        // Invité dont la connexion est coupée : lecture seule jusqu'au retour (rien ne se perd).
        guardRef.current = true;
        eng.setEditable(false);
      }
      // G2 à l'ouverture : l'éditeur montre nettement moins de texte que le fichier (sauf contenu venu
      // de la salle du travail à plusieurs, qui fait foi).
      if (liveBinding?.mode !== 'sync' && lostText(sourceWords, editorWords)) {
        guardRef.current = true;
        setLoadGuard({ source: sourceWords, editor: editorWords });
        eng.setEditable(false);
      }
      setPhase('ready');
      refreshUi();
      setZoomState(eng.zoom());
      if (!guardRef.current && Math.abs(editorWords - d.wordCount) > 0) patch('drafts', d.id, { wordCount: editorWords });
      // Historique : première ouverture → version de départ (le fichier tel qu'il a été ouvert).
      if (!guardRef.current && !versionsOf(d.id).length) versionChain.current = versionChain.current.then(() => addVersion(d.id, raw, { kind: 'auto' })).catch((err) => console.warn('version', err));
    })().catch((e) => {
      console.error(e);
      if (cancelled) return;
      setLoadError(e instanceof Error ? e.message : String(e));
      setPhase('error');
    });
    return () => {
      cancelled = true;
      if (saveTimer.current) clearTimeout(saveTimer.current);
      if (uiTimer.current) clearTimeout(uiTimer.current);
      const e = engineRef.current;
      engineRef.current = null;
      if (!e) return;
      // Dernier enregistrement (bibliothèque) avant de fermer, si nécessaire et autorisé.
      const pending = seq.current !== savedSeq.current && !guardRef.current;
      // Historique : version « à la fermeture » du fichier enregistré, s'il y a eu des modifications.
      const draftId = draftRef.current.id;
      const versionAtClose = !guardRef.current && versionClock.current.dirty;
      const finish = () => {
        e.destroy();
        if (versionAtClose) void versionChain.current.then(() => addVersionFromLibrary(draftId, { kind: 'close' })).catch((err) => console.warn('version', err));
      };
      if (!pending) {
        finish();
        return;
      }
      (async () => {
        if (saving.current) await saving.current.catch(() => false);
        const g = await guardedExport(e);
        if (g.ok) {
          await writeLibrary(draftRef.current, g.data, session.current, g.editorWords);
          collabRef.current?.onSaved(g.data, g.editorWords);
          if (draftRef.current.externalPath) setExternalDirty(draftRef.current.id, true);
        } else {
          useStore.getState().toast('Dernières modifications non enregistrées : le fichier produit était incomplet. La version précédente est intacte.', 'error');
        }
      })()
        .catch((err) => console.error(err))
        .finally(finish);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft.id]);

  // ── Opérations non annulables par le moteur (mise en page, modification de style) ──
  const structural = useCallback(
    async (label: string, run: () => Promise<ArrayBuffer>) => {
      if (!engineRef.current || guardRef.current) return;
      setLayoutBusy(true);
      try {
        const snap = await run();
        // les transactions qui suivent l'opération (mise en page, réouverture) se terminent d'abord
        await new Promise((r) => setTimeout(r, 700));
        structuralRef.current = { snap, seq: seq.current };
        toast(`${label}. ${fmtKeys('⌘Z')} pour annuler.`, 'success');
      } catch (err) {
        console.error(err);
        toast(err instanceof Error && err.name === 'CollabBlockedError' ? err.message : 'Ce réglage n’a pas pu être appliqué. Le document n’a pas changé.', 'error');
      } finally {
        setLayoutBusy(false);
        refreshUi();
      }
    },
    [toast, refreshUi],
  );

  const undo = useCallback(() => {
    const e = engineRef.current;
    if (!e || guardRef.current) return;
    const st = structuralRef.current;
    if (st && st.seq === seq.current) {
      structuralRef.current = null;
      setLayoutBusy(true);
      void e
        .restore(st.snap)
        .then(() => toast('Réglage annulé', 'info'))
        .catch((err) => {
          console.error(err);
          toast('Impossible d’annuler ce réglage.', 'error');
        })
        .finally(() => {
          setLayoutBusy(false);
          refreshUi();
        });
      return;
    }
    e.undo();
    setFmt(e.state());
  }, [toast, refreshUi]);
  const redo = useCallback(() => {
    const e = engineRef.current;
    if (!e || guardRef.current) return;
    e.redo();
    setFmt(e.state());
  }, []);

  // ── Historique de versions (versions.ts, VersionsPanel.tsx) ──
  /** Enregistre puis copie le fichier enregistré comme version (file d'attente : une à la fois). */
  const takeVersion = useCallback(
    async (kind: DraftVersion['kind'], name: string | null = null): Promise<DraftVersion | null> => {
      const d = draftRef.current;
      if (!engineRef.current) return null;
      const run = versionChain.current.then(async () => {
        const ok = guardRef.current ? false : await save(false);
        if (!ok && name) toast('Version créée à partir du dernier enregistrement réussi.', 'info');
        const v = await addVersionFromLibrary(d.id, { kind, name, force: !!name });
        versionClock.current.reset();
        return v;
      });
      versionChain.current = run.catch(() => null);
      try {
        return await run;
      } catch (err) {
        console.error(err);
        toast('La version n’a pas pu être créée.', 'error');
        return null;
      }
    },
    [save, toast],
  );

  const currentDocx = useCallback(async () => {
    const e = engineRef.current;
    if (!e) throw new Error('Éditeur fermé');
    return e.exportDocx();
  }, []);

  /** Restaure une version : version de l'état actuel d'abord, puis ⌘Z (ou « Annuler ») possible. */
  const restoreVersion = useCallback(
    async (v: DraftVersion, data: ArrayBuffer): Promise<boolean> => {
      const e = engineRef.current;
      if (!e || guardRef.current) return false;
      await takeVersion('restore');
      setLayoutBusy(true);
      try {
        const before = await e.exportDocx();
        await e.restore(data.slice(0));
        await new Promise((r) => setTimeout(r, 700));
        structuralRef.current = { snap: before, seq: seq.current };
        toast(`Version « ${versionTitle(v)} » (${fullDate(v.createdAt)}) restaurée. ${fmtKeys('⌘Z')} pour annuler.`, 'success', {
          label: 'Annuler',
          run: () => {
            if (engineRef.current !== e) return;
            structuralRef.current = null;
            setLayoutBusy(true);
            void e
              .restore(before)
              .then(() => toast('Restauration annulée', 'info'))
              .catch((err) => {
                console.error(err);
                toast('Impossible d’annuler la restauration : retrouvez l’état précédent dans les versions.', 'error');
              })
              .finally(() => {
                setLayoutBusy(false);
                refreshUi();
              });
          },
        });
        return true;
      } catch (err) {
        console.error(err);
        toast(err instanceof Error && err.name === 'CollabBlockedError' ? 'Restauration indisponible pendant le travail à plusieurs : arrêtez le partage, ou utilisez « Restaurer comme nouvel écrit ».' : 'La restauration a échoué. Le document n’a pas changé.', 'error');
        return false;
      } finally {
        setLayoutBusy(false);
        refreshUi();
      }
    },
    [takeVersion, toast, refreshUi],
  );

  const restoreAsNew = useCallback(
    async (v: DraftVersion, data: ArrayBuffer) => {
      try {
        const { createDraft } = await import('./api');
        const nd = await createDraft({ title: restoredTitle(draftRef.current, v), docx: data.slice(0) });
        toast(`Nouvel écrit « ${nd.title} » créé`, 'success');
        navigate({ name: 'write', draftId: nd.id });
      } catch (err) {
        console.error(err);
        toast('Impossible de créer l’écrit à partir de cette version.', 'error');
      }
    },
    [navigate, toast],
  );

  // Instantané automatique après ~10 min d'écriture active.
  useEffect(() => {
    if (phase !== 'ready') return;
    const t = setInterval(() => {
      if (!guardRef.current && versionClock.current.due) void takeVersion('auto');
    }, 30_000);
    return () => clearInterval(t);
  }, [phase, takeVersion]);

  // « Tout remplacer » et autres opérations en masse : snapshotActiveDraft('replace').
  useEffect(() => registerSnapshotter((kind, name) => takeVersion(kind, name ?? null)), [takeVersion]);

  // ⌘⌥S (Windows : Ctrl+Maj+S) : « Créer une version… »
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (matchKeys(ev, '⌘⌥S')) {
        ev.preventDefault();
        ev.stopPropagation();
        setVersionsOpen(true);
        setVersionNonce((n) => n + 1);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

  // Lien citation → extrait : ⌘-clic et barre au survol.
  useEffect(() => {
    const h = hostRef.current;
    if (!h || phase !== 'ready') return;
    const off = attachCiteLinks(h, () => engineRef.current, setCiteHover);
    return () => {
      off();
      setCiteHover(null);
    };
  }, [phase]);

  const openLink = useCallback(
    (anchor: HTMLElement) => {
      const e = engineRef.current;
      if (!e || guardRef.current) return;
      const st = e.state();
      setLinkCtx({ current: st.link, needsText: st.empty && !st.link });
      setSelRect(null);
      linkPop.open(anchor);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const insertFootnote = useCallback(() => {
    const e = engineRef.current;
    if (!e || guardRef.current) return;
    if (!e.insertFootnote()) toast('Placez le curseur dans le texte pour ajouter une note.', 'info');
    setFmt(e.state());
  }, [toast]);

  const setZoom = useCallback((z: number | 'fit') => {
    const e = engineRef.current;
    if (!e) return;
    e.setZoom(z);
    // Zoom d'affichage seulement (la taille du document ne change pas), mémorisé (view.ts).
    writeZoomPref(z);
    setZoomFit(z === 'fit');
    setTimeout(() => setZoomState(e.zoom()), 250);
  }, []);

  // ⌘+ / ⌘- / ⌘0 : zoom de la PAGE quand le texte de l'écrit a le focus (⌘0 : « Ajuster à la largeur »).
  // Phase de capture + preventDefault : le raccourci n'atteint pas le menu Présentation d'Electron
  // (zoom de toute l'interface), qui reste actif partout ailleurs (listes, lecteur, champs…).
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      const eng = engineRef.current;
      if (!eng || !isMod(ev) || ev.altKey || !inDocument(ev.target)) return;
      const k = ev.key;
      const c = ev.code;
      const dir = k === '+' || k === '=' || c === 'Equal' || c === 'NumpadAdd' ? 1 : k === '-' || k === '_' || c === 'Minus' || c === 'NumpadSubtract' ? -1 : (k === '0' || c === 'Digit0' || c === 'Numpad0') && !ev.shiftKey ? 0 : null;
      if (dir === null) return;
      ev.preventDefault();
      ev.stopPropagation();
      setZoom(dir === 0 ? 'fit' : stepZoom(eng.zoom(), dir));
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [setZoom]);

  // Zoom affiché : suit l'ajustement à la largeur (fenêtre, plan, panneau latéral redimensionnés).
  useEffect(() => {
    const el = hostRef.current?.closest('.ed-scroll');
    if (!el || phase !== 'ready' || typeof ResizeObserver === 'undefined') return;
    let t: ReturnType<typeof setTimeout> | undefined;
    const ro = new ResizeObserver(() => {
      clearTimeout(t);
      t = setTimeout(() => {
        const e = engineRef.current;
        if (e) setZoomState(e.zoom());
      }, 220);
    });
    ro.observe(el);
    return () => {
      ro.disconnect();
      clearTimeout(t);
    };
  }, [phase]);

  // ── Raccourcis : ⌘S, Échap (concentration), mise en forme (Word / Google Docs pour Mac) ──
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isMod(e) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 's') {
        e.preventDefault();
        void save(true);
      } else if (e.key === 'Escape' && focusMode) {
        // (si l'interface était effacée, focus.tsx a déjà consommé Échap pour la rappeler)
        setFocusMode(false);
      } else if (matchKeys(e, '⌘⇧F')) {
        e.preventDefault();
        setFocusMode((f) => !f);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [save, focusMode]);

  // ⌘8 (Ctrl+Maj+8 sous Windows) : marques de mise en forme, comme Word ; partout dans l'éditeur.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!matchKeys(e, '⌘8')) return;
      e.preventDefault();
      e.stopPropagation();
      toggleMarks();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [toggleMarks]);

  useEffect(() => {
    // Phase de capture : avant le ProseMirror de SuperDoc et avant la palette (⌘K) de l'app.
    const onKey = (ev: KeyboardEvent) => {
      const eng = engineRef.current;
      // Windows : isMod exclut Ctrl+Alt (AltGr) ; les raccourcis ⌘⌥ y deviennent Ctrl+Maj (lib/keys).
      if (!eng || guardRef.current || !isMod(ev) || !inDocument(ev.target)) return;
      const k = ev.key;
      const lk = k.toLowerCase();
      const code = ev.code;
      const act = (fn: () => void) => {
        ev.preventDefault();
        ev.stopPropagation();
        fn();
        setFmt(eng.state());
      };
      const heading = (['0', '1', '2', '3'] as const).find((d) => matchKeys(ev, `⌘⌥${d}`));
      if (heading) {
        const n = Number(heading);
        act(() => void eng.setParagraphStyle(n === 0 ? 'body' : (`h${n}` as 'h1' | 'h2' | 'h3')).then(() => setFmt(eng.state())));
      } else if (matchKeys(ev, '⌘⌥F')) act(() => insertFootnote());
      else if (ev.altKey) return;
      else if (k === '>' || (ev.shiftKey && code === 'Period' && k !== '.')) act(() => eng.stepFontSize(1));
      else if (k === '<' || (ev.shiftKey && code === 'Comma' && k !== ',')) act(() => eng.stepFontSize(-1));
      else if (k === '.') act(() => eng.toggleMark('superscript'));
      else if (k === ',') act(() => eng.toggleMark('subscript'));
      else if (ev.shiftKey && lk === 'x') act(() => eng.toggleMark('strike'));
      else if (ev.shiftKey && lk === 'k') {
        ev.preventDefault();
        ev.stopPropagation();
        const b = document.querySelector<HTMLElement>('.ed-selbar [data-sb="link"]') ?? document.querySelector<HTMLElement>('.ed-toolbar :is([data-tb="insert"], [data-tb="more"])');
        if (b) openLink(b);
      } else if (k === '\\' || code === 'Backslash') act(() => eng.clearInlineFormatting());
      else if (!ev.shiftKey && lk === 'l') act(() => eng.setAlign('left'));
      else if (!ev.shiftKey && lk === 'e') act(() => eng.setAlign('center'));
      else if (!ev.shiftKey && lk === 'r') act(() => eng.setAlign('right'));
      else if (!ev.shiftKey && lk === 'j') act(() => eng.setAlign('justify'));
      else if (ev.shiftKey && (code === 'Digit7' || code === 'Numpad7')) act(() => eng.toggleList('ordered'));
      // (Windows : Ctrl+Maj+9, Ctrl+Maj+8 étant les marques de mise en forme — lib/keys)
      else if (matchKeys(ev, '⌘⇧8')) act(() => eng.toggleList('bullet'));
      else if (!ev.shiftKey && k === 'Enter') act(() => eng.insertPageBreak());
      else if (!ev.shiftKey && lk === 'z') {
        const st = structuralRef.current;
        if (st && st.seq === seq.current) act(() => undo());
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [insertFootnote, openLink, undo]);

  // Barre flottante : masquée pendant le glisser, recalculée au défilement et au redimensionnement.
  useEffect(() => {
    const down = (e: PointerEvent) => {
      if ((e.target as HTMLElement).closest?.('.ed-engine')) {
        dragging.current = true;
        setSelRect(null);
      }
    };
    const up = () => {
      if (!dragging.current) return;
      dragging.current = false;
      updateSelBar();
    };
    const move = () => updateSelBar();
    document.addEventListener('pointerdown', down, true);
    document.addEventListener('pointerup', up, true);
    const scroller = hostRef.current?.closest('.ed-scroll');
    scroller?.addEventListener('scroll', move, { passive: true });
    const resize = () => {
      updateSelBar();
      const e = engineRef.current;
      if (e) setTimeout(() => setZoomState(e.zoom()), 200);
    };
    window.addEventListener('resize', resize);
    return () => {
      document.removeEventListener('pointerdown', down, true);
      document.removeEventListener('pointerup', up, true);
      scroller?.removeEventListener('scroll', move);
      window.removeEventListener('resize', resize);
    };
  }, [updateSelBar, phase]);

  // Titre : synchronisé si renommé ailleurs
  useEffect(() => setTitle(draft.title), [draft.title]);
  const commitTitle = () => {
    const t = title.trim();
    if (t && t !== draft.title) patch('drafts', draft.id, { title: t });
    else setTitle(draft.title);
  };

  // ── Exports ──
  /**
   * Document imprimable de l'écrit, commun à l'export PDF et à l'impression (même rendu des deux côtés).
   * Pages de l'éditeur imprimées telles quelles (sauts de page, notes en bas de page, numéros…) ; si la
   * mise en page échoue, document reconstruit à partir du texte. Polices fournies avec l'app incluses :
   * la fenêtre d'impression n'a pas accès au réseau.
   */
  const printHtmlOf = async (model: NonNullable<Awaited<ReturnType<typeof guardedExport>>['model']>, docx: ArrayBuffer, title: string) => {
    const fontCss = await bundledFontFaceCss(usedFonts(model));
    const paged = await renderPagesForPrint((await stripForExport(docx)).data, { fontCss }).catch((err) => {
      console.warn('Mise en page pour l’impression impossible :', err);
      return null;
    });
    return paged ? paged.html : toPrintHtml(model, title, { fontCss });
  };

  /** Imprimer : exactement le document de l'export PDF, puis le dialogue d'impression du système. */
  const printDraft = useCallback(
    async () => {
      exportPop.close();
      const e = engineRef.current;
      if (!e || !host.printDocument) return;
      setBusyExport(true);
      try {
        const g = await guardedExport(e);
        if (!g.ok || !g.model) {
          setBlocked(g);
          toast('Impression annulée : le document préparé était incomplet. Votre écrit n’a pas changé.', 'error');
          return;
        }
        const r = await host.printDocument(await printHtmlOf(g.model, g.data, draftRef.current.title));
        if (!r.ok && r.reason && !/cancel/i.test(r.reason)) toast(`L’impression n’a pas abouti (${r.reason}).`, 'error');
      } catch (err) {
        console.error(err);
        toast('L’impression a échoué. Réessayez, ou exportez en PDF pour l’imprimer.', 'error');
      } finally {
        setBusyExport(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [toast],
  );

  /** Produit le document exporté (sans l'enregistrer) ; null si l'export a échoué (message déjà affiché). */
  const buildExport = useCallback(
    async (format: ExportFormat): Promise<{ data: ArrayBuffer; name: string } | null> => {
      const e = engineRef.current;
      if (!e) return null;
      const g = await guardedExport(e);
      if (!g.ok || !g.model) {
        setBlocked(g);
        toast('Export annulé : le fichier produit était incomplet. Votre écrit n’a pas changé.', 'error');
        return null;
      }
      const d = draftRef.current;
      const name = safeFileName(d.title);
      let data: ArrayBuffer;
      // notes privées : retirées du .docx ; absentes du modèle (parseDocx) pour PDF, MD, HTML, TXT
      if (format === 'docx') data = (await stripForExport(g.data)).data;
      else if (format === 'pdf') {
        try {
          data = await host.printToPdf(await printHtmlOf(g.model, g.data, d.title));
        } catch (err) {
          console.warn(err);
          toast(host.kind === 'browser' ? `L’export PDF n’est disponible que dans l’app ${isMac ? 'Mac' : 'de bureau'}. Essayez Word ou Page web.` : 'L’export PDF a échoué. Réessayez, ou exportez en Word.', 'error');
          return null;
        }
      } else {
        const fontCss = format === 'html' ? await bundledFontFaceCss(usedFonts(g.model)) : '';
        // Page web : les pages telles qu'à l'écran ; Markdown et texte : le texte, sauts de page compris.
        const paged =
          format === 'html'
            ? await renderPagesForPrint((await stripForExport(g.data)).data, { fontCss, mode: 'web', title: d.title }).catch((err) => {
                console.warn('Mise en page pour la page web impossible :', err);
                return null;
              })
            : null;
        const text = paged ? paged.html : exportText(g.model, format, d.title, { fontCss });
        data = new TextEncoder().encode(text).buffer as ArrayBuffer;
      }
      patch('drafts', d.id, { wordCount: g.editorWords });
      return { data, name };
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [toast, patch],
  );

  const exportAs = useCallback(
    async (format: ExportFormat) => {
      exportPop.close();
      setBusyExport(true);
      try {
        const out = await buildExport(format);
        if (!out) return;
        const path = await host.saveBinary(`${out.name}.${format}`, out.data, format);
        if (path) toast(`Exporté : ${baseName(path)}`, 'success');
      } catch (err) {
        console.error(err);
        toast('L’export a échoué. Réessayez ou choisissez un autre format.', 'error');
      } finally {
        setBusyExport(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [toast, buildExport],
  );

  /** Envoi sur le téléphone : le document est préparé, puis proposé par QR code (réseau local). */
  const [phoneFile, setPhoneFile] = useState<{ name: string; kind: 'pdf' | 'docx'; data: ArrayBuffer } | null>(null);
  const sendToPhone = useCallback(
    async (format: 'pdf' | 'docx') => {
      exportPop.close();
      setBusyExport(true);
      try {
        const out = await buildExport(format);
        if (out) setPhoneFile({ name: out.name, kind: format, data: out.data });
      } catch (err) {
        console.error(err);
        toast('La préparation du document a échoué. Réessayez.', 'error');
      } finally {
        setBusyExport(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [toast, buildExport],
  );

  /** Copie du fichier tel qu'il est stocké (sans passer par le moteur). */
  const exportOriginal = async () => {
    const d = draftRef.current;
    try {
      const raw = await host.readFile(d.id, d.fileName);
      // sans notes privées ; si le paquet est illisible, l'original tel quel (c'est le but de ce secours)
      const data = await stripForExport(raw).then((r) => r.data).catch(() => raw);
      const p = await host.saveBinary(`${safeFileName(d.title)} (original).docx`, data, 'docx');
      if (p) toast(`Exporté : ${baseName(p)}`, 'success');
    } catch (err) {
      console.error(err);
      toast('Le fichier est introuvable dans la bibliothèque', 'error');
    }
  };

  // Rappels stables : le panneau latéral (mémoïsé) n'est pas re-rendu à chaque frappe.
  const insertExtract = useCallback(
    (h: Highlight, b: Book): boolean => {
      const e = engineRef.current;
      if (!e || guardRef.current) return false;
      const ok = e.insertCitation(quoteText(h), formatFootnote(h, b));
      // Lien citation → extrait : signet _mglHl_<id> autour du texte cité.
      tagInsertedCitation(e, h.id, quoteText(h));
      if (!ok) toast('Citation insérée sans sa note : ajoutez-la avec le bouton Note de bas de page.', 'error');
      return true;
    },
    [toast],
  );
  /** « Citer dans l'écrit » depuis le livre du panneau : la frappe reprend dans l'écrit, après la citation. */
  const citeFromBook = useCallback(
    (h: Highlight, b: Book): boolean => {
      const ok = insertExtract(h, b);
      if (ok) engineRef.current?.focus();
      return ok;
    },
    [insertExtract],
  );
  const insertText = useCallback((text: string) => {
    const e = engineRef.current;
    if (!e || guardRef.current) return;
    e.insertText(text);
    e.focus();
  }, []);

  const activeHeading = useMemo(() => {
    let cur = -1;
    outline.forEach((o, i) => {
      if (o.pos <= fmt.pos) cur = i;
    });
    return cur;
  }, [outline, fmt.pos]);

  const toggleExtracts = useCallback(() => {
    setExtractsOpen((v) => {
      writePref(EXTRACTS_KEY, !v);
      return !v;
    });
  }, []);

  const readMin = Math.max(1, Math.round(stats.words / 230));
  const statusLabel =
    phase !== 'ready'
      ? ''
      : loadGuard
        ? 'Lecture seule'
        : status === 'saving'
          ? 'Enregistrement…'
          : status === 'blocked'
            ? 'Enregistrement annulé'
            : status === 'error'
              ? 'Enregistrement impossible'
              : status === 'dirty' || (draft.externalPath && extDirty)
                ? 'Modifications non enregistrées'
                : 'Enregistré';
  const statusTone = loadGuard || status === 'blocked' || status === 'error' ? 'warn' : status === 'saved' && !(draft.externalPath && extDirty) ? 'ok' : 'pending';
  const statusHint =
    draft.externalPath && extDirty && status !== 'dirty'
      ? `Vos modifications sont gardées dans Marginalia. Enregistrez (${fmtKeys('⌘S')}) pour mettre à jour « ${baseName(draft.externalPath)} ».`
      : draft.externalPath
        ? `Fichier d’origine : ${draft.externalPath}`
        : 'Enregistrement automatique dans Marginalia';

  const editable = phase === 'ready' && !loadGuard;
  const spell = useSpellcheck(() => engineRef.current, phase === 'ready', editable);
  // Teinte de la page selon le thème ou le réglage « Page » (affichage seulement, view.ts).
  const [pageTint, setPageTint] = usePageTint(hostRef, phase === 'ready');
  // Mode concentration (focus.tsx) : interface effacée pendant la frappe, paragraphes estompés,
  // machine à écrire (aussi hors concentration).
  const chrome = useChromeAutoHide(rootRef, focusMode);
  const dimOn = focusMode && focusPrefs.dim && phase === 'ready';
  useParagraphDim(hostRef, getEngine, dimOn, fmt);
  useTypewriter(hostRef, getEngine, focusPrefs.typewriter && phase === 'ready');
  useFormatMarks(hostRef, getEngine, showMarks && phase === 'ready', fmt);
  const comments = useComments({ engineRef, hostRef, ready: phase === 'ready', editable: editable && !layoutBusy, tick: commentsTick, caret: fmt.pos, notify: toast });
  // Reproduire la mise en forme (pinceau, ⌥⌘C / ⌥⌘V) et glisser-déposer du texte sélectionné.
  const refreshFmt = useCallback(() => {
    const e = engineRef.current;
    if (e) setFmt(e.state());
  }, []);
  const painter = useFormatPainter({ engineRef, hostRef, enabled: editable, busy: layoutBusy, notify: notesNotify, refresh: refreshFmt });
  useTextDrag({ engineRef, hostRef, enabled: editable && !layoutBusy, blockedRef: painter.activeRef, onDone: refreshFmt });

  return (
    <div
      ref={rootRef}
      className={`ed-root ed-root-in ${focusMode ? 'ed-focus' : ''} ${chrome.hidden ? 'ed-chrome-off' : ''} ${dimOn ? 'ed-dim' : ''} ${focusPrefs.typewriter ? 'ed-typewriter' : ''} ${showMarks ? 'ed-marks' : ''} ${extractsOpen ? 'ed-has-extracts' : ''} ${comments.columnOn ? 'ed-cm-on' : ''} ${comments.shown ? '' : 'ed-cm-hidden'} ${painter.mode ? 'ed-painting' : ''}`}
      style={{ '--cm-col': `${comments.colW}px` } as React.CSSProperties}
    >
      <header className="topbar ed-topbar">
        <button className="btn btn-ghost btn-sm ed-back" onClick={() => navigate({ name: 'write', draftId: null })}>
          <ChevronLeft size={16} /> Écrits
        </button>
        <input
          className="ed-title-input"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={commitTitle}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
            if (e.key === 'Escape') {
              setTitle(draft.title);
              (e.target as HTMLInputElement).blur();
            }
          }}
          aria-label="Titre de l’écrit"
          spellCheck={false}
        />
        {statusLabel && (
          <span className={`ed-status ${statusTone}`} title={statusHint || statusLabel} data-status={status}>
            <span className="ed-status-dot" />
            <span className="ed-status-text">{statusLabel}</span>
          </span>
        )}
        {liveMode && <LivePresence draftId={draft.id} mode={liveMode} />}
        <div className="spacer" />
        <SpellToggle spell={spell} disabled={phase !== 'ready'} />
        <CommentsButton ctl={comments} />
        <button className={`icon-btn ${styleOpen ? 'active' : ''}`} onClick={() => setStyleOpen((v) => !v)} title="Revue de style" aria-label="Revue de style" aria-pressed={styleOpen} disabled={phase !== 'ready'}>
          <SearchCheck size={16} />
        </button>
        <button
          className={`icon-btn ${versionsOpen ? 'active' : ''}`}
          onClick={() => setVersionsOpen((v) => !v)}
          title={fmtKeys("Versions (⌘⌥S : créer une version)")}
          aria-label="Afficher les versions"
          aria-pressed={versionsOpen}
          disabled={phase !== 'ready'}
          data-tb="versions"
        >
          <HistoryIcon size={16} />
        </button>
        <button
          className={`icon-btn ${extractsOpen && !versionsOpen ? 'active' : ''}`}
          onClick={() => {
            if (!versionsOpen) return toggleExtracts();
            setVersionsOpen(false);
            if (!extractsOpen) toggleExtracts();
          }}
          title="Panneau latéral : livre, extraits, concepts, plan"
          aria-label="Afficher le panneau latéral"
          aria-pressed={extractsOpen && !versionsOpen}
        >
          <PanelRight size={16} />
        </button>
        <FocusButton focusMode={focusMode} setFocusMode={setFocusMode} prefs={focusPrefs} />
        <PageSetupButton engine={() => engineRef.current} editable={editable && !layoutBusy} structural={structural} />
        <ZoomMenu zoom={zoom} setZoom={setZoom} zoomFit={zoomFit} tint={pageTint} setTint={setPageTint} />
        <button className="btn" disabled={phase !== 'ready' || busyExport} onClick={(e) => exportPop.toggle(e.currentTarget)} aria-haspopup="menu" title="Exporter une copie" data-tb="export">
          <Download size={14} /> <span className="ed-export-label">Exporter</span> <ChevronDown size={13} style={{ marginRight: -4, opacity: 0.7 }} />
        </button>
        <button className="btn btn-primary" disabled={!editable || status === 'saving'} onClick={() => void save(true)} title={draft.externalPath ? `Écrire dans ${draft.externalPath}` : 'Enregistrer dans Marginalia'}>
          Enregistrer <Kbd>⌘S</Kbd>
        </button>
      </header>

      {(busyExport || status === 'saving') && <div className="progress-indeterminate ed-progress" role="progressbar" aria-label={busyExport ? 'Export en cours' : 'Enregistrement en cours'} />}

      <Popover pop={exportPop} label="Exporter" className="ed-menu ed-export-menu">
        {host.printDocument && (
          <>
            <button className="menu-item" onClick={() => void printDraft()} data-print="1">
              <Printer size={14} />
              <span>Imprimer…</span>
            </button>
            <div className="divider" />
          </>
        )}
        <div className="ed-pop-title">Exporter une copie</div>
        {EXPORTS.map((x) => (
          <button key={x.fmt} className="menu-item" onClick={() => void exportAs(x.fmt)} data-fmt={x.fmt}>
            {x.fmt === 'docx' ? <FileText size={14} /> : <FileDown size={14} />}
            <span>{x.label}</span>
            <span className="ed-menu-ext">{x.ext}</span>
          </button>
        ))}
        {host.sendToPhone && (
          <>
            <div className="divider" />
            <div className="ed-pop-title">Sur le téléphone, par QR code</div>
            <button className="menu-item" onClick={() => void sendToPhone('pdf')} data-phone="pdf">
              <Smartphone size={14} />
              <span>PDF, à lire ou à imprimer</span>
              <span className="ed-menu-ext">.pdf</span>
            </button>
            <button className="menu-item" onClick={() => void sendToPhone('docx')} data-phone="docx">
              <Smartphone size={14} />
              <span>Word, à continuer ailleurs</span>
              <span className="ed-menu-ext">.docx</span>
            </button>
          </>
        )}
      </Popover>
      {phoneFile && <SendToPhone file={phoneFile} onClose={() => setPhoneFile(null)} />}

      {loadGuard && (
        <div className="ed-banner warn" role="alert">
          <AlertTriangle size={15} />
          <div>
            <strong>Cet écrit ne s’est ouvert qu’en partie</strong> (l’éditeur affiche {words(loadGuard.editor)} sur {fmtInt(loadGuard.source)}). Pour le protéger, la
            modification est désactivée. Exportez l’original pour l’ouvrir dans Word.
          </div>
          <button
            className="btn btn-sm"
            onClick={() => void exportOriginal()}
          >
            Exporter l’original
          </button>
        </div>
      )}
      {blocked && !loadGuard && (
        <div className="ed-banner warn" role="alert" data-guard="g2">
          <AlertTriangle size={15} />
          <div>
            <strong>Enregistrement annulé, votre fichier n’a pas été modifié.</strong> {blocked.reason} Exportez le texte pour le garder en lieu sûr, puis réessayez.
          </div>
          <button
            className="btn btn-sm"
            onClick={async () => {
              const e = engineRef.current;
              if (!e) return;
              const p = await rescueExport(e, draftRef.current.title);
              if (p) toast(`Texte exporté : ${baseName(p)}`, 'success');
            }}
          >
            Exporter le texte
          </button>
          <button className="btn btn-sm btn-ghost" onClick={() => void save(false)}>
            Réessayer
          </button>
        </div>
      )}

      <div className="ed-toolbar-row">
        <Toolbar
          engine={() => engineRef.current}
          fmt={fmt}
          editable={editable && !layoutBusy}
          refresh={() => {
            const e = engineRef.current;
            if (e) setFmt(e.state());
          }}
          structural={structural}
          openLink={openLink}
          insertFootnote={insertFootnote}
          undo={undo}
          redo={redo}
          painter={painter}
          marks={showMarks}
          toggleMarks={toggleMarks}
          notify={(m, t) => toast(m, t ?? 'info')}
        />
      </div>
      {layoutBusy && <div className="progress-indeterminate ed-progress" role="progressbar" aria-label="Mise en page en cours" />}
      {selRect && editable && !layoutBusy && !linkPop.isOpen && (
        <SelectionBar
          engine={() => engineRef.current}
          fmt={fmt}
          rect={selRect}
          refresh={() => {
            const e = engineRef.current;
            if (e) setFmt(e.state());
          }}
          openLink={openLink}
          onComment={() => {
            if (comments.start()) setSelRect(null);
          }}
        />
      )}
      <Popover pop={linkPop} label="Lien" className="ed-menu ed-link-pop">
        <LinkEditor
          current={linkCtx.current}
          needsText={linkCtx.needsText}
          onCancel={() => {
            linkPop.close();
            engineRef.current?.focus();
          }}
          onRemove={() => {
            linkPop.close();
            const e = engineRef.current;
            if (e) {
              e.unsetLink();
              setFmt(e.state());
            }
          }}
          onApply={(href, text) => {
            linkPop.close();
            const e = engineRef.current;
            if (e) {
              if (!e.setLink(href, text)) toast('Sélectionnez le texte à transformer en lien.', 'info');
              setFmt(e.state());
            }
          }}
        />
      </Popover>

      <div className="ed-body">
        <Outline items={outline} caretActive={activeHeading} engine={() => engineRef.current} editable={editable && !layoutBusy} notify={notesNotify} refresh={refreshUi} />
        {phase === 'ready' && (
          <>
            <button className={`ed-count ${countPop.isOpen ? 'open' : ''}`} onClick={(e) => countPop.toggle(e.currentTarget)} aria-label="Statistiques de l’écrit">
              {words(stats.words)} <ChevronDown size={12} />
            </button>
            <Popover pop={countPop} prefer="above" label="Statistiques" className="ed-stats">
              <dl>
                <dt>Mots</dt>
                <dd>{fmtInt(stats.words)}</dd>
                <dt>Caractères</dt>
                <dd>{fmtInt(stats.chars)}</dd>
                <dt>Sans espaces</dt>
                <dd>{fmtInt(stats.charsNoSpaces)}</dd>
                <dt>Temps de lecture</dt>
                <dd>
                  {readMin} min
                </dd>
              </dl>
            </Popover>
          </>
        )}

        <div className="ed-center">
          <FindReplace engine={() => engineRef.current} ready={phase === 'ready' && !loadGuard} />
          <div className="ed-scroll">
            <div ref={hostRef} className={`ed-engine selectable ${phase === 'ready' ? 'ed-engine-in' : ''}`} />
            <CommentsLayer ctl={comments} />
            {phase === 'loading' && (
              <div className="ed-loading anim-fade" aria-busy="true" aria-label="Ouverture de l’écrit">
                <div className="ed-loading-page">
                  <div className="skeleton" style={{ height: 22, width: '46%', margin: '0 auto 36px' }} />
                  <Skeleton lines={5} />
                  <div style={{ height: 22 }} />
                  <div className="skeleton" style={{ height: 14, width: '38%', marginBottom: 14 }} />
                  <Skeleton lines={6} />
                  <div style={{ height: 22 }} />
                  <Skeleton lines={4} />
                </div>
              </div>
            )}
            {phase === 'error' && (
              <div className="empty ed-error">
                <h3>Impossible d’ouvrir cet écrit</h3>
                <p>{loadError || 'Le fichier est peut-être endommagé.'} Le fichier n’a pas été modifié.</p>
                <button
                  className="btn"
                  onClick={() => void exportOriginal()}
                >
                  Exporter le fichier
                </button>
              </div>
            )}
          </div>
          {phase === 'ready' && showMarks && (
            <FormatReveal
              engine={getEngine}
              fmt={fmt}
              open={revealOpen}
              setOpen={(v) => {
                writePref(REVEAL_KEY, v);
                setRevealOpen(v);
              }}
            />
          )}
          {phase === 'ready' && <WordGoal draft={draft} stats={stats} fmt={fmt} engine={() => engineRef.current} editable={editable} />}
        </div>

        {styleOpen && phase === 'ready' && <StyleReview draft={draft} stats={stats} engine={() => engineRef.current} onClose={() => setStyleOpen(false)} />}
        {extractsOpen && !versionsOpen && (
          <SidePanel draftId={draft.id} disabled={!editable} onInsertExtract={insertExtract} onCite={citeFromBook} onInsertText={insertText} onClose={toggleExtracts} />
        )}
        {versionsOpen && phase === 'ready' && (
          <VersionsPanel
            draft={draft}
            currentDocx={currentDocx}
            createVersion={(name) => takeVersion('manual', name)}
            restore={restoreVersion}
            restoreAsNew={restoreAsNew}
            createNonce={versionNonce}
            editable={editable && !layoutBusy}
            onClose={() => setVersionsOpen(false)}
          />
        )}
      </div>
      {citeHover && phase === 'ready' && !focusMode && <CiteBar hover={citeHover} />}

      {spell.enabled && editable && <SpellMenu spell={spell} />}
      {(import.meta.env.DEV || TEST_HOOKS) && <DevHandle engineRef={engineRef} save={save} exportAs={exportAs} undo={undo} />}
    </div>
  );
}

/** Accès de test (développement uniquement). */
function DevHandle({
  engineRef,
  save,
  exportAs,
  undo,
}: {
  engineRef: MutableRefObject<DocEngine | null>;
  save: (external: boolean) => Promise<boolean>;
  exportAs: (f: ExportFormat) => Promise<void>;
  undo: () => void;
}) {
  useEffect(() => {
    const w = window as unknown as { __ed?: unknown };
    w.__ed = { engine: () => engineRef.current, save, exportAs, undo };
    return () => {
      if (w.__ed) w.__ed = undefined;
    };
  }, [engineRef, save, exportAs, undo]);
  return null;
}
