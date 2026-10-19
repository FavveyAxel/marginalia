// Bibliothèque › « Livre papier » : un bouton compact qui ouvre un petit menu ancré dessous.
//  1. une barre de recherche « Titre, auteur ou ISBN » (Google Books puis Open Library, par le
//     processus principal), résultats en liste compacte ; un clic ajoute le livre ;
//  2. « Scanner le code-barres avec le téléphone » : QR code (réception par le Wi-Fi), le téléphone
//     lit l'ISBN et l'envoie chiffré, l'édition trouvée s'affiche ici pour être confirmée ;
//  3. « Remplir à la main » (titre, auteur, éditeur, année, photo de couverture facultative).
// Réglage « Rechercher les livres papier sur Internet » désactivé : seule la saisie à la main.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { BookPlus, Camera, ChevronLeft, ChevronRight, Loader2, PenLine, ScanBarcode, Search, Smartphone, WifiOff, X } from 'lucide-react';
import { useStore } from '../../lib/store';
import { host, type PaperEdition, type WifiEvent, type WifiInfo } from '../../lib/platform';
import { QrSvg } from '../inbox/WifiReceive';
import { addEdition, addPaperBook, authorsText, coverThumb, editionCover, editionsByIsbn, paperSearchAvailable, prettyIsbn, searchEditions } from './paper';
import './paper.css';

type View = 'main' | 'scan' | 'manual';

/** Petite couverture d'un résultat (téléchargée par le processus principal, à la demande). */
function EditionThumb({ url, title }: { url: string; title: string }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    setSrc(null);
    if (url) void editionCover(url).then((s) => alive && setSrc(s));
    return () => {
      alive = false;
    };
  }, [url]);
  return (
    <span className="pp-thumb" aria-hidden="true">
      {src ? <img src={src} alt="" draggable={false} /> : <span className="pp-thumb-initial">{(title.trim()[0] ?? '·').toUpperCase()}</span>}
    </span>
  );
}

function EditionRow({ ed, active, onPick, id }: { ed: PaperEdition; active: boolean; onPick(): void; id: string }) {
  const meta = [authorsText(ed.authors), ed.publisher, ed.year].filter(Boolean).join(' · ');
  return (
    <button type="button" id={id} role="option" aria-selected={active} className={`pp-result ${active ? 'is-active' : ''}`} onClick={onPick} data-testid="paper-result">
      <EditionThumb url={ed.cover} title={ed.title} />
      <span className="pp-result-text">
        <span className="pp-result-title truncate">
          {ed.title}
          {ed.subtitle && <span className="pp-result-sub"> · {ed.subtitle}</span>}
        </span>
        <span className="pp-result-meta truncate">{meta || 'Édition sans précisions'}</span>
      </span>
    </button>
  );
}

export function PaperAddButton({ workspaceId, groupId }: { workspaceId?: string | null; groupId?: string | null }) {
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const close = useCallback(() => {
    setOpen(false);
    requestAnimationFrame(() => btn.current?.focus());
  }, []);
  return (
    <>
      <button
        ref={btn}
        className={`btn pp-btn ${open ? 'active' : ''}`}
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="dialog"
        aria-expanded={open}
        title="Ajouter un livre que vous avez en papier"
        data-testid="paper-add"
      >
        <BookPlus size={14} /> Livre papier
      </button>
      {open && <PaperAddMenu anchor={btn} onClose={close} workspaceId={workspaceId} groupId={groupId} />}
    </>
  );
}

