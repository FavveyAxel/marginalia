// 18. Export de la carte : image PNG (×2), SVG (vectoriel), PDF (A4), et « Insérer dans un
// écrit ». Les fichiers sont produits par le modèle (export SVG autonome, toujours sur fond
// clair, même en thème sombre) et enregistrés par host.saveBinary ; le nom proposé est le
// titre de la carte.
//
// Insérer dans un écrit : l'API publique de l'éditeur (features/editor/api.ts) ne sait pas
// insérer d'image dans un écrit existant (et createDraft ne prend que du HTML sans image). On
// copie donc l'image PNG dans le presse-papiers et on ouvre l'écrit choisi (ou un nouvel écrit) :
// il suffit de coller (⌘V) à l'endroit voulu.
import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, FileImage, FilePen, FilePlus2, FileText, Image as ImageIcon, Search, Share, X } from 'lucide-react';
import { useStore } from '../../../lib/store';
import { host, type SaveFormat } from '../../../lib/platform';
import { fmtKeys } from '../../../lib/keys';
import { relativeTime } from '../../../components/ui';
import { Modal } from '../../workspaces/wsUi';
import { createDraft } from '../../editor/api';
import { exportPdf, exportPng, exportSvg, lookup, readMap } from '../model/actions';
import { mapDisplayTitle } from '../model/convert';
import { mapKindOf, nodeText } from '../model/core';
import { nodeRect } from '../model/geometry';
import type { SizeMap } from '../model/geometry';

/** Titre de la carte, nettoyé pour un nom de fichier. */
export function mapFileName(key: string): string {
  const t = mapDisplayTitle(readMap(key), lookup());
  return t.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120) || 'Carte';
}

const toBuffer = (s: string): ArrayBuffer => {
  const u = new TextEncoder().encode(s);
  return u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength) as ArrayBuffer;
};

export type MapExportKind = 'png' | 'svg' | 'pdf';

/**
 * Tailles pour l'export : largeur mesurée à l'écran, hauteur au moins celle du texte complet
 * (l'export montre l'extrait entier, même replié à l'écran).
 */
function exportSizes(key: string, measured?: SizeMap): SizeMap | undefined {
  if (!measured) return undefined;
  const lk = lookup();
  const out: SizeMap = {};
  for (const n of readMap(key).nodes) {
    const s = measured[n.id];
    if (!s) continue;
    const est = nodeRect(n, nodeText(n, lk));
    out[n.id] = { w: s.w, h: Math.max(s.h, est.h) };
  }
  return out;
}

/** Produit le fichier demandé (octets) — sans boîte de dialogue. */
export async function mapExportBytes(key: string, kind: MapExportKind, measured?: SizeMap): Promise<ArrayBuffer> {
  const sizes = exportSizes(key, measured);
  if (kind === 'png') return exportPng(key, 2, { sizes });
  if (kind === 'svg') return toBuffer(exportSvg(key, { sizes }).svg);
  return exportPdf(key, { sizes });
}

const LABEL: Record<MapExportKind, string> = { png: 'image PNG', svg: 'image SVG', pdf: 'PDF' };

export async function saveMapAs(key: string, kind: MapExportKind, sizes?: SizeMap): Promise<string | null> {
  const st = useStore.getState();
  try {
    const data = await mapExportBytes(key, kind, sizes);
    const name = mapFileName(key);
    const path = await host.saveBinary(`${name}.${kind}`, data, kind as SaveFormat);
    if (path) {
      const m = readMap(key);
      st.logActivity({ action: 'export', kind: 'map', refId: key, title: name, bookId: m.bookId || null, summary: `Carte exportée en ${LABEL[kind]}` });
      st.toast(`Carte exportée en ${LABEL[kind]}`, 'success');
    }
    return path;
  } catch (e) {
    console.error(e);
    st.toast(kind === 'pdf' && host.kind === 'browser' ? 'L’export PDF n’est disponible que dans l’app de bureau' : `Export ${LABEL[kind]} impossible`, 'error');
    return null;
  }
}

/** Copie l'image PNG de la carte dans le presse-papiers. */
export async function copyMapImage(key: string, sizes?: SizeMap): Promise<boolean> {
  try {
    const blob = exportPng(key, 2, { sizes: exportSizes(key, sizes) }).then((b) => new Blob([b], { type: 'image/png' }));
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    return true;
  } catch (e) {
    console.error(e);
    return false;
  }
}

const ITEMS: { kind: MapExportKind; label: string; hint: string; icon: JSX.Element }[] = [
  { kind: 'png', label: 'Image PNG', hint: 'Haute définition, pour un diaporama ou un document', icon: <FileImage size={15} /> },
  { kind: 'svg', label: 'Image SVG', hint: 'Vectorielle, nette à toutes les tailles', icon: <ImageIcon size={15} /> },
  { kind: 'pdf', label: 'PDF', hint: 'Une page A4, prête à imprimer', icon: <FileText size={15} /> },
];

