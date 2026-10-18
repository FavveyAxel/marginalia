// Fenêtre « Recevoir depuis le téléphone » : ouvre la réception par le Wi-Fi (serveur local de
// l'app, voir electron/wifi.cjs), affiche le QR code à scanner et ce qui arrive. Fermer la fenêtre
// ferme la réception.
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import qrcode from 'qrcode-generator';
import { BookOpen, Check, FilePen, FileText, Image as ImageIcon, Lock, Smartphone, WifiOff, X } from 'lucide-react';
import { host, type WifiEvent, type WifiInfo } from '../../lib/platform';

type Received = Extract<WifiEvent, { type: 'received' }>;

/** QR code en SVG (modules sombres sur fond clair, toujours : les lecteurs l'exigent). */
function QrSvg({ text, size = 208 }: { text: string; size?: number }) {
  const { d, n } = useMemo(() => {
    const qr = qrcode(0, 'M');
    qr.addData(text, 'Byte');
    qr.make();
    const count = qr.getModuleCount();
    let path = '';
    for (let r = 0; r < count; r++) for (let c = 0; c < count; c++) if (qr.isDark(r, c)) path += `M${c} ${r}h1v1h-1z`;
    return { d: path, n: count };
  }, [text]);
  const q = 3; // marge blanche (zone calme)
  return (
    <svg className="wr-qr" width={size} height={size} viewBox={`${-q} ${-q} ${n + 2 * q} ${n + 2 * q}`} role="img" aria-label="QR code à scanner avec le téléphone" shapeRendering="crispEdges">
      <rect x={-q} y={-q} width={n + 2 * q} height={n + 2 * q} fill="#fff" />
      <path d={d} fill="#000" />
    </svg>
  );
}

function KindIcon({ kind }: { kind: Received['kind'] }) {
  const p = { size: 14, strokeWidth: 1.8 };
  return kind === 'book' ? <BookOpen {...p} /> : kind === 'image' ? <ImageIcon {...p} /> : kind === 'draft' ? <FilePen {...p} /> : <FileText {...p} />;
}

const KIND_DONE: Record<Received['kind'], string> = {
  book: 'livre, ajouté à la bibliothèque',
  image: 'photo, texte en cours de lecture',
  draft: 'document Word',
  text: 'texte, passage recherché dans vos livres',
};

export function WifiReceive({ onClose }: { onClose: () => void }) {
  const api = host.inbox;
  const [info, setInfo] = useState<WifiInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pick, setPick] = useState(0);
  const [device, setDevice] = useState<string | null>(null);
  const [got, setGot] = useState<Received[]>([]);
  const [stopped, setStopped] = useState<string | null>(null);
  const closeBtn = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!api?.wifiStart) return;
    let alive = true;
    const off = api.onWifi?.((e) => {
      if (!alive) return;
      if (e.type === 'device') setDevice(e.device);
      else if (e.type === 'received') {
        setDevice((d) => d ?? e.device);
        setGot((g) => [e, ...g].slice(0, 30));
      } else if (e.type === 'stopped' && e.reason !== 'closed') {
        setStopped(e.reason === 'idle' ? 'La réception s’est fermée après 15 minutes sans envoi.' : 'La réception s’est fermée.');
      }
    });
    api
      .wifiStart()
      .then((i) => alive && setInfo(i))
      .catch((e) => alive && setError(String((e as Error)?.message ?? e)));
    return () => {
      alive = false;
      off?.();
      void api.wifiStop?.();
    };
  }, [api]);

  const reopen = () => {
    setStopped(null);
    setInfo(null);
    void api?.wifiStart?.().then(setInfo, (e) => setError(String((e as Error)?.message ?? e)));
  };

  useEffect(() => {
    closeBtn.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  const urls = info?.urls ?? [];
  const cur = urls[Math.min(pick, urls.length - 1)];
  const short = cur ? cur.url.replace(/^http:\/\//, '').replace(/\/r\/.*$/, '') : '';
  const isWin = host.platform === 'win32';

  let body: JSX.Element;
  if (error) {
    body = (
      <div className="wr-problem" role="alert">
        <WifiOff size={22} strokeWidth={1.6} />
        <p>{error}</p>
      </div>
    );
  } else if (stopped) {
    body = (
      <div className="wr-problem">
        <Lock size={22} strokeWidth={1.6} />
        <p>{stopped}</p>
        <button className="btn btn-primary" onClick={reopen}>
          Rouvrir la réception
        </button>
      </div>
    );
  } else if (!info) {
    body = <p className="wr-wait">Ouverture de la réception…</p>;
  } else if (!cur) {
    body = (
      <div className="wr-problem" role="alert">
        <WifiOff size={22} strokeWidth={1.6} />
        <p>
          Cet ordinateur n’est connecté à aucun réseau local. Connectez-le au même Wi-Fi que votre téléphone, puis rouvrez cette fenêtre.
        </p>
      </div>
    );
  } else {
    body = (
      <div className="wr-main">
        <div className="wr-code">
          <QrSvg text={cur.url} />
          <span className="wr-addr" title={cur.url}>
            {short}
          </span>
          {urls.length > 1 && (
            <label className="wr-net">
              <span>Réseau</span>
              <select value={pick} onChange={(e) => setPick(Number(e.target.value))}>
                {urls.map((u, i) => (
                  <option key={u.url} value={i}>
                    {u.iface} · {u.address}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
        <div className="wr-side">
          <ol className="wr-steps">
            <li>
              Ouvrez l’<strong>appareil photo</strong> du téléphone et visez le code.
            </li>
            <li>
              Touchez le <strong>lien</strong> qui apparaît.
            </li>
            <li>
              Prenez une <strong>photo</strong> d’une page, choisissez un <strong>fichier</strong> ou collez du <strong>texte</strong>.
            </li>
          </ol>
          <p className="wr-same">Le téléphone doit être sur le même Wi-Fi que cet ordinateur. iPhone et Android.</p>
          <div className={`wr-status ${device ? 'is-on' : ''}`} aria-live="polite">
            {device ? (
              <>
                <Smartphone size={14} /> {device} connecté
              </>
            ) : (
              <>
                <span className="wr-pulse" aria-hidden="true" /> En attente du téléphone…
              </>
            )}
          </div>
          {got.length > 0 && (
            <ul className="wr-got" aria-label="Reçu">
              {got.map((g) => (
                <li key={g.name + g.at}>
                  <span className="wr-got-icon">
                    <KindIcon kind={g.kind} />
                  </span>
                  <span className="wr-got-name" title={g.name}>
                    {g.name}
                  </span>
                  <span className="wr-got-kind">
                    <Check size={12} /> {KIND_DONE[g.kind]}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    );
  }

  return createPortal(
    <div className="wr-back anim-fade" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="wr-dialog panel anim-scale" role="dialog" aria-modal="true" aria-labelledby="wr-title" data-testid="wifi-receive">
        <header className="wr-head">
          <h2 id="wr-title">Recevoir depuis le téléphone</h2>
          <button ref={closeBtn} className="icon-btn sm" onClick={onClose} aria-label="Fermer et arrêter la réception" title="Fermer (la réception s’arrête)">
            <X size={16} />
          </button>
        </header>
        {body}
        <footer className="wr-foot">
          <Lock size={13} />
          <span>
            Rien ne passe par Internet : le téléphone envoie directement à cet ordinateur. La réception s’arrête quand vous fermez cette fenêtre.
            {isWin && ' Si Windows demande d’autoriser Marginalia, acceptez pour les réseaux privés.'}
          </span>
        </footer>
      </div>
    </div>,
    document.body,
  );
}