function PaperAddMenu({ anchor, onClose, workspaceId, groupId }: { anchor: React.RefObject<HTMLElement>; onClose(): void; workspaceId?: string | null; groupId?: string | null }) {
  const online = useStore((s) => s.settings.paperOnline !== false) && paperSearchAvailable();
  const [view, setView] = useState<View>(online ? 'main' : 'manual');
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const [prefill, setPrefill] = useState<Partial<ManualValues> | null>(null);

  // Position : juste sous le bouton, aligné sur son bord droit, toujours dans la fenêtre.
  useLayoutEffect(() => {
    const place = () => {
      const a = anchor.current?.getBoundingClientRect();
      const el = ref.current;
      if (!a || !el) return;
      const w = el.offsetWidth;
      setPos({ top: Math.round(a.bottom + 6), left: Math.round(Math.max(8, Math.min(window.innerWidth - w - 8, a.right - w))) });
    };
    place();
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, [anchor, view]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (ref.current?.contains(t) || anchor.current?.contains(t)) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      // Échap revient d'abord au menu principal, puis ferme.
      if (view !== 'main' && online) setView('main');
      else onClose();
    };
    window.addEventListener('mousedown', onDown, true);
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('mousedown', onDown, true);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [onClose, anchor, view, online]);

  const added = (title: string, id: string, existed: boolean) => {
    const st = useStore.getState();
    st.toast(existed ? `« ${title} » est déjà dans la bibliothèque` : `« ${title} » ajouté à la bibliothèque`, 'success', { label: 'Ouvrir', run: () => useStore.getState().openBook(id) });
    onClose();
  };

  return createPortal(
    <div
      ref={ref}
      className="floating pp-pop anim-scale"
      role="dialog"
      aria-label="Ajouter un livre papier"
      style={{ top: pos?.top ?? -9999, left: pos?.left ?? -9999 }}
      data-testid="paper-menu"
    >
      {view === 'main' && (
        <MainView
          onPicked={async (ed) => {
            const { book, existed } = await addEdition(ed, { workspaceId, groupId });
            added(book.title, book.id, existed);
          }}
          onScan={() => setView('scan')}
          onManual={(q) => {
            setPrefill(q ? guessManual(q) : null);
            setView('manual');
          }}
        />
      )}
      {view === 'scan' && (
        <ScanView
          onBack={() => setView('main')}
          onAdded={(title, id, existed) => added(title, id, existed)}
          onManual={(isbn) => {
            setPrefill({ isbn });
            setView('manual');
          }}
          workspaceId={workspaceId}
          groupId={groupId}
        />
      )}
      {view === 'manual' && (
        <ManualView
          initial={prefill}
          onBack={online ? () => setView('main') : undefined}
          offline={!online}
          onCancel={onClose}
          onAdd={(v) => {
            const b = addPaperBook(v, { workspaceId, groupId });
            added(b.title, b.id, false);
          }}
        />
      )}
    </div>,
    document.body,
  );
}

/** Texte tapé sans résultat → champs pré-remplis (« Titre — Auteur », ou un ISBN). */
function guessManual(q: string): Partial<ManualValues> {
  const t = q.trim();
  if (/^[\d\s-]{10,17}X?$/i.test(t)) return { isbn: t };
  const m = /^(.+?)\s+[—–-]\s+(.+)$/.exec(t);
  return m ? { title: m[1], author: m[2] } : { title: t };
}

// ── Recherche ────────────────────────────────────────────────

