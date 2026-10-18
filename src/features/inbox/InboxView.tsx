// Vue « Boîte de réception » : ce qui arrive du téléphone par la Boîte de dépôt et attend une décision.
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  BookOpen,
  ChevronLeft,
  Check,
  CloudDownload,
  FilePen,
  FileQuestion,
  FileText,
  FolderOpen,
  FolderSync,
  Globe,
  Highlighter,
  Image as ImageIcon,
  Inbox,
  Link2,
  QrCode,
  RotateCw,
  ScanText,
  Search,
  Smartphone,
  X,
} from 'lucide-react';
import { useStore } from '../../lib/store';
import { host } from '../../lib/platform';
import type { PassageMatch } from './match';
import {
  addExtract,
  addToLibrary,
  baseName,
  dismissItem,
  makeDraft,
  prettyDir,
  readPhotoText,
  researchItem,
  retryItem,
  revealInbox,
  setInboxEnabled,
  setItemText,
  useInbox,
  openWifiReceive,
  wifiAvailable,
  type InboxItem,
  type InboxKind,
} from './inbox';
import { WifiReceive } from './WifiReceive';
import './inbox.css';

const KIND_LABEL: Record<InboxKind, string> = {
  book: 'Livre',
  text: 'Texte',
  image: 'Photo',
  web: 'Page web',
  link: 'Lien',
  draft: 'Document Word',
  other: 'Fichier',
};

function KindIcon({ kind }: { kind: InboxKind }) {
  const p = { size: 16, strokeWidth: 1.8 };
  switch (kind) {
    case 'book':
      return <BookOpen {...p} />;
    case 'text':
      return <FileText {...p} />;
    case 'image':
      return <ImageIcon {...p} />;
    case 'web':
      return <Globe {...p} />;
    case 'link':
      return <Link2 {...p} />;
    case 'draft':
      return <FilePen {...p} />;
    default:
      return <FileQuestion {...p} />;
  }
}

/** « à l'instant », « il y a 5 min », « hier à 14:02 », « le 3 oct. ». */
function when(ts: number, now = Date.now()): string {
  const d = now - ts;
  if (d < 60_000) return 'à l’instant';
  if (d < 3_600_000) return `il y a ${Math.round(d / 60_000)} min`;
  const date = new Date(ts);
  const time = date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  const day = (t: number) => new Date(t).toDateString();
  if (day(ts) === day(now)) return `aujourd’hui à ${time}`;
  if (day(ts) === day(now - 86_400_000)) return `hier à ${time}`;
  return `le ${date.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}`;
}

