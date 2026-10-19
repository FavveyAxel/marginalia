// Fenêtre « Partager » : ce qui part (résumé), les livres joints ou non, puis deux façons de le donner à
// une autre Marginalia : un fichier « .marginalia » à enregistrer, ou un envoi direct par le Wi-Fi (code à
// 6 chiffres, réseau local, rien ne passe par Internet). Partager = donner une copie : aucun lien ensuite.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { BookOpen, Check, Clock, Hash, Laptop, Lock, ShieldAlert, Upload, WifiOff, X } from 'lucide-react';
import { host } from '../../lib/platform';
import { buildSharePackage, describeCounts, openSharePackage, SHARE_EXTENSION, type ShareSelection, type ShareSummary } from './sharePackage';
import { errorMessage, fileNameFor, fmtSize, shareNetAvailable, type WireMeta } from './shareUi';
import { BigCode, Bridge, ContentChips, FileArt, Steps, Trouble } from './shareVisuals';
import '../inbox/inbox.css';
import './share.css';

type Wifi =
  | { step: 'starting' }
  | { step: 'waiting'; code: string; expiresAt: number; addresses: string[]; discovery: boolean; note?: string }
  | { step: 'request'; code: string; expiresAt: number; device: string; addresses: string[] }
  | { step: 'sending'; device: string; done: number; total: number }
  | { step: 'done'; device: string; size: number }
  | { step: 'stopped'; message: string }
  | { step: 'error'; message: string };

interface Base {
  bytes: Uint8Array;
  summary: ShareSummary;
  books: WireMeta['books'];
  /** Taille des fichiers des livres (octets), qui s'ajoutent au paquet si on les joint. */
  booksSize: number;
}

const toBuffer = (b: Uint8Array): ArrayBuffer => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;

const STOP_TEXT: Record<string, string> = {
  expired: 'Le code a expiré (il est valable 10 minutes). Rouvrez l’envoi pour obtenir un nouveau code.',
  tries: 'Trop d’essais avec un mauvais code : l’envoi a été fermé par sécurité. Rouvrez-le pour obtenir un nouveau code.',
  locked: 'Marginalia s’est verrouillée : l’envoi a été fermé.',
  quit: 'L’envoi a été fermé.',
};