function MainView({ onPicked, onScan, onManual }: { onPicked(ed: PaperEdition): Promise<void>; onScan(): void; onManual(q: string): void }) {
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<PaperEdition[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cursor, setCursor] = useState(0);
  const [adding, setAdding] = useState(false);
  const seq = useRef(0);
  const scan = !!host.inbox?.wifiStart;

  // Recherche au fil de la frappe, avec un délai (350 ms) ; seule la dernière réponse compte.
  useEffect(() => {
    const text = q.trim();
    const n = ++seq.current;
    if (text.length < 2) {
      setBusy(false);
      setResults(null);
      setError(null);
      return;
    }
    setBusy(true);
    const t = setTimeout(async () => {
      const r = await searchEditions(text);
      if (n !== seq.current) return;
      setBusy(false);
      setCursor(0);
      setResults(r.results);
      setError(r.ok ? null : (r.error ?? 'Recherche impossible.'));
    }, 350);
    return () => clearTimeout(t);
  }, [q]);

  const pick = async (ed: PaperEdition) => {
    if (adding) return;
    setAdding(true);
    try {
      await onPicked(ed);
    } finally {
      setAdding(false);
    }
  };
  const list = results ?? [];
  return (
    <div className="pp-main">
      <label className="pp-search">
        <Search size={14} className="pp-search-icon" />
        <input
          className="pp-search-input"
          autoFocus
          placeholder="Titre, auteur ou ISBN"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          aria-label="Rechercher un livre papier : titre, auteur ou ISBN"
          role="combobox"
          aria-expanded={list.length > 0}
          aria-controls="pp-results"
          aria-activedescendant={list.length ? `pp-r-${cursor}` : undefined}
          aria-autocomplete="list"
          data-testid="paper-search"
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown' && list.length) {
              e.preventDefault();
              setCursor((c) => Math.min(list.length - 1, c + 1));
            } else if (e.key === 'ArrowUp' && list.length) {
              e.preventDefault();
              setCursor((c) => Math.max(0, c - 1));
            } else if (e.key === 'Enter' && list[cursor]) {
              e.preventDefault();
              void pick(list[cursor]);
            }
          }}
        />
        {(busy || adding) && <Loader2 size={14} className="pp-spin" aria-label="Recherche en cours" />}
        {!busy && !adding && q && (
          <button type="button" className="icon-btn sm" onClick={() => setQ('')} aria-label="Effacer">
            <X size={13} />
          </button>
        )}
      </label>
      {q.trim().length >= 2 && (
        <div className="pp-results" id="pp-results" role="listbox" aria-label="Éditions trouvées" aria-busy={busy}>
          {busy && !results ? (
            <div className="pp-skel" aria-hidden="true">
              {[0, 1, 2].map((i) => (
                <span key={i} className="pp-skel-row">
                  <span className="skeleton pp-skel-cover" />
                  <span className="pp-skel-lines">
                    <span className="skeleton" style={{ width: `${70 - i * 12}%` }} />
                    <span className="skeleton" style={{ width: `${48 - i * 6}%` }} />
                  </span>
                </span>
              ))}
            </div>
          ) : error ? (
            <p className="pp-note is-error" role="alert">
              <WifiOff size={13} /> {error}
            </p>
          ) : list.length === 0 ? (
            <p className="pp-note">Aucune édition trouvée. Essayez l’ISBN, ou remplissez à la main.</p>
          ) : (
            list.map((ed, i) => <EditionRow key={`${ed.isbn}|${ed.title}|${i}`} id={`pp-r-${i}`} ed={ed} active={i === cursor} onPick={() => void pick(ed)} />)
          )}
        </div>
      )}
      <div className="pp-rows">
        {scan && (
          <button type="button" className="pp-row" onClick={onScan} data-testid="paper-scan">
            <ScanBarcode size={15} />
            <span>Scanner le code-barres avec le téléphone</span>
            <ChevronRight size={13} className="pp-chev" />
          </button>
        )}
        <button type="button" className="pp-row" onClick={() => onManual(q)} data-testid="paper-manual">
          <PenLine size={15} />
          <span>Remplir à la main</span>
          <ChevronRight size={13} className="pp-chev" />
        </button>
      </div>
    </div>
  );
}

// ── Scanner avec le téléphone ────────────────────────────────