export function InboxView() {
  const on = useStore((s) => !!s.settings.inbox);
  const info = useInbox((s) => s.info);
  const items = useInbox((s) => s.items);
  const scannedAt = useInbox((s) => s.scannedAt);
  const wifiOpen = useInbox((s) => s.wifiOpen);
  const available = !!host.inbox;
  const wifi = wifiAvailable();
  const closeWifi = () => useInbox.setState({ wifiOpen: false });
  // Quitter la vue ferme aussi la réception.
  useEffect(() => () => useInbox.setState({ wifiOpen: false }), []);
  const syncName = host.platform === 'darwin' ? 'iCloud Drive' : 'votre dossier synchronisé (OneDrive…)';

  return (
    <>
      <header className="topbar">
        <button className="btn btn-sm btn-ghost ib-back" onClick={() => useStore.getState().navigate({ name: 'library' })}>
          <ChevronLeft size={15} /> Bibliothèque
        </button>
        <span className="spacer" />
        {on && info && (
          <button className="btn btn-sm" onClick={() => void revealInbox()} title="Ouvrir le dossier dans le Finder ou l’Explorateur">
            <FolderOpen size={14} /> Ouvrir le dossier
          </button>
        )}
        {wifi && (
          <button className="btn btn-sm btn-primary" onClick={openWifiReceive} data-testid="wifi-open">
            <QrCode size={14} /> Recevoir depuis le téléphone
          </button>
        )}
      </header>
      <div className="ib-scroll">
        <div className="ib-page anim-view">
          <div className="ib-head">
            <h1 className="page-title">Boîte de réception</h1>
            <p className="ib-lede">
              Ce que vous envoyez depuis votre téléphone arrive ici. Les livres (PDF, EPUB) vont directement dans la bibliothèque ; un passage retrouvé dans un de vos livres devient un extrait. Le reste attend votre décision.
            </p>
            {on && info && (
              <p className="ib-folder">
                <Smartphone size={14} /> Dossier surveillé : <strong>{prettyDir(info.dir)}</strong>
              </p>
            )}
          </div>

          {!available ? (
            <div className="ib-empty">
              <Inbox size={28} strokeWidth={1.5} />
              <h3>Disponible dans l’app de bureau</h3>
              <p>La Boîte de réception reçoit ce que vous envoyez depuis le téléphone, par le Wi-Fi ou un dossier synchronisé.</p>
            </div>
          ) : items.length > 0 ? (
            <ul className="ib-list" aria-label="Éléments reçus">
              {items.map((it) => (
                <ItemCard key={it.name} it={it} />
              ))}
            </ul>
          ) : on ? (
            <div className="ib-empty">
              <Check size={28} strokeWidth={1.5} />
              <h3>{scannedAt ? 'Rien en attente' : 'Lecture du dossier…'}</h3>
              <HowTo cloud={info?.cloud ?? null} />
              {wifi && (
                <button className="btn" onClick={openWifiReceive}>
                  <QrCode size={14} /> Ou envoyer par le Wi-Fi
                </button>
              )}
            </div>
          ) : (
            <div className="ib-ways">
              {wifi && (
                <section className="ib-way is-main">
                  <QrCode size={24} strokeWidth={1.5} />
                  <h3>Par le Wi-Fi</h3>
                  <p>
                    Scannez un code avec le téléphone : photos de pages, livres, documents et passages copiés arrivent ici aussitôt. Sans compte, sans rien installer,
                    et rien ne passe par Internet. iPhone et Android.
                  </p>
                  <button className="btn btn-primary" onClick={openWifiReceive}>
                    Recevoir depuis le téléphone
                  </button>
                </section>
              )}
              <section className="ib-way">
                <FolderSync size={24} strokeWidth={1.5} />
                <h3>Par un dossier synchronisé</h3>
                <p>Marginalia surveille un dossier « Marginalia » dans {syncName}. Ce que vous y déposez depuis le téléphone arrive ici, même quand l’ordinateur était éteint.</p>
                <button className="btn" onClick={() => void setInboxEnabled(true)}>
                  Activer le dossier
                </button>
              </section>
            </div>
          )}
          {on && items.length > 0 && (
            <details className="ib-howto-more">
              <summary>Comment envoyer depuis le téléphone ?</summary>
              <HowTo cloud={info?.cloud ?? null} />
            </details>
          )}
        </div>
      </div>
      {wifiOpen && wifi && <WifiReceive onClose={closeWifi} />}
    </>
  );
}

function HowTo({ cloud }: { cloud: 'icloud' | 'onedrive' | null }) {
  return (
    <ol className="ib-howto">
      {cloud === 'onedrive' ? (
        <li>
          Dans l’app OneDrive du téléphone, déposez le fichier dans le dossier <strong>Marginalia</strong>.
        </li>
      ) : (
        <li>
          Sur l’iPhone, touchez <strong>Partager</strong> › <strong>Enregistrer dans Fichiers</strong> › <strong>iCloud Drive</strong> › <strong>Marginalia</strong>.
        </li>
      )}
      <li>Un PDF ou un EPUB rejoint la bibliothèque ; un texte copié dans un livre devient un extrait.</li>
      <li>Une photo de page : Marginalia lit le texte et retrouve le livre et la page.</li>
    </ol>
  );
}