export function ShareDialog({ selection, onClose }: { selection: ShareSelection; onClose: () => void }) {
  const net = host.shareNet;
  const [base, setBase] = useState<Base | null>(null);
  const [prepError, setPrepError] = useState<string | null>(null);
  const [include, setInclude] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [wifi, setWifi] = useState<Wifi | null>(null);
  const [now, setNow] = useState(Date.now());
  const wifiOn = useRef(false);
  const closeBtn = useRef<HTMLButtonElement>(null);
  const withBooks = useRef<Uint8Array | null>(null);

  // Résumé : le paquet sans les livres est petit ; il donne aussi la taille des livres qu'on pourrait joindre.
  useEffect(() => {
    let alive = true;
    (async () => {
      const { bytes, summary } = await buildSharePackage(selection, { includeBooks: false });
      const { manifest } = await openSharePackage(bytes);
      if (!alive) return;
      const books = manifest.books.map((b) => ({ title: b.title.slice(0, 90), size: b.size, included: false, sha256: b.sha256 }));
      setBase({ bytes, summary, books, booksSize: manifest.books.reduce((n, b) => n + (b.sha256 ? b.size : 0), 0) });
    })().catch((e) => alive && setPrepError(errorMessage(e)));
    return () => {
      alive = false;
    };
  }, [selection]);

  const stopWifi = useCallback(() => {
    if (wifiOn.current) {
      wifiOn.current = false;
      void net?.sendStop().catch(() => undefined);
    }
  }, [net]);
  useEffect(() => stopWifi, [stopWifi]);

  useEffect(() => {
    closeBtn.current?.focus();
    const k = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        stopWifi();
        onClose();
      }
    };
    window.addEventListener('keydown', k, true);
    return () => window.removeEventListener('keydown', k, true);
  }, [onClose, stopWifi]);

  // Événements de l'envoi par le réseau.
  useEffect(() => {
    if (!net) return;
    return net.onEvent((e) => {
      if (e.side !== 'send') return;
      setWifi((w) => {
        if (!w) return w;
        if (e.type === 'request' && (w.step === 'waiting' || w.step === 'request')) return { step: 'request', code: w.code, expiresAt: w.expiresAt, device: e.device, addresses: w.addresses };
        if (e.type === 'request-closed' && w.step === 'request') return { step: 'waiting', code: w.code, expiresAt: w.expiresAt, addresses: w.addresses, discovery: true, note: 'La demande est restée sans réponse et s’est fermée. Le code reste valable : le destinataire peut le saisir de nouveau.' };
        if (e.type === 'attempt' && w.step === 'waiting') return { ...w, note: `Quelqu’un a essayé un mauvais code${e.remaining > 0 ? ` (encore ${e.remaining} essai${e.remaining > 1 ? 's' : ''} avant la fermeture)` : ''}.` };
        if (e.type === 'progress' && (w.step === 'sending' || w.step === 'request')) return { step: 'sending', device: w.device, done: e.done, total: e.total };
        if (e.type === 'done') return { step: 'done', device: e.device, size: e.size };
        if (e.type === 'stopped') {
          if (w.step === 'done' || e.reason === 'sent' || e.reason === 'closed') return w;
          wifiOn.current = false;
          return { step: 'stopped', message: STOP_TEXT[e.reason] ?? 'L’envoi s’est fermé.' };
        }
        return w;
      });
    });
  }, [net]);

  // Décompte du code.
  const counting = wifi?.step === 'waiting' || wifi?.step === 'request';
  useEffect(() => {
    if (!counting) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [counting]);

  const nBooks = base?.summary.counts.books ?? 0;
  /** Résumé avec ou sans les fichiers des livres (le paquet de base est construit sans eux). */
  const countsNow = useMemo(() => {
    if (!base) return null;
    const readable = base.books.filter((b) => b.sha256).length;
    return { ...base.summary.counts, booksWithFile: include ? readable : 0 };
  }, [base, include]);
  const shown = base && countsNow ? describeCounts(countsNow, include) : '';
  const total = base ? base.bytes.byteLength + (include ? base.booksSize : 0) : 0;

  /** Le paquet à donner, avec ou sans les livres. */
  async function packageBytes(): Promise<Uint8Array> {
    if (!include) return base!.bytes;
    if (withBooks.current) return withBooks.current;
    const { bytes } = await buildSharePackage(selection, { includeBooks: true });
    withBooks.current = bytes;
    return bytes;
  }

  async function saveFile() {
    if (!base || busy) return;
    setError(null);
    setBusy('Préparation du fichier…');
    try {
      const bytes = await packageBytes();
      const path = await host.saveBinary(`${fileNameFor(base.summary.title)}.${SHARE_EXTENSION}`, toBuffer(bytes), 'marginalia');
      if (path) setSaved(path);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  async function startWifi() {
    if (!base || !net || busy) return;
    setError(null);
    setBusy('Préparation de l’envoi…');
    try {
      const bytes = await packageBytes();
      const meta: WireMeta = {
        title: base.summary.title.slice(0, 120),
        scope: base.summary.scope,
        shareId: base.summary.shareId,
        sentence: describeCounts(countsNow!, include),
        // (les compteurs du résumé ci-dessous suivent le même calcul)
        counts: { ...countsNow! },
        booksIncluded: include,
        size: bytes.byteLength,
        books: base.books.slice(0, 40).map((b) => ({ ...b, included: include && !!b.sha256 })),
      };
      setWifi({ step: 'starting' });
      wifiOn.current = true;
      const info = await net.sendStart(toBuffer(bytes), meta as unknown as Record<string, unknown>);
      setNow(Date.now());
      setWifi({ step: 'waiting', code: info.code, expiresAt: info.expiresAt, addresses: info.addresses, discovery: info.discovery });
    } catch (e) {
      wifiOn.current = false;
      setWifi({ step: 'error', message: errorMessage(e) });
    } finally {
      setBusy(null);
    }
  }

  const close = () => {
    stopWifi();
    onClose();
  };
  const answer = (ok: boolean) => {
    if (!net) return;
    if (ok) setWifi((w) => (w?.step === 'request' ? { step: 'sending', device: w.device, done: 0, total: 0 } : w));
    void (ok ? net.sendAccept() : net.sendReject()).then((r) => {
      if (!ok && r) setWifi((w) => (w?.step === 'request' ? { step: 'waiting', code: w.code, expiresAt: w.expiresAt, addresses: w.addresses, discovery: true, note: 'Demande refusée. Le code reste valable.' } : w));
    });
  };

  const left = wifi && 'expiresAt' in wifi ? Math.max(0, Math.round((wifi.expiresAt - now) / 1000)) : 0;
  const mmss = `${Math.floor(left / 60)} min ${String(left % 60).padStart(2, '0')} s`;

  let body: JSX.Element;
  if (prepError) {
    body = (
      <div className="wr-problem" role="alert">
        <ShieldAlert size={22} strokeWidth={1.6} />
        <p>{prepError}</p>
      </div>
    );
  } else if (!base) {
    body = <p className="wr-wait">Préparation du partage…</p>;
  } else if (wifi) {
    body = <WifiBody wifi={wifi} mmss={mmss} title={base.summary.title} onAnswer={answer} onRetry={() => { stopWifi(); setWifi(null); }} />;
  } else if (saved) {
    body = (
      <div className="sh-saved" role="status" data-testid="share-saved" data-path={saved}>
        <FileArt done />
        <h3>Fichier enregistré</h3>
        <p className="sh-path" title={saved}>{saved}</p>
        <p className="sh-small">À donner à l’autre personne : un double-clic l’ouvre dans Marginalia.</p>
      </div>
    );
  } else {
    body = (
      <div className="sh-choose">
        <section className="sh-sum" data-testid="share-summary">
          <h3>{base.summary.title}</h3>
          <ContentChips counts={countsNow ?? {}} bookNote={nBooks ? (include ? (nBooks > 1 ? 'fichiers joints' : 'fichier joint') : 'sans fichier') : undefined} />
          {base.summary.privateNotesRemoved > 0 && (
            <p className="sh-note">
              <Lock size={12} /> {base.summary.privateNotesRemoved} note{base.summary.privateNotesRemoved > 1 ? 's privées restent' : ' privée reste'} chez vous
            </p>
          )}
          {base.summary.skipped.length > 0 && <p className="sh-note">Ne partira pas : {base.summary.skipped.slice(0, 3).join(' ; ')}{base.summary.skipped.length > 3 ? '…' : ''}</p>}
        </section>
        {nBooks > 0 && (
          <label className="sh-books">
            <input type="checkbox" className="sh-switch" checked={include} onChange={(e) => setInclude(e.target.checked)} disabled={!!busy} data-testid="share-include-books" />
            <BookOpen size={18} strokeWidth={1.6} />
            <span>
              <strong>Joindre {nBooks > 1 ? 'les livres' : 'le livre'}</strong>
              <span>{include ? 'L’autre personne pourra les ouvrir' : 'Sinon, seulement vos extraits'} · {fmtSize(base.booksSize)}</span>
            </span>
          </label>
        )}
        <div className="sh-ways">
          <button className="sh-way" onClick={() => void saveFile()} disabled={!!busy} data-testid="share-save">
            <span className="sh-way-art">
              <FileArt />
            </span>
            <strong>Fichier .marginalia</strong>
            <span>Clé USB, messagerie · {fmtSize(total)}</span>
          </button>
          <button className="sh-way" onClick={() => void startWifi()} disabled={!!busy || !shareNetAvailable()} data-testid="share-wifi" title={shareNetAvailable() ? undefined : 'Disponible dans l’app de bureau'}>
            <span className="sh-way-art">
              <Laptop size={26} strokeWidth={1.4} />
              <span className="sh-mini-link" />
              <Laptop size={26} strokeWidth={1.4} />
            </span>
            <strong>Par le Wi-Fi</strong>
            <span>{shareNetAvailable() ? 'Avec un code, sur le même réseau' : 'Dans l’app de bureau'}</span>
          </button>
        </div>
        {busy && <p className="sh-busy" role="status">{busy}</p>}
        {error && <p className="sh-error" role="alert">{error}</p>}
      </div>
    );
  }

  return createPortal(
    <div className="wr-back anim-fade" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="wr-dialog sh-dialog panel anim-scale" role="dialog" aria-modal="true" aria-labelledby="sh-title" data-testid="share-dialog">
        <header className="wr-head">
          <h2 id="sh-title">Partager</h2>
          <button ref={closeBtn} className="icon-btn sm" onClick={close} aria-label="Fermer" title={wifi && wifi.step !== 'done' && wifi.step !== 'stopped' && wifi.step !== 'error' ? 'Fermer (l’envoi s’arrête)' : 'Fermer'}>
            <X size={16} />
          </button>
        </header>
        {body}
        <footer className="wr-foot">
          <Lock size={13} />
          <span>Vous donnez une copie, chiffrée, sans passer par Internet.</span>
        </footer>
      </div>
    </div>,
    document.body,
  );
}

function WifiBody({ wifi, mmss, title, onAnswer, onRetry }: { wifi: Wifi; mmss: string; title: string; onAnswer(ok: boolean): void; onRetry(): void }) {
  if (wifi.step === 'starting') {
    return (
      <div className="sh-wifi">
        <Bridge state="idle" />
        <p className="wr-wait">Ouverture de l’envoi…</p>
      </div>
    );
  }
  if (wifi.step === 'error' || wifi.step === 'stopped') {
    return (
      <div className="wr-problem" role="alert" data-testid="share-problem">
        <WifiOff size={22} strokeWidth={1.6} />
        <p>{wifi.message}</p>
        <button className="btn btn-sm" onClick={onRetry}>Revenir au choix</button>
      </div>
    );
  }
  if (wifi.step === 'done') {
    return (
      <div className="sh-saved" role="status" data-testid="share-done">
        <Bridge state="done" right={wifi.device} rightFace={{ letter: wifi.device.charAt(0).toUpperCase(), color: 'var(--ink-2)' }} />
        <h3>Envoyé ✓</h3>
        <p>« {title} » est arrivé chez {wifi.device} ({fmtSize(wifi.size)}).</p>
      </div>
    );
  }
  if (wifi.step === 'sending') {
    const pct = wifi.total ? Math.min(100, Math.round((wifi.done / wifi.total) * 100)) : 0;
    return (
      <div className="sh-sending" data-testid="share-sending">
        <Bridge state="flow" right={wifi.device} rightFace={{ letter: wifi.device.charAt(0).toUpperCase(), color: 'var(--ink-2)' }} progress={pct / 100} />
        <p className="sh-small center" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
          {fmtSize(wifi.done)} sur {fmtSize(wifi.total)}
        </p>
      </div>
    );
  }
  const asking = wifi.step === 'request';
  return (
    <div className="sh-wifi" data-testid="share-waiting">
      <Bridge state={asking ? 'ask' : 'wait'} right={asking ? wifi.device : 'L’autre ordinateur'} rightFace={asking ? { letter: wifi.device.charAt(0).toUpperCase(), color: 'var(--primary)' } : null} />
      <BigCode code={wifi.code} testid="share-code" />
      <p className="sh-left">
        <Clock size={12} /> Valable encore {mmss}
      </p>
      {asking ? (
        <div className="sh-ask" role="alertdialog" aria-label="Demande de réception" data-testid="share-request">
          <span className="sh-ask-face" aria-hidden="true">{wifi.device.charAt(0).toUpperCase()}</span>
          <p>
            <strong>{wifi.device}</strong> demande à recevoir « {title} ».
          </p>
          <div className="sh-ask-actions">
            <button className="btn" onClick={() => onAnswer(false)} data-testid="share-reject">Refuser</button>
            <button className="btn btn-primary" onClick={() => onAnswer(true)} data-testid="share-accept">Accepter</button>
          </div>
        </div>
      ) : (
        <>
          <Steps
            items={[
              { icon: <Upload size={18} />, label: 'Importer' },
              { icon: <Laptop size={18} />, label: 'Depuis un autre Marginalia' },
              { icon: <Hash size={18} />, label: <>Saisir <strong>{wifi.code.slice(0, 3)}-{wifi.code.slice(3)}</strong></> },
            ]}
          />
          <span className="sr-only" aria-live="polite" data-testid="share-status">En attente…</span>
        </>
      )}
      {wifi.step === 'waiting' && wifi.note && <p className="sh-note" role="status">{wifi.note}</p>}
      <Trouble address={wifi.addresses[0]} />
    </div>
  );
}
