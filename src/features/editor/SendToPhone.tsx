// Fenêtre « Envoyer sur le téléphone » : l'écrit exporté (PDF ou Word) est proposé au téléchargement
// par QR code, sur le réseau local (chemin inverse de la réception). Fermer la fenêtre arrête l'envoi.
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, Lock, Smartphone, WifiOff, X } from 'lucide-react';
import { host, type WifiInfo } from '../../lib/platform';
import { QrSvg } from '../inbox/WifiReceive';
import '../inbox/inbox.css';

const LABEL = { pdf: 'PDF', docx: 'Document Word' } as const;

export function SendToPhone({ file, onClose }: { file: { name: string; kind: 'pdf' | 'docx'; data: ArrayBuffer }; onClose: () => void }) {
  const api = host.sendToPhone;
  const [info, setInfo] = useState<(WifiInfo & { path?: string }) | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [device, setDevice] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [stopped, setStopped] = useState(false);
  const [pick, setPick] = useState(0);
  const closeBtn = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!api) return;
    let alive = true;
    const off = api.onEvent((e) => {
      if (!alive) return;
      if (e.type === 'device') setDevice(e.device);
      else if (e.type === 'downloaded') {
        setDevice((d) => d ?? e.device);
        setDone(e.device);
      } else if (e.type === 'stopped' && e.reason !== 'closed') setStopped(true);
    });
    api
      .start([{ name: file.name, kind: file.kind, label: LABEL[file.kind], data: file.data }])
      .then((i) => alive && setInfo(i))
      .catch((e) => alive && setError(String((e as Error)?.message ?? e)));
    return () => {
      alive = false;
      off();
      void api.stop();
    };
  }, [api, file]);

  useEffect(() => {
    closeBtn.current?.focus();
    const k = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', k, true);
    return () => window.removeEventListener('keydown', k, true);
  }, [onClose]);

  const urls = info?.urls ?? [];
  const cur = urls[Math.min(pick, urls.length - 1)];
  const size = file.data.byteLength < 1048576 ? `${Math.max(1, Math.round(file.data.byteLength / 1024))} Ko` : `${(file.data.byteLength / 1048576).toFixed(1).replace('.', ',')} Mo`;

  let body: JSX.Element;
  if (error || stopped) {
    body = (
      <div className="wr-problem" role="alert">
        {error ? <WifiOff size={22} strokeWidth={1.6} /> : <Lock size={22} strokeWidth={1.6} />}
        <p>{error ?? 'L’envoi s’est fermé après 15 minutes sans téléchargement. Rouvrez-le depuis « Exporter ».'}</p>
      </div>
    );
  } else if (!info) {
    body = <p className="wr-wait">Préparation de l’envoi…</p>;
  } else if (!cur) {
    body = (
      <div className="wr-problem" role="alert">
        <WifiOff size={22} strokeWidth={1.6} />
        <p>Cet ordinateur n’est connecté à aucun réseau local. Connectez-le au même Wi-Fi que votre téléphone, puis réessayez.</p>
      </div>
    );
  } else {
    body = (
      <div className="wr-main">
        <div className="wr-code">
          <QrSvg text={cur.url} />
          <span className="wr-addr" title={cur.url}>
            {cur.url.replace(/^http:\/\//, '').replace(/\/s\/.*$/, '')}
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
          <div className="stp-file">
            <span className="stp-ico">{file.kind === 'pdf' ? 'PDF' : 'W'}</span>
            <span>
              <strong>
                {file.name}.{file.kind}
              </strong>
              <span>
                {LABEL[file.kind]} · {size}
              </span>
            </span>
          </div>
          <ol className="wr-steps">
            <li>
              Ouvrez l’<strong>appareil photo</strong> du téléphone et visez le code.
            </li>
            <li>
              Touchez le <strong>lien</strong>, puis <strong>Télécharger</strong>.
            </li>
            <li>Sur iPhone, le document arrive dans Fichiers › Téléchargements ; sur Android, dans Téléchargements.</li>
          </ol>
          <div className={`wr-status ${device ? 'is-on' : ''}`} aria-live="polite">
            {done ? (
              <>
                <Check size={14} /> Téléchargé sur {done === 'Appareil' ? 'l’appareil' : done.startsWith('Tél') || done.startsWith('Tab') ? `le ${done.charAt(0).toLowerCase()}${done.slice(1)}` : `l’${done}`}
              </>
            ) : device ? (
              <>
                <Smartphone size={14} /> {device} connecté
              </>
            ) : (
              <>
                <span className="wr-pulse" aria-hidden="true" /> En attente du téléphone…
              </>
            )}
          </div>
        </div>
      </div>
    );
  }

  return createPortal(
    <div className="wr-back anim-fade" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="wr-dialog panel anim-scale" role="dialog" aria-modal="true" aria-labelledby="stp-title" data-testid="send-to-phone" data-port={info?.port} data-path={info?.path}>
        <header className="wr-head">
          <h2 id="stp-title">Envoyer sur le téléphone</h2>
          <button ref={closeBtn} className="icon-btn sm" onClick={onClose} aria-label="Fermer et arrêter l’envoi" title="Fermer (l’envoi s’arrête)">
            <X size={16} />
          </button>
        </header>
        {body}
        <footer className="wr-foot">
          <Lock size={13} />
          <span>
            Rien ne passe par Internet : le téléphone télécharge directement depuis cet ordinateur, chiffré avec la clé contenue dans le QR code. L’envoi s’arrête quand vous fermez cette fenêtre.
            {host.platform === 'win32' && ' Si Windows demande d’autoriser Marginalia, acceptez pour les réseaux privés.'}
          </span>
        </footer>
      </div>
    </div>,
    document.body,
  );
}