function ScanView({
  onBack,
  onAdded,
  onManual,
  workspaceId,
  groupId,
}: {
  onBack(): void;
  onAdded(title: string, id: string, existed: boolean): void;
  onManual(isbn: string): void;
  workspaceId?: string | null;
  groupId?: string | null;
}) {
  const api = host.inbox;
  const [info, setInfo] = useState<WifiInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [device, setDevice] = useState<string | null>(null);
  const [got, setGot] = useState<{ isbn: string; name: string } | null>(null);
  const [found, setFound] = useState<{ busy: boolean; results: PaperEdition[]; error?: string } | null>(null);
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    if (!api?.wifiStart) return;
    let alive = true;
    const off = api.onWifi?.((e: WifiEvent) => {
      if (!alive) return;
      if (e.type === 'device') setDevice(e.device);
      else if (e.type === 'isbn') {
        setDevice((d) => d ?? e.device);
        setGot({ isbn: e.isbn, name: e.name });
      }
    });
    api
      .wifiStart()
      .then((i) => alive && setInfo(i))
      .catch((e) => alive && setError(String((e as Error)?.message ?? e)));
    return () => {
      alive = false;
      off?.();
      // La réception ne reste pas ouverte derrière le menu (sauf si la fenêtre de la Boîte est ouverte).
      if (!document.querySelector('[data-testid="wifi-receive"]')) void api.wifiStop?.();
    };
  }, [api]);

  // ISBN reçu : l'édition est cherchée aussitôt, le téléphone suit où on en est.
  useEffect(() => {
    if (!got) return;
    let alive = true;
    setFound({ busy: true, results: [] });
    const report = (state: string, label: string) => void api?.wifiReport?.(got.name, { state, label }).catch(() => undefined);
    void editionsByIsbn(got.isbn).then((r) => {
      if (!alive) return;
      setFound({ busy: false, results: r.results, error: r.ok ? undefined : r.error });
      const ed = r.results[0];
      report('waiting', ed ? `${ed.title}${ed.publisher || ed.year ? ` — ${[ed.publisher, ed.year].filter(Boolean).join(', ')}` : ''} : à confirmer sur l’ordinateur` : 'Édition introuvable : à remplir sur l’ordinateur');
    });
    return () => {
      alive = false;
    };
  }, [got, api]);

  const confirm = async (ed: PaperEdition) => {
    if (!got || adding) return;
    setAdding(true);
    try {
      const { book, existed } = await addEdition({ ...ed, isbn: ed.isbn || got.isbn }, { workspaceId, groupId });
      void api?.wifiReport?.(got.name, { state: 'library', label: existed ? `Déjà dans la bibliothèque : « ${book.title} »` : `Ajouté à la bibliothèque : « ${book.title} »` }).catch(() => undefined);
      onAdded(book.title, book.id, existed);
    } finally {
      setAdding(false);
    }
  };

  const urls = info?.urls ?? [];
  const url = urls[0]?.url.replace('#', '/scan#') ?? '';
  return (
    <div className="pp-sub">
      <div className="pp-sub-head">
        <button type="button" className="icon-btn sm" onClick={onBack} aria-label="Retour">
          <ChevronLeft size={15} />
        </button>
        <span>Scanner le code-barres</span>
      </div>
      {got ? (
        <div className="pp-found" data-testid="paper-scan-found">
          <span className="pp-found-isbn">ISBN {prettyIsbn(got.isbn)}</span>
          {found?.busy ? (
            <p className="pp-note">
              <Loader2 size={13} className="pp-spin" /> Recherche de l’édition…
            </p>
          ) : found && found.results.length ? (
            <>
              <div className="pp-results" role="listbox" aria-label="Édition trouvée">
                {found.results.map((ed, i) => (
                  <EditionRow key={i} id={`pp-s-${i}`} ed={ed} active={i === 0} onPick={() => void confirm(ed)} />
                ))}
              </div>
              <div className="pp-actions">
                <button type="button" className="btn btn-sm" onClick={() => setGot(null)}>
                  Scanner un autre livre
                </button>
                <button type="button" className="btn btn-sm btn-primary" onClick={() => void confirm(found.results[0])} disabled={adding} data-testid="paper-scan-confirm">
                  {adding ? <Loader2 size={13} className="pp-spin" /> : <BookPlus size={13} />} Ajouter ce livre
                </button>
              </div>
            </>
          ) : (
            <>
              <p className="pp-note">{found?.error ?? 'Aucune édition trouvée pour cet ISBN.'}</p>
              <div className="pp-actions">
                <button type="button" className="btn btn-sm" onClick={() => setGot(null)}>
                  Réessayer
                </button>
                <button type="button" className="btn btn-sm btn-primary" onClick={() => onManual(got.isbn)}>
                  <PenLine size={13} /> Remplir à la main
                </button>
              </div>
            </>
          )}
        </div>
      ) : error ? (
        <p className="pp-note is-error" role="alert">
          <WifiOff size={13} /> {error}
        </p>
      ) : !info ? (
        <div className="pp-qr-wait">
          <span className="skeleton" />
        </div>
      ) : !url ? (
        <p className="pp-note is-error" role="alert">
          <WifiOff size={13} /> Cet ordinateur n’est connecté à aucun réseau local. Connectez-le au même Wi-Fi que le téléphone.
        </p>
      ) : (
        <div className="pp-qr">
          <QrSvg text={url} size={148} />
          <ol className="pp-steps">
            <li>Visez ce code avec l’appareil photo du téléphone, touchez le lien.</li>
            <li>Photographiez le code-barres au dos du livre.</li>
            <li>L’édition trouvée s’affiche ici.</li>
          </ol>
          <span className={`pp-device ${device ? 'is-on' : ''}`} aria-live="polite" data-testid="paper-scan-status">
            {device ? (
              <>
                <Smartphone size={12} /> {device} connecté
              </>
            ) : (
              <>
                <span className="wr-pulse" aria-hidden="true" /> En attente du téléphone…
              </>
            )}
          </span>
        </div>
      )}
      <p className="pp-fine">Même Wi-Fi que l’ordinateur. Seul l’ISBN part du téléphone, chiffré ; la photo du code-barres y reste.</p>
    </div>
  );
}