function ItemCard({ it }: { it: InboxItem }) {
  const busy = it.status === 'working' || it.status === 'waiting';
  const title = it.kind === 'web' || it.kind === 'link' ? it.title ?? baseName(it.name) : baseName(it.name);
  return (
    <li className={`ib-card is-${it.kind} ${busy ? 'is-busy' : ''}`} data-name={it.name}>
      <div className="ib-card-head">
        <span className="ib-icon" aria-hidden="true">
          <KindIcon kind={it.kind} />
        </span>
        <div className="ib-card-title">
          <span className="ib-title" title={it.name}>
            {title}
          </span>
          <span className="ib-meta">
            {KIND_LABEL[it.kind]} · reçu {it.source === 'wifi' ? 'par le Wi-Fi ' : ''}{when(it.mtime)}
          </span>
        </div>
        <button className="icon-btn sm ib-dismiss" title={it.source === 'wifi' ? 'Retirer de la boîte' : 'Retirer de la boîte (le fichier est rangé dans « Traités »)'} aria-label={`Retirer « ${title} » de la boîte`} onClick={() => void dismissItem(it.name)} disabled={it.status === 'working'}>
          <X size={15} />
        </button>
      </div>

      {it.pending ? (
        <p className="ib-step">
          <CloudDownload size={14} /> Téléchargement depuis le nuage…
        </p>
      ) : it.status === 'error' ? (
        <div className="ib-error">
          <p>{it.error || 'Lecture impossible.'}</p>
          <div className="ib-actions">
            <button className="btn btn-sm" onClick={() => retryItem(it.name)}>
              <RotateCw size={14} /> Réessayer
            </button>
          </div>
        </div>
      ) : it.kind === 'text' || it.kind === 'image' ? (
        <PassageBody it={it} />
      ) : (
        <SimpleBody it={it} />
      )}
    </li>
  );
}

function Step({ it }: { it: InboxItem }) {
  if (!it.step) return null;
  return (
    <p className="ib-step" role="status">
      <span className="ib-spinner" aria-hidden="true" /> {it.step}
      {it.progress != null && <span className="ib-pct">{Math.round(it.progress * 100)} %</span>}
    </p>
  );
}

function SimpleBody({ it }: { it: InboxItem }) {
  if (it.status !== 'ready') return <Step it={it} />;
  switch (it.kind) {
    case 'web':
      return (
        <div className="ib-actions">
          <button className="btn btn-sm btn-primary" onClick={() => void addToLibrary(it.name)}>
            <BookOpen size={14} /> Ajouter à la bibliothèque
          </button>
        </div>
      );
    case 'link':
      return (
        <>
          <p className="ib-url">{it.url}</p>
          <div className="ib-actions">
            <a className="btn btn-sm btn-primary" href={it.url} target="_blank" rel="noreferrer noopener">
              <Globe size={14} /> Ouvrir le lien
            </a>
          </div>
        </>
      );
    case 'draft':
      return (
        <div className="ib-actions">
          <button className="btn btn-sm btn-primary" onClick={() => void makeDraft(it.name)}>
            <FilePen size={14} /> Ajouter à mes écrits
          </button>
        </div>
      );
    case 'book':
      return <Step it={it} />;
    default:
      return <p className="ib-note">Marginalia ne sait pas ouvrir ce type de fichier. Retirez-le de la boîte, ou ouvrez le dossier pour le récupérer.</p>;
  }
}

