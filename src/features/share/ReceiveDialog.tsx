// Fenêtre « Recevoir » : le code à 6 chiffres donné par l'autre personne (ou un fichier « .marginalia »
// déjà en main), un aperçu de ce qui arrive, puis l'import, qui AJOUTE sans rien écraser. Les messages
// d'erreur sont ceux du partage (ShareError, shareNet), montrés tels quels.
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Hash, Lock, Share2, ShieldAlert, Wifi, X } from 'lucide-react';
import { host } from '../../lib/platform';
import { useStore } from '../../lib/store';
import { alreadyReceived, findLocalBook, readSharePackage } from './sharePackage';
import { importSharePackage, type ShareImportResult } from './shareMerge';
import { errorMessage, fmtSize, type ReceiveSource, type WireMeta } from './shareUi';
import { Bridge, ContentChips, FileArt, Steps, Trouble } from './shareVisuals';
import '../inbox/inbox.css';
import './share.css';

/** Ce qu'on montre avant de recevoir (tiré du paquet lu, ou des métadonnées envoyées avec le code). */
interface View {
  title: string;
  sentence: string;
  counts: { drafts: number; maps: number; highlights: number; books: number; plans: number; arguments: number; studies: number; concepts: number; cards: number };
  booksIncluded: boolean;
  booksHere: number;
  booksWithoutFile: number;
  alreadyReceived: boolean;
  size: number;
  from?: string;
}

type Step =
  | { s: 'code' }
  | { s: 'finding' }
  | { s: 'preview'; view: View; found?: { id: string } }
  | { s: 'receiving'; done: number; total: number; waiting: boolean }
  | { s: 'importing'; done: number; total: number }
  | { s: 'result'; result: ShareImportResult };

const num = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) ? x : 0);
const text = (x: unknown, d = '') => (typeof x === 'string' ? x : d);

async function viewFromMeta(meta: Record<string, unknown>, size: number, from: string): Promise<View> {
  const m = meta as Partial<WireMeta>;
  const c = (m.counts ?? {}) as Record<string, unknown>;
  const books = Array.isArray(m.books) ? m.books.filter((b) => b && typeof b === 'object') : [];
  const state = useStore.getState();
  let here = 0;
  let without = 0;
  for (const b of books) {
    const local = await findLocalBook({ sha256: typeof b.sha256 === 'string' ? b.sha256 : null, size: num(b.size) }, state.books);
    if (local && !local.missing) here++;
    else if (!b.included) without++;
  }
  return {
    title: text(m.title, 'Partage sans titre'),
    sentence: text(m.sentence),
    counts: { drafts: num(c.drafts), maps: num(c.maps), highlights: num(c.highlights), books: num(c.books), plans: num(c.plans), arguments: num(c.arguments), studies: num(c.studies), concepts: num(c.concepts), cards: num(c.cards) },
    booksIncluded: !!m.booksIncluded,
    booksHere: here,
    booksWithoutFile: without,
    alreadyReceived: typeof m.shareId === 'string' ? alreadyReceived(state, m.shareId) : false,
    size,
    from,
  };
}