/** Bouton « Exporter » de la barre d'outils de la carte, avec son menu. */
export function ExportMenu({ mapKey, empty, sizes }: { mapKey: string; empty: boolean; sizes(): SizeMap }) {
  const [open, setOpen] = useState(false);
  const [insert, setInsert] = useState(false);
  const [busy, setBusy] = useState<MapExportKind | null>(null);
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const down = (e: PointerEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setOpen(false);
      }
    };
    window.addEventListener('pointerdown', down, true);
    window.addEventListener('keydown', key, true);
    return () => {
      window.removeEventListener('pointerdown', down, true);
      window.removeEventListener('keydown', key, true);
    };
  }, [open]);
  const run = async (kind: MapExportKind) => {
    setOpen(false);
    setBusy(kind);
    try {
      await saveMapAs(mapKey, kind, sizes());
    } finally {
      setBusy(null);
    }
  };
  return (
    <div className="map-bar-menuwrap" ref={ref}>
      <button
        className={`btn btn-ghost btn-sm ${open ? 'active' : ''}`}
        data-act="export"
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={empty || !!busy}
        onClick={() => setOpen((o) => !o)}
        title="Exporter la carte (image, PDF) ou l’insérer dans un écrit"
      >
        <Share size={14} /> {busy ? 'Export…' : 'Exporter'} <ChevronDown size={12} className="map-bar-caret" />
      </button>
      {open && (
        <div className="map-bar-menu floating anim-scale" role="menu" data-testid="map-export-menu">
          <div className="map-menu-title">Exporter la carte</div>
          {ITEMS.map((it) => (
            <button key={it.kind} role="menuitem" className="menu-item map-layout-item" data-export={it.kind} onClick={() => void run(it.kind)}>
              <span className="map-layout-ico">{it.icon}</span>
              <span className="map-layout-txt">
                <b>{it.label}</b>
                <small>{it.hint}</small>
              </span>
            </button>
          ))}
          <div className="divider" />
          <button
            role="menuitem"
            className="menu-item map-layout-item"
            data-export="draft"
            onClick={() => {
              setOpen(false);
              setInsert(true);
            }}
          >
            <span className="map-layout-ico">
              <FilePen size={15} />
            </span>
            <span className="map-layout-txt">
              <b>Insérer dans un écrit…</b>
              <small>L’image est copiée, l’écrit s’ouvre : collez-la</small>
            </span>
          </button>
          <div className="map-bar-menu-foot">Toujours sur fond clair, quel que soit le thème</div>
        </div>
      )}
      {insert && <InsertDialog mapKey={mapKey} sizes={sizes} onClose={() => setInsert(false)} />}
    </div>
  );
}

/** Choisir un écrit existant ou en créer un ; l'image est copiée, l'écrit s'ouvre. */
export function InsertDialog({ mapKey, sizes, onClose }: { mapKey: string; sizes(): SizeMap; onClose(): void }) {
  const drafts = useStore((s) => s.drafts);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement | null>(null);
  useEffect(() => input.current?.focus(), []);
  const list = useMemo(() => {
    const t = q.trim().toLowerCase();
    return [...drafts].filter((d) => !t || d.title.toLowerCase().includes(t)).sort((a, b) => b.updatedAt - a.updatedAt);
  }, [drafts, q]);
  const title = mapDisplayTitle(readMap(mapKey), lookup());
  const newTitle = mapKindOf(readMap(mapKey)) === 'book' ? `Carte — ${title}` : title;

  const go = async (draftId: string | null) => {
    if (busy) return;
    setBusy(true);
    const st = useStore.getState();
    // Copie d'abord (la page doit avoir le focus), puis on ouvre l'écrit.
    const copied = await copyMapImage(mapKey, sizes());
    let id = draftId;
    try {
      if (!id) id = (await createDraft({ title: newTitle, html: `<h1>${esc(newTitle)}</h1><p></p>` })).id;
    } catch (e) {
      console.error(e);
      st.toast('Impossible de créer l’écrit', 'error');
      setBusy(false);
      return;
    }
    onClose();
    st.navigate({ name: 'write', draftId: id });
    st.toast(
      copied ? `Image de la carte copiée : placez le curseur dans l’écrit puis collez-la (${fmtKeys('⌘V')}).` : 'L’image n’a pas pu être copiée : exportez-la en PNG puis insérez-la depuis la barre de l’éditeur (Insérer › Image…).',
      copied ? 'success' : 'error',
    );
  };

  return (
    <Modal title="Insérer la carte dans un écrit" onClose={onClose}>
      <div className="ws-pick map-insert" data-testid="map-insert-dialog">
        <header className="ws-pick-head">
          <div>
            <h3>Insérer la carte dans un écrit</h3>
            <span className="muted">L’image de la carte est copiée et l’écrit s’ouvre : collez-la à l’endroit voulu.</span>
          </div>
          <button className="icon-btn sm" onClick={onClose} aria-label="Fermer">
            <X size={15} />
          </button>
        </header>
        <button className="map-insert-new" data-act="insert-new" disabled={busy} onClick={() => void go(null)}>
          <span className="map-insert-ico">
            <FilePlus2 size={16} />
          </span>
          <span className="map-insert-txt">
            <b>Nouvel écrit</b>
            <small className="truncate">« {newTitle} »</small>
          </span>
        </button>
        {drafts.length > 0 && (
          <>
            <div className="map-insert-label">Ou dans un écrit existant</div>
            {drafts.length > 6 && (
              <label className="ws-pick-search">
                <Search size={14} />
                <input ref={input} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Chercher un écrit" aria-label="Chercher un écrit" />
              </label>
            )}
            <div className="ws-pick-list map-insert-list" role="list">
              {list.map((d) => (
                <button key={d.id} role="listitem" className="map-insert-row" data-draft={d.id} disabled={busy} onClick={() => void go(d.id)}>
                  <FilePen size={14} className="map-insert-row-ico" />
                  <span className="truncate">{d.title || 'Sans titre'}</span>
                  <span className="map-insert-when">{relativeTime(d.updatedAt)}</span>
                </button>
              ))}
              {!list.length && <p className="muted ws-pick-empty">Aucun écrit ne correspond.</p>}
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