function PassageBody({ it }: { it: InboxItem }) {
  const books = useStore((s) => s.books);
  const [pick, setPick] = useState('');
  const text = it.text ?? '';
  const edited = it.status === 'ready' && text.trim() !== (it.searchedText ?? '').trim();
  const area = useRef<HTMLTextAreaElement>(null);
  // Hauteur ajustée au texte (bornée par le CSS).
  useEffect(() => {
    const el = area.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight + 2}px`;
  }, [text]);
  const sorted = useMemo(() => [...books].sort((a, b) => a.title.localeCompare(b.title, 'fr')), [books]);
  const scope = it.searchedIn ? books.find((b) => b.id === it.searchedIn)?.title : null;
  const ready = it.status === 'ready';

  return (
    <div className={`ib-passage ${it.preview ? 'has-photo' : ''}`}>
      {it.preview && (
        <a className="ib-photo" href={it.preview} target="_blank" rel="noreferrer" title="Voir la photo en grand">
          <img src={it.preview} alt="" />
        </a>
      )}
      <div className="ib-passage-main">
        {it.text !== undefined && (
          <label className="ib-text-label">
            <span>{it.kind === 'image' ? 'Texte lu sur la photo' : 'Texte reçu'} — vous pouvez le raccourcir ou le corriger</span>
            <textarea ref={area} className="input ib-text" value={text} spellCheck={false} onChange={(e) => setItemText(it.name, e.target.value)} disabled={!ready} />
          </label>
        )}
        {!ready ? (
          <Step it={it} />
        ) : it.kind === 'image' && it.text === undefined ? (
          <>
            <p className="ib-note">Photo reçue. Lisez son texte pour retrouver le passage dans vos livres, ou ajoutez-la telle quelle à la bibliothèque.</p>
            <div className="ib-actions">
              <button className="btn btn-sm btn-primary" onClick={() => void readPhotoText(it.name)} data-testid="ib-read-photo">
                <ScanText size={14} /> Lire le texte de la photo
              </button>
              <button className="btn btn-sm" onClick={() => void addToLibrary(it.name)} title="La photo devient un document de la bibliothèque, où vous pouvez surligner">
                <ImageIcon size={14} /> Ajouter la photo à la bibliothèque
              </button>
            </div>
          </>
        ) : (
          <>
            {edited && (
              <div className="ib-actions">
                <button className="btn btn-sm" onClick={() => void researchItem(it.name, text, null)}>
                  <Search size={14} /> Chercher ce texte
                </button>
              </div>
            )}
            {!edited && <Matches it={it} scope={scope ?? null} />}
            <div className="ib-actions ib-actions-foot">
              <label className="ib-pick">
                <span className="sr-only">Chercher dans un livre</span>
                <select
                  className="input"
                  value={pick}
                  onChange={(e) => {
                    const id = e.target.value;
                    setPick('');
                    if (id) void researchItem(it.name, text, id === '*' ? null : id);
                  }}
                  disabled={!text.trim() || !books.length}
                >
                  <option value="">Chercher dans un livre…</option>
                  {it.searchedIn && <option value="*">Toute la bibliothèque</option>}
                  {sorted.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.title}
                      {b.author ? ` — ${b.author}` : ''}
                    </option>
                  ))}
                </select>
              </label>
              <span className="spacer" />
              {text.trim() && (
                <button className="btn btn-sm" onClick={() => void makeDraft(it.name)} title="Nouvel écrit contenant ce texte">
                  <FilePen size={14} /> Créer un écrit
                </button>
              )}
              {it.kind === 'image' && (
                <button className="btn btn-sm" onClick={() => void addToLibrary(it.name)} title="La photo devient un document de la bibliothèque, où vous pouvez surligner">
                  <ImageIcon size={14} /> Ajouter la photo à la bibliothèque
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Matches({ it, scope }: { it: InboxItem; scope: string | null }) {
  const books = useStore((s) => s.books);
  const matches = it.matches ?? [];
  if (!(it.searchedText ?? '').trim()) return <p className="ib-note">{it.kind === 'image' ? 'Aucun texte lisible sur cette photo.' : 'Ce fichier est vide.'}</p>;
  if (!matches.length)
    return (
      <p className="ib-note">
        {scope ? `Passage introuvable dans « ${scope} ».` : books.length ? 'Passage introuvable dans la bibliothèque.' : 'Votre bibliothèque est vide : aucun livre où chercher ce passage.'}{' '}
        {it.kind === 'image' && books.length > 0 && 'Gardez seulement le passage qui vous intéresse dans le texte ci-dessus, ou ajoutez la photo à la bibliothèque.'}
      </p>
    );
  return (
    <div className="ib-matches">
      <span className="ib-matches-title">{matches.length > 1 ? 'Passage retrouvé dans plusieurs livres' : 'Passage retrouvé'}</span>
      {matches.map((m) => (
        <MatchRow key={m.bookId} name={it.name} m={m} />
      ))}
    </div>
  );
}

function MatchRow({ name, m }: { name: string; m: PassageMatch }) {
  const book = useStore((s) => s.books.find((b) => b.id === m.bookId));
  if (!book) return null;
  const where = [m.printedPage ? `p. ${m.printedPage}` : '', m.locationLabel && !(m.printedPage && /^p\.\s/.test(m.locationLabel)) ? m.locationLabel : ''].filter(Boolean).join(' · ');
  const sure = m.score >= 0.8;
  return (
    <div className="ib-match">
      <div className="ib-match-body">
        <span className="ib-match-book">
          <strong>{book.title}</strong>
          {book.author && <span> — {book.author}</span>}
        </span>
        {where && <span className="ib-match-where">{where}</span>}
        <blockquote className="ib-match-quote">{m.text}</blockquote>
        {!sure && <span className="ib-match-hint">Correspondance partielle : vérifiez le passage avant de l’ajouter.</span>}
      </div>
      <button className="btn btn-sm btn-primary ib-match-add" onClick={() => void addExtract(name, m)}>
        <Highlighter size={14} /> Ajouter comme extrait
      </button>
    </div>
  );
}