// ── À la main ────────────────────────────────────────────────

interface ManualValues {
  title: string;
  author: string;
  publisher: string;
  year: string;
  isbn: string;
  cover: string | null;
}

function ManualView({ initial, onBack, onCancel, onAdd, offline }: { initial: Partial<ManualValues> | null; onBack?: () => void; onCancel(): void; onAdd(v: ManualValues): void; offline: boolean }) {
  const [v, setV] = useState<ManualValues>({ title: '', author: '', publisher: '', year: '', isbn: '', cover: null, ...(initial ?? {}) });
  const [coverBusy, setCoverBusy] = useState(false);
  const set = (k: keyof ManualValues) => (e: React.ChangeEvent<HTMLInputElement>) => setV((x) => ({ ...x, [k]: e.target.value }));
  const fileRef = useRef<HTMLInputElement>(null);
  const isbnOk = useMemo(() => !v.isbn.trim() || /^(97[89])?\d{9}[\dX]$/i.test(v.isbn.replace(/[\s-]/g, '')), [v.isbn]);
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!v.title.trim() || !isbnOk) return;
    const digits = v.isbn.replace(/[\s-]/g, '').toUpperCase();
    onAdd({ ...v, isbn: digits.length === 10 ? isbn10to13(digits) : digits });
  };
  return (
    <form className="pp-sub pp-manual" onSubmit={submit}>
      <div className="pp-sub-head">
        {onBack && (
          <button type="button" className="icon-btn sm" onClick={onBack} aria-label="Retour">
            <ChevronLeft size={15} />
          </button>
        )}
        <span>Livre papier, à la main</span>
      </div>
      {offline && paperSearchAvailable() && <p className="pp-note">La recherche sur Internet est désactivée dans les Réglages : remplissez les champs vous-même.</p>}
      <div className="pp-manual-grid">
        <button type="button" className="pp-cover-pick" onClick={() => fileRef.current?.click()} aria-label={v.cover ? 'Changer la photo de couverture' : 'Ajouter une photo de couverture (facultatif)'} title="Photo de la couverture (facultatif)">
          {v.cover ? <img src={v.cover} alt="" /> : coverBusy ? <Loader2 size={16} className="pp-spin" /> : <Camera size={16} />}
          <span>{v.cover ? 'Changer' : 'Couverture'}</span>
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/*,.heic,.heif"
          hidden
          data-testid="paper-cover-file"
          onChange={async (e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (!f) return;
            setCoverBusy(true);
            const thumb = await coverThumb(await f.arrayBuffer(), f.name).catch(() => null);
            setCoverBusy(false);
            if (thumb) setV((x) => ({ ...x, cover: thumb }));
            else useStore.getState().toast('Cette image ne peut pas servir de couverture.', 'error');
          }}
        />
        <div className="pp-fields">
          <label className="pp-field">
            <span>Titre</span>
            <input className="input" value={v.title} onChange={set('title')} autoFocus required data-testid="paper-title" />
          </label>
          <label className="pp-field">
            <span>Auteur</span>
            <input className="input" value={v.author} onChange={set('author')} data-testid="paper-author" />
          </label>
        </div>
      </div>
      <div className="pp-field-row">
        <label className="pp-field">
          <span>Éditeur</span>
          <input className="input" value={v.publisher} onChange={set('publisher')} placeholder="GF Flammarion" data-testid="paper-publisher" />
        </label>
        <label className="pp-field pp-field-year">
          <span>Année</span>
          <input className="input" value={v.year} onChange={set('year')} inputMode="numeric" placeholder="2001" data-testid="paper-year" />
        </label>
      </div>
      <label className="pp-field">
        <span>ISBN (facultatif)</span>
        <input className="input" value={v.isbn} onChange={set('isbn')} inputMode="numeric" aria-invalid={!isbnOk} />
      </label>
      <div className="pp-actions">
        <button type="button" className="btn btn-sm" onClick={onCancel}>
          Annuler
        </button>
        <button type="submit" className="btn btn-sm btn-primary" disabled={!v.title.trim() || !isbnOk} data-testid="paper-manual-add">
          <BookPlus size={13} /> Ajouter
        </button>
      </div>
    </form>
  );
}

function isbn10to13(s: string): string {
  const core = '978' + s.slice(0, 9);
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(core[i]) * (i % 2 ? 3 : 1);
  return core + String((10 - (sum % 10)) % 10);
}

