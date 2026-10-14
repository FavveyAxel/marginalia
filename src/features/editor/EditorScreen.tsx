// Éditeur pleine page d'un écrit (route { name: 'write', draftId }).
import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react';
import {
  AlertTriangle,
  ChevronLeft,
  Bold,
  ChevronDown,
  Download,
  FileDown,
  FileText,
  Italic,
  List,
  ListOrdered,
  Maximize2,
  PanelRight,
  Redo2,
  Superscript,
  Underline,
  Undo2,
} from 'lucide-react';
import { useStore } from '../../lib/store';
import { host, type ExportFormat } from '../../lib/platform';
import type { Book, Draft, Highlight } from '../../lib/types';
import { formatFootnote } from '../../lib/citation';
import { Kbd, Skeleton } from '../../components/ui';
import type { DocEngine, EngineState, EngineStats, OutlineItem, ParaStyle } from './engine';
import { ensureA4SectPr, parseDocx } from './docx';
import { exportText, safeFileName, toPrintHtml } from './exporters';
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
import { ExtractsPane, quoteText } from './ExtractsPane';
import { Popover, usePop } from './Popover';

type Phase = 'loading' | 'ready' | 'error';
type Status = 'saved' | 'dirty' | 'saving' | 'blocked' | 'error';

const STYLE_LABEL: Record<ParaStyle | 'other', string> = {
  h1: 'Titre 1',
  h2: 'Titre 2',
  h3: 'Titre 3',
  body: 'Corps',
  quote: 'Citation',
  other: 'Autre style',
};
const STYLE_ORDER: ParaStyle[] = ['h1', 'h2', 'h3', 'body', 'quote'];

const EXPORTS: { fmt: ExportFormat; label: string; ext: string }[] = [
  { fmt: 'docx', label: 'Word', ext: '.docx' },
  { fmt: 'pdf', label: 'PDF', ext: '.pdf' },
  { fmt: 'md', label: 'Markdown', ext: '.md' },
  { fmt: 'html', label: 'Page web', ext: '.html' },
  { fmt: 'txt', label: 'Texte brut', ext: '.txt' },
];

const EXTRACTS_KEY = 'marginalia.ed.extractsOpen';
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

