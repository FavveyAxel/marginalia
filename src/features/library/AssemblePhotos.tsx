// Fenêtre « Assembler en un document » : les photos choisies (Boîte de réception ou bibliothèque),
// en miniatures à remettre dans l'ordre (glisser, ou flèches), un titre, puis un seul document de
// photos dans la bibliothèque.
import { useEffect, useRef, useState, type DragEvent } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft, ArrowRight, Layers, X } from 'lucide-react';
import { sniffFile } from '../../lib/sniff';
import { displayableBlob } from '../reader/image/decode';
import { assemblePhotos, defaultTitle, type PhotoSource } from './photoDoc';
import type { Book } from '../../lib/types';
import './assemble.css';

export interface AssembleResult {
  book: Book;
  /** Clés des sources assemblées (dans l'ordre). */
  keys: string[];
  /** Bibliothèque : placer les photos d'origine dans la corbeille. */
  trashOriginals: boolean;
}

function Thumb({ src }: { src: PhotoSource }) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    let u: string | null = null;
    (async () => {
      const data = await src.read();
      const ext = sniffFile(data).ext ?? 'jpg';
      const { blob } = await displayableBlob(data, `photo.${ext}`);
      if (!alive) return;
      u = URL.createObjectURL(blob);
      setUrl(u);
    })().catch(() => alive && setFailed(true));
    return () => {
      alive = false;
      if (u) URL.revokeObjectURL(u);
    };
  }, [src]);
  if (failed) return <span className="asm-thumb-fail">Aperçu indisponible</span>;
  return url ? <img src={url} alt="" draggable={false} /> : <span className="asm-thumb-wait" aria-hidden="true" />;
}

export function AssemblePhotos({
  sources,
  origin,
  title: initialTitle,
  onClose,
  onDone,
}: {
  sources: PhotoSource[];
  origin: 'inbox' | 'library';
  title?: string;
  onClose(): void;
  onDone(r: AssembleResult): void | Promise<void>;
}) {
  const [order, setOrder] = useState<PhotoSource[]>(sources);
  const [title, setTitle] = useState(initialTitle ?? defaultTitle());
  const [trash, setTrash] = useState(true);
  const [busy, setBusy] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [drag, setDrag] = useState<number | null>(null);
  const [over, setOver] = useState<number | null>(null);
  const titleRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    titleRef.current?.focus();
    titleRef.current?.select();
  }, []);
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', k, true);
    return () => window.removeEventListener('keydown', k, true);
  }, [onClose, busy]);

  const move = (from: number, to: number) => {
    if (to < 0 || to >= order.length || from === to) return;
    setOrder((o) => {
      const next = [...o];
      const [it] = next.splice(from, 1);
      next.splice(to, 0, it);
      return next;
    });
  };
  const remove = (i: number) => setOrder((o) => o.filter((_, k) => k !== i));

  const onDragStart = (i: number) => (e: DragEvent) => {
    setDrag(i);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(i));
  };
  const onDragOver = (i: number) => (e: DragEvent) => {
    if (drag === null) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (over !== i) setOver(i);
  };
  const onDrop = (i: number) => (e: DragEvent) => {
    e.preventDefault();
    if (drag !== null) move(drag, i);
    setDrag(null);
    setOver(null);
  };

  const run = async () => {
    if (order.length < 2 || busy) return;
    setError(null);
    setBusy({ done: 0, total: order.length });
    try {
      const book = await assemblePhotos(order, title, (done, total) => setBusy({ done, total }));
      await onDone({ book, keys: order.map((s) => s.key), trashOriginals: origin === 'library' && trash });
    } catch (e) {
      setError(`L’assemblage n’a pas abouti : ${(e as Error)?.message || e}`);
      setBusy(null);
    }
  };

  return createPortal(
    <div className="ws-modal-back anim-fade" onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div className="asm panel anim-scale" role="dialog" aria-modal="true" aria-labelledby="asm-title" data-testid="assemble">
        <header className="asm-head">
          <div>
            <h3 id="asm-title">Assembler en un document</h3>
            <p>Glissez les pages pour les remettre dans l’ordre. Le document rejoint la bibliothèque et se lit page par page.</p>
          </div>
          <button className="icon-btn sm" onClick={onClose} disabled={!!busy} aria-label="Fermer">
            <X size={16} />
          </button>
        </header>

        <label className="asm-title">
          <span>Titre</span>
          <input
            ref={titleRef}
            className="input"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void run()}
            maxLength={160}
            disabled={!!busy}
            data-testid="assemble-title"
          />
        </label>

        <ol className="asm-grid" aria-label="Pages du document, dans l’ordre">
          {order.map((s, i) => (
            <li
              key={s.key}
              className={`asm-page${drag === i ? ' is-drag' : ''}${over === i && drag !== null && drag !== i ? (drag < i ? ' is-over-after' : ' is-over-before') : ''}`}
              draggable={!busy}
              onDragStart={onDragStart(i)}
              onDragOver={onDragOver(i)}
              onDrop={onDrop(i)}
              onDragEnd={() => {
                setDrag(null);
                setOver(null);
              }}
              data-key={s.key}
            >
              <div className="asm-thumb">
                <Thumb src={s} />
                <span className="asm-no">{i + 1}</span>
                {order.length > 2 && (
                  <button className="asm-remove" onClick={() => remove(i)} disabled={!!busy} aria-label={`Retirer la page ${i + 1}`} title="Retirer du document">
                    <X size={12} />
                  </button>
                )}
              </div>
              <div className="asm-page-foot">
                <button className="icon-btn sm" onClick={() => move(i, i - 1)} disabled={i === 0 || !!busy} aria-label={`Avancer la page ${i + 1}`} title="Plus tôt">
                  <ArrowLeft size={13} />
                </button>
                <span className="asm-name" title={s.name}>
                  {s.name}
                </span>
                <button className="icon-btn sm" onClick={() => move(i, i + 1)} disabled={i === order.length - 1 || !!busy} aria-label={`Reculer la page ${i + 1}`} title="Plus tard">
                  <ArrowRight size={13} />
                </button>
              </div>
            </li>
          ))}
        </ol>

        {origin === 'library' ? (
          <label className="asm-check">
            <input type="checkbox" checked={trash} onChange={(e) => setTrash(e.target.checked)} disabled={!!busy} />
            <span>Placer les photos d’origine dans la corbeille (leurs extraits et leur texte reconnu suivent dans le document)</span>
          </label>
        ) : (
          <p className="asm-note">Les photos assemblées quittent la Boîte de réception ; les autres y restent.</p>
        )}
        {error && (
          <p className="asm-error" role="alert">
            {error}
          </p>
        )}

        <footer className="asm-foot">
          <button className="btn" onClick={onClose} disabled={!!busy}>
            Annuler
          </button>
          <button className="btn btn-primary" onClick={() => void run()} disabled={order.length < 2 || !!busy} data-testid="assemble-go">
            <Layers size={14} /> {busy ? `Assemblage… ${busy.done} / ${busy.total}` : `Assembler (${order.length} pages)`}
          </button>
        </footer>
      </div>
    </div>,
    document.body,
  );
}