export function ReceiveDialog({ source, onClose }: { source: ReceiveSource; onClose: () => void }) {
  const net = host.shareNet;
  const [step, setStep] = useState<Step>(source.file ? { s: 'finding' } : { s: 'code' });
  const [digits, setDigits] = useState<string[]>(['', '', '', '', '', '']);
  const [manual, setManual] = useState(false);
  const [address, setAddress] = useState('');
  const [error, setError] = useState<string | null>(null);
  const bytesRef = useRef<ArrayBuffer | Uint8Array | null>(source.file?.data ?? null);
  const alive = useRef(true);
  const cells = useRef<(HTMLInputElement | null)[]>([]);
  const closeBtn = useRef<HTMLButtonElement>(null);
  const code = digits.join('');

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', k, true);
    return () => window.removeEventListener('keydown', k, true);
  }, [onClose]);
  useEffect(() => {
    if (step.s === 'code') cells.current[0]?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step.s]);

  // Fichier « .marginalia » déjà en main : aperçu direct.
  useEffect(() => {
    const f = source.file;
    if (!f) return;
    (async () => {
      const p = await readSharePackage(f.data);
      if (!alive.current) return;
      setStep({
        s: 'preview',
        view: { title: p.title, sentence: p.sentence, counts: p.counts, booksIncluded: p.booksIncluded, booksHere: p.booksHere, booksWithoutFile: p.booksWithoutFile, alreadyReceived: p.alreadyReceived, size: f.data.byteLength },
      });
    })().catch((e) => {
      if (!alive.current) return;
      setError(errorMessage(e));
      setStep({ s: 'code' });
    });
  }, [source]);

  // Progression du transfert.
  useEffect(() => {
    if (!net) return;
    return net.onEvent((e) => {
      if (e.side === 'receive' && e.type === 'progress') setStep((s) => (s.s === 'receiving' ? { s: 'receiving', done: e.done, total: e.total, waiting: false } : s));
    });
  }, [net]);

  async function search(c = code) {
    if (!net || c.length !== 6) return;
    setError(null);
    setStep({ s: 'finding' });
    try {
      const found = await net.find(c, manual && address.trim() ? address.trim() : undefined);
      const view = await viewFromMeta(found.meta, found.size, found.from?.name || found.from?.address || 'un autre ordinateur');
      if (alive.current) setStep({ s: 'preview', view, found: { id: found.id } });
    } catch (e) {
      if (!alive.current) return;
      setError(errorMessage(e));
      setStep({ s: 'code' });
    }
  }

  async function receive() {
    if (step.s !== 'preview') return;
    setError(null);
    try {
      if (step.found) {
        if (!net) return;
        setStep({ s: 'receiving', done: 0, total: step.view.size, waiting: true });
        bytesRef.current = await net.receive(step.found.id);
        if (!alive.current) return;
      }
      setStep({ s: 'importing', done: 0, total: 0 });
      const result = await importSharePackage(bytesRef.current!, {
        onProgress: (done, total) => alive.current && setStep({ s: 'importing', done, total }),
      });
      if (alive.current) setStep({ s: 'result', result });
    } catch (e) {
      if (!alive.current) return;
      setError(errorMessage(e));
      setStep(source.file ? { s: 'preview', view: (step as { view: View }).view } : { s: 'code' });
    }
  }

  /** Saisie d'un seul tenant : « 735-700 », « 735 700 » ou « 735700 » ; le tiret se place tout seul. */
  const setCode = (raw: string) => {
    const only = raw.replace(/\D/g, '').slice(0, 6);
    setDigits(['', '', '', '', '', ''].map((_, k) => only[k] ?? ''));
    setError(null);
    if (only.length === 6 && !manual) void search(only);
  };
  const shown = code.length > 3 ? `${code.slice(0, 3)}-${code.slice(3)}` : code;

  const fromFace = (name?: string) => (name ? { letter: name.charAt(0).toUpperCase(), color: 'var(--primary)' } : null);
  let content: JSX.Element;
  if (step.s === 'code' || (step.s === 'finding' && !source.file)) {
    const finding = step.s === 'finding';
    content = (
      <div className="sh-recv" data-testid="receive-code">
        <Bridge state={finding ? 'flow' : 'wait'} left="L’autre ordinateur" right="Cet ordinateur" />
        <Steps
          items={[
            { icon: <Share2 size={18} />, label: 'Partager' },
            { icon: <Wifi size={18} />, label: 'Par le Wi-Fi' },
            { icon: <Hash size={18} />, label: 'Le code s’affiche' },
          ]}
        />
        <input
          ref={(el) => (cells.current[0] = el)}
          className="sh-code-input"
          inputMode="numeric"
          autoComplete="one-time-code"
          placeholder="000-000"
          maxLength={9}
          value={shown}
          aria-label="Code à 6 chiffres"
          disabled={finding}
          onChange={(e) => setCode(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && code.length === 6 && void search()}
          spellCheck={false}
          data-testid="receive-code-input"
        />
        {manual && (
          <label className="sh-addr">
            <span>Adresse affichée par l’expéditeur</span>
            <input type="text" value={address} onChange={(e) => setAddress(e.target.value)} placeholder="192.168.1.20:47802" spellCheck={false} autoCapitalize="off" data-testid="receive-address" />
          </label>
        )}
        {finding ? (
          <p className="sh-small center" aria-live="polite">Recherche sur le réseau…</p>
        ) : (
          <div className="sh-actions">
            <Trouble summary="Rien n’est trouvé ?">
              <button className="sh-link" onClick={() => setManual((m) => !m)} data-testid="receive-manual">
                {manual ? 'Chercher sur le réseau' : 'Saisir une adresse'}
              </button>
            </Trouble>
            <span className="spacer" />
            <button className="btn btn-primary" disabled={code.length !== 6} onClick={() => void search()} data-testid="receive-search">
              Chercher
            </button>
          </div>
        )}
        {error && <p className="sh-error" role="alert" data-testid="receive-error">{error}</p>}
      </div>
    );
  } else if (step.s === 'finding') {
    content = <p className="wr-wait">Lecture du fichier…</p>;
  } else if (step.s === 'preview') {
    const v = step.view;
    const c = v.counts;
    content = (
      <div className="sh-recv" data-testid="receive-preview">
        {v.from ? (
          <Bridge state="idle" left={v.from} leftFace={fromFace(v.from)} right="Cet ordinateur" />
        ) : (
          <div className="sh-file-row">
            <FileArt />
            <span className="sh-small">Fichier de partage</span>
          </div>
        )}
        <section className="sh-sum">
          <h3 data-testid="receive-title">{v.title}</h3>
          <ContentChips counts={c} bookNote={c.books > 0 ? (v.booksIncluded ? (c.books > 1 ? 'fichiers joints' : 'fichier joint') : 'sans fichier') : undefined} />
          {(v.booksHere > 0 || v.booksWithoutFile > 0) && (
            <p className="sh-note">
              {v.booksHere > 0 && `${v.booksHere} déjà chez vous`}
              {v.booksHere > 0 && v.booksWithoutFile > 0 && ' · '}
              {v.booksWithoutFile > 0 && `${v.booksWithoutFile} à importer plus tard pour l’ouvrir`}
            </p>
          )}
        </section>
        {v.alreadyReceived && (
          <p className="sh-warn" role="status" data-testid="receive-already">
            <ShieldAlert size={14} /> Déjà reçu : le recevoir de nouveau crée une seconde copie, sans rien écraser.
          </p>
        )}
        <div className="sh-actions">
          <span className="sh-small">S’ajoute à votre bibliothèque, rien n’est remplacé · {fmtSize(v.size)}</span>
          <span className="spacer" />
          <button className="btn" onClick={onClose}>Annuler</button>
          <button className="btn btn-primary" onClick={() => void receive()} data-testid="receive-go">Recevoir</button>
        </div>
        {error && <p className="sh-error" role="alert" data-testid="receive-error">{error}</p>}
      </div>
    );
  } else if (step.s === 'receiving' || step.s === 'importing') {
    const waiting = step.s === 'receiving' && step.waiting;
    const pct = step.total ? Math.min(100, Math.round((step.done / step.total) * 100)) : 0;
    content = (
      <div className="sh-sending" data-testid="receive-progress">
        <Bridge state={waiting ? 'wait' : 'flow'} left="L’autre ordinateur" right="Cet ordinateur" progress={step.s === 'importing' ? 1 : waiting ? undefined : pct / 100} />
        <p className="sh-small center" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={waiting ? undefined : pct}>
          {step.s === 'receiving' ? (waiting ? 'En attente de l’accord de l’expéditeur…' : `Transfert · ${pct} %`) : 'Ajout à votre bibliothèque…'}
        </p>
      </div>
    );
  } else {
    const r = step.result;
    const go = () => {
      useStore.getState().navigate(r.workspace ? { name: 'workspace', workspaceId: r.workspace.id, groupId: null } : { name: 'library' });
      onClose();
    };
    content = (
      <div className="sh-saved" role="status" data-testid="receive-result">
        <Bridge state="done" dir="in" left="L’autre ordinateur" right="Cet ordinateur" />
        <h3>Reçu ✓</h3>
        <p data-testid="receive-sentence">{r.sentence}</p>
        {r.missingBooks.length > 0 && <p className="sh-small">{r.missingBooks.length} livre{r.missingBooks.length > 1 ? 's' : ''} sans fichier : extraits lisibles, livre à importer pour l’ouvrir.</p>}
        {r.completedBooks.length > 0 && <p className="sh-small">{r.completedBooks.length} livre{r.completedBooks.length > 1 ? 's' : ''} sans fichier complété{r.completedBooks.length > 1 ? 's' : ''}.</p>}
        {r.renamed.length > 0 && <p className="sh-small">Renommé pour ne rien confondre : {r.renamed.map((x) => `« ${x.to} »`).join(', ')}.</p>}
        <div className="sh-actions center">
          <button className="btn" onClick={onClose}>Fermer</button>
          <button className="btn btn-primary" onClick={go} data-testid="receive-open">{r.workspace ? 'Ouvrir l’espace' : 'Voir dans la bibliothèque'}</button>
        </div>
      </div>
    );
  }

  const busy = step.s === 'receiving' || step.s === 'importing';
  return createPortal(
    <div className="wr-back anim-fade" onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div className="wr-dialog sh-dialog panel anim-scale" role="dialog" aria-modal="true" aria-labelledby="shr-title" data-testid="receive-dialog">
        <header className="wr-head">
          <h2 id="shr-title">Recevoir</h2>
          <button ref={closeBtn} className="icon-btn sm" onClick={onClose} aria-label="Fermer" title="Fermer">
            <X size={16} />
          </button>
        </header>
        {content}
        <footer className="wr-foot">
          <Lock size={13} />
          <span>{source.file ? 'Le fichier est lu sur cet ordinateur, sans Internet.' : 'Transfert chiffré, sur votre réseau local, sans Internet.'}</span>
        </footer>
      </div>
    </div>,
    document.body,
  );
}