const EMPTY_STATE: EngineState = { bold: false, italic: false, underline: false, style: 'body', list: false, pos: 0 };

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
  const [extractsOpen, setExtractsOpen] = useState(() => readPref(EXTRACTS_KEY, true));
  const [title, setTitle] = useState(draft.title);
  const [busyExport, setBusyExport] = useState(false);

  const exportPop = usePop();
  const stylePop = usePop();
  const countPop = usePop();

  // références mutables pour les rappels du moteur
  const seq = useRef(0);
  const savedSeq = useRef(0);
  const saving = useRef<Promise<boolean> | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const uiTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const session = useRef<SaveSession>({ prevSaved: false });
  const guardRef = useRef(false); // chargement incomplet : aucun enregistrement
  const blockedRef = useRef(false);

  const setExtDirty = useCallback((v: boolean) => {
    setExternalDirty(draftRef.current.id, v);
    setExtDirtyState(v);
  }, []);

  const refreshUi = useCallback(() => {
    const e = engineRef.current;
    if (!e) return;
    setOutline(e.outline());
    setStats(e.stats());
    setFmt(e.state());
  }, []);

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
          savedSeq.current = target;
          if (d.externalPath) {
            if (external) {
              await writeExternalFile(d.externalPath, g.data);
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
          } else toast('Enregistrement impossible. Vos modifications restent affichées : réessayez avec ⌘S.', 'error');
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

  const onChange = useCallback(() => {
    seq.current++;
    setStatus((s) => (s === 'blocked' ? s : 'dirty'));
    if (uiTimer.current) clearTimeout(uiTimer.current);
    uiTimer.current = setTimeout(refreshUi, 180);
    scheduleSave();
  }, [refreshUi, scheduleSave]);

  const onSelection = useCallback(() => {
    const e = engineRef.current;
    if (e) setFmt(e.state());
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
      if (cancelled || !hostRef.current) return;
      eng = await openDocEngine(hostRef.current, data, { onChange, onSelection });
      if (cancelled) {
        eng.destroy();
        return;
      }
      engineRef.current = eng;
      const editorWords = eng.wordCount();
      // G2 à l'ouverture : l'éditeur montre nettement moins de texte que le fichier
      if (lostText(sourceWords, editorWords)) {
        guardRef.current = true;
        setLoadGuard({ source: sourceWords, editor: editorWords });
        eng.setEditable(false);
      }
      setPhase('ready');
      refreshUi();
      if (!guardRef.current && Math.abs(editorWords - d.wordCount) > 0) patch('drafts', d.id, { wordCount: editorWords });
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
      const finish = () => e.destroy();
      if (!pending) {
        finish();
        return;
      }
      (async () => {
        if (saving.current) await saving.current.catch(() => false);
        const g = await guardedExport(e);
        if (g.ok) {
          await writeLibrary(draftRef.current, g.data, session.current, g.editorWords);
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

  // ── Raccourcis : ⌘S, Échap (concentration) ──
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 's') {
        e.preventDefault();
        void save(true);
      } else if (e.key === 'Escape' && focusMode) {
        setFocusMode(false);
      } else if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        setFocusMode((f) => !f);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [save, focusMode]);

  // Titre : synchronisé si renommé ailleurs
  useEffect(() => setTitle(draft.title), [draft.title]);
  const commitTitle = () => {
    const t = title.trim();
    if (t && t !== draft.title) patch('drafts', draft.id, { title: t });
    else setTitle(draft.title);
  };

  // ── Exports ──
  const exportAs = useCallback(
    async (format: ExportFormat) => {
      const e = engineRef.current;
      if (!e) return;
      exportPop.close();
      setBusyExport(true);
      try {
        const g = await guardedExport(e);
        if (!g.ok || !g.model) {
          setBlocked(g);
          toast('Export annulé : le fichier produit était incomplet. Votre écrit n’a pas changé.', 'error');
          return;
        }
        const d = draftRef.current;
        const name = safeFileName(d.title);
        let path: string | null = null;
        if (format === 'docx') path = await host.saveBinary(`${name}.docx`, g.data, 'docx');
        else if (format === 'pdf') {
          let pdf: ArrayBuffer;
          try {
            pdf = await host.printToPdf(toPrintHtml(g.model, d.title));
          } catch (err) {
            console.warn(err);
            toast(host.kind === 'browser' ? 'L’export PDF n’est disponible que dans l’app Mac. Essayez Word ou Page web.' : 'L’export PDF a échoué. Réessayez, ou exportez en Word.', 'error');
            return;
          }
          path = await host.saveBinary(`${name}.pdf`, pdf, 'pdf');
        } else {
          const text = exportText(g.model, format, d.title);
          const bytes = new TextEncoder().encode(text);
          path = await host.saveBinary(`${name}.${format}`, bytes.buffer as ArrayBuffer, format);
        }
        patch('drafts', d.id, { wordCount: g.editorWords });
        if (path) toast(`Exporté : ${baseName(path)}`, 'success');
      } catch (err) {
        console.error(err);
        toast('L’export a échoué. Réessayez ou choisissez un autre format.', 'error');
      } finally {
        setBusyExport(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [toast, patch],
  );

  /** Copie du fichier tel qu'il est stocké (sans passer par le moteur). */
  const exportOriginal = async () => {
    const d = draftRef.current;
    try {
      const data = await host.readFile(d.id, d.fileName);
      const p = await host.saveBinary(`${safeFileName(d.title)} (original).docx`, data, 'docx');
      if (p) toast(`Exporté : ${baseName(p)}`, 'success');
    } catch (err) {
      console.error(err);
      toast('Le fichier est introuvable dans la bibliothèque', 'error');
    }
  };

  const insertExtract = (h: Highlight, b: Book) => {
    const e = engineRef.current;
    if (!e || guardRef.current) return;
    const ok = e.insertCitation(quoteText(h), formatFootnote(h, b));
    if (!ok) toast('Citation insérée sans sa note : ajoutez-la avec le bouton Note de bas de page.', 'error');
  };

  const run = (fn: (e: DocEngine) => void) => () => {
    const e = engineRef.current;
    if (e && !guardRef.current) {
      fn(e);
      setFmt(e.state());
    }
  };

  const activeHeading = useMemo(() => {
    let cur = -1;
    outline.forEach((o, i) => {
      if (o.pos <= fmt.pos) cur = i;
    });
    return cur;
  }, [outline, fmt.pos]);

  const toggleExtracts = () => {
    setExtractsOpen((v) => {
      writePref(EXTRACTS_KEY, !v);
      return !v;
    });
  };

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
      ? `Vos modifications sont gardées dans Marginalia. Enregistrez (⌘S) pour mettre à jour « ${baseName(draft.externalPath)} ».`
      : draft.externalPath
        ? `Fichier d’origine : ${draft.externalPath}`
        : 'Enregistrement automatique dans Marginalia';

  const editable = phase === 'ready' && !loadGuard;

  return (
    <div className={`ed-root ed-root-in ${focusMode ? 'ed-focus' : ''} ${extractsOpen ? 'ed-has-extracts' : ''}`}>
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
          <span className={`ed-status ${statusTone}`} title={statusHint} data-status={status}>
            <span className="ed-status-dot" />
            {statusLabel}
          </span>
        )}
        <div className="spacer" />
        <button className={`icon-btn ${extractsOpen ? 'active' : ''}`} onClick={toggleExtracts} title="Extraits" aria-label="Afficher les extraits" aria-pressed={extractsOpen}>
          <PanelRight size={16} />
        </button>
        <button className="icon-btn" onClick={() => setFocusMode(true)} title="Mode concentration (⌘⇧F)" aria-label="Mode concentration">
          <Maximize2 size={15} />
        </button>
        <button className="btn" disabled={phase !== 'ready' || busyExport} onClick={(e) => exportPop.toggle(e.currentTarget)} aria-haspopup="menu">
          <Download size={14} /> Exporter <ChevronDown size={13} style={{ marginRight: -4, opacity: 0.7 }} />
        </button>
        <button className="btn btn-primary" disabled={!editable || status === 'saving'} onClick={() => void save(true)} title={draft.externalPath ? `Écrire dans ${draft.externalPath}` : 'Enregistrer dans Marginalia'}>
          Enregistrer <Kbd>⌘S</Kbd>
        </button>
      </header>

      {(busyExport || status === 'saving') && <div className="progress-indeterminate ed-progress" role="progressbar" aria-label={busyExport ? 'Export en cours' : 'Enregistrement en cours'} />}

      <Popover pop={exportPop} label="Exporter" className="ed-menu ed-export-menu">
        <div className="ed-pop-title">Exporter une copie</div>
        {EXPORTS.map((x) => (
          <button key={x.fmt} className="menu-item" onClick={() => void exportAs(x.fmt)} data-fmt={x.fmt}>
            {x.fmt === 'docx' ? <FileText size={14} /> : <FileDown size={14} />}
            <span>{x.label}</span>
            <span className="ed-menu-ext">{x.ext}</span>
          </button>
        ))}
      </Popover>

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
        <div className="ed-toolbar" role="toolbar" aria-label="Mise en forme">
          <button className="ed-style-btn" disabled={!editable} onClick={(e) => stylePop.toggle(e.currentTarget)} aria-haspopup="menu" aria-label="Style de paragraphe">
            {STYLE_LABEL[fmt.style]} <ChevronDown size={13} />
          </button>
          <span className="ed-sep" />
          <button className={`icon-btn sm ${fmt.bold ? 'active' : ''}`} disabled={!editable} onMouseDown={(e) => e.preventDefault()} onClick={run((e) => e.toggleMark('bold'))} title="Gras (⌘B)" aria-label="Gras" aria-pressed={fmt.bold}>
            <Bold size={15} />
          </button>
          <button className={`icon-btn sm ${fmt.italic ? 'active' : ''}`} disabled={!editable} onMouseDown={(e) => e.preventDefault()} onClick={run((e) => e.toggleMark('italic'))} title="Italique (⌘I)" aria-label="Italique" aria-pressed={fmt.italic}>
            <Italic size={15} />
          </button>
          <button className={`icon-btn sm ${fmt.underline ? 'active' : ''}`} disabled={!editable} onMouseDown={(e) => e.preventDefault()} onClick={run((e) => e.toggleMark('underline'))} title="Souligné (⌘U)" aria-label="Souligné" aria-pressed={fmt.underline}>
            <Underline size={15} />
          </button>
          <span className="ed-sep" />
          <button className="icon-btn sm" disabled={!editable} onMouseDown={(e) => e.preventDefault()} onClick={run((e) => e.toggleList('bullet'))} title="Liste à puces" aria-label="Liste à puces">
            <List size={15} />
          </button>
          <button className="icon-btn sm" disabled={!editable} onMouseDown={(e) => e.preventDefault()} onClick={run((e) => e.toggleList('ordered'))} title="Liste numérotée" aria-label="Liste numérotée">
            <ListOrdered size={15} />
          </button>
          <span className="ed-sep" />
          <button className="icon-btn sm" disabled={!editable} onMouseDown={(e) => e.preventDefault()} onClick={run((e) => void e.insertFootnote())} title="Note de bas de page" aria-label="Note de bas de page">
            <Superscript size={15} />
          </button>
          <span className="ed-sep" />
          <button className="icon-btn sm" disabled={!editable} onMouseDown={(e) => e.preventDefault()} onClick={run((e) => e.undo())} title="Annuler (⌘Z)" aria-label="Annuler">
            <Undo2 size={15} />
          </button>
          <button className="icon-btn sm" disabled={!editable} onMouseDown={(e) => e.preventDefault()} onClick={run((e) => e.redo())} title="Rétablir (⌘⇧Z)" aria-label="Rétablir">
            <Redo2 size={15} />
          </button>
        </div>
      </div>
      <Popover pop={stylePop} label="Style de paragraphe" className="ed-menu ed-style-menu">
        {STYLE_ORDER.map((s) => (
          <button
            key={s}
            className={`menu-item ed-style-${s} ${fmt.style === s ? 'focused' : ''}`}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              stylePop.close();
              run((e) => e.setParagraphStyle(s))();
            }}
          >
            {STYLE_LABEL[s]}
          </button>
        ))}
      </Popover>

      <div className="ed-body">
        <nav className="ed-outline" aria-label="Plan de l’écrit">
          <div className="ed-outline-title">Plan</div>
          {outline.length === 0 ? (
            <p className="ed-outline-empty">Les titres de votre écrit apparaîtront ici.</p>
          ) : (
            outline.map((o, i) => (
              <button key={`${o.pos}-${i}`} className={`ed-outline-item l${o.level} ${i === activeHeading ? 'active' : ''}`} onClick={() => engineRef.current?.goTo(o.pos)} title={o.text}>
                {o.text}
              </button>
            ))
          )}
        </nav>
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
          <div className="ed-scroll">
            <div ref={hostRef} className={`ed-engine selectable ${phase === 'ready' ? 'ed-engine-in' : ''}`} />
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
        </div>

        {extractsOpen && <ExtractsPane disabled={!editable} onInsert={insertExtract} onClose={toggleExtracts} />}
      </div>

      {focusMode && (
        <button className="ed-focus-exit" onClick={() => setFocusMode(false)}>
          Quitter la concentration <Kbd>Échap</Kbd>
        </button>
      )}
      {import.meta.env.DEV && <DevHandle engineRef={engineRef} save={save} exportAs={exportAs} />}
    </div>
  );
}

/** Accès de test (développement uniquement). */
function DevHandle({
  engineRef,
  save,
  exportAs,
}: {
  engineRef: MutableRefObject<DocEngine | null>;
  save: (external: boolean) => Promise<boolean>;
  exportAs: (f: ExportFormat) => Promise<void>;
}) {
  useEffect(() => {
    const w = window as unknown as { __ed?: unknown };
    w.__ed = { engine: () => engineRef.current, save, exportAs };
    return () => {
      if (w.__ed) w.__ed = undefined;
    };
  }, [engineRef, save, exportAs]);
  return null;
}
