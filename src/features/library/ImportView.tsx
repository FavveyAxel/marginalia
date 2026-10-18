// Page « Importer » : glisser-déposer (fichiers et dossiers), choisir des fichiers ou un dossier sur
// l'ordinateur, recevoir depuis le téléphone (QR code, Wi-Fi), dossier synchronisé, app Livres (Mac).
// ⌘O / Ctrl+O garde l'ouverture directe du sélecteur de fichiers.
import { useState, type DragEvent } from 'react';
import { BookOpen, Check, FileUp, FolderOpen, FolderSync, Inbox, QrCode, Upload } from 'lucide-react';
import { useStore } from '../../lib/store';
import { filesFromDataTransfer, host, type PickedFile } from '../../lib/platform';
import { fmtKeys } from '../../lib/keys';
import { openWifiReceive, prettyDir, setInboxEnabled, useInbox, useInboxCount, wifiAvailable } from '../inbox/inbox';
import './import.css';

interface Result {
  books: number;
  drafts: number;
  skipped: number;
  truncated: boolean;
  folder?: string;
}

/** Ouvre la fenêtre de l'app Livres (bibliothèque). */
export const OPEN_APPLE_BOOKS = 'mg:open-apple-books';

export function ImportView({ workspaceId, groupId = null }: { workspaceId?: string; groupId?: string | null }) {
  const ws = useStore((s) => (workspaceId ? s.workspaces.find((w) => w.id === workspaceId) : null));
  const group = useStore((s) => (groupId ? s.groups.find((g) => g.id === groupId) : null));
  const inboxOn = useStore((s) => !!s.settings.inbox);
  const info = useInbox((s) => s.info);
  const waiting = useInboxCount();
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const mac = host.platform === 'darwin';

  async function importAll(files: PickedFile[], extra: { skipped?: number; truncated?: boolean; folder?: string } = {}) {
    setResult(null);
    if (!files.length) {
      useStore.getState().toast(extra.folder ? `Aucun document compatible dans « ${extra.folder} »` : 'Format non pris en charge', 'error');
      return;
    }
    setBusy(true);
    const st = useStore.getState();
    const nDrafts0 = st.drafts.length;
    try {
      const books = await st.importFiles(files);
      const drafts = Math.max(0, useStore.getState().drafts.length - nDrafts0);
      if (books.length === 1 && !drafts && files.length === 1) {
        useStore.getState().openBook(books[0].id);
        return;
      }
      setResult({ books: books.length, drafts, skipped: extra.skipped ?? 0, truncated: !!extra.truncated, folder: extra.folder });
    } finally {
      setBusy(false);
    }
  }

  const pickFiles = async () => importAll(await host.pickFiles());
  const pickFolder = async () => {
    const r = await host.pickFolder?.();
    if (r) await importAll(r.files, { skipped: r.skipped, truncated: r.truncated, folder: r.folder });
  };

  const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes('Files');
  const onDrop = async (e: DragEvent) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    e.stopPropagation(); // la zone de dépôt de toute la fenêtre ne s'en occupe pas
    setOver(false);
    const { files, skipped, folders } = await filesFromDataTransfer(e.dataTransfer);
    await importAll(files, { skipped, folder: folders === 1 ? 'ce dossier' : undefined });
  };

  const total = result ? result.books + result.drafts : 0;

  return (
    <>
      <header className="topbar">
        <span className="spacer" />
      </header>
      <div className="imp-scroll">
        <div className="imp-page anim-view">
          <div className="imp-head">
            <h1 className="page-title">Importer</h1>
            <p className="imp-lede">
              Livres, documents et photos de pages. Les livres (EPUB, PDF, photos) rejoignent la bibliothèque ; les documents Word et Markdown deviennent des
              écrits.{ws ? (
                <>
                  {' '}
                  Tout sera rangé dans l’espace <strong>« {ws.name} »</strong>
                  {group ? <>, groupe <strong>« {group.name} »</strong></> : null}.
                </>
              ) : null}
            </p>
          </div>

          <section
            className={`imp-drop ${over ? 'is-over' : ''} ${busy ? 'is-busy' : ''}`}
            data-testid="import-drop"
            onDragEnter={(e) => hasFiles(e) && (e.preventDefault(), e.stopPropagation(), setOver(true))}
            onDragOver={(e) => hasFiles(e) && (e.preventDefault(), e.stopPropagation())}
            onDragLeave={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver(false);
            }}
            onDrop={(e) => void onDrop(e)}
          >
            <span className="imp-drop-icon" aria-hidden="true">
              <Upload size={26} strokeWidth={1.6} />
            </span>
            <h2>{busy ? 'Import en cours…' : over ? 'Déposez pour importer' : 'Glissez ici des fichiers ou un dossier'}</h2>
            <p>Un dossier est importé avec tout son contenu compatible, sous-dossiers compris.</p>
            <div className="imp-drop-actions">
              <button className="btn btn-primary" onClick={() => void pickFiles()} disabled={busy} title={fmtKeys('Choisir des fichiers (⌘O)')}>
                <FileUp size={15} /> Choisir des fichiers…
              </button>
              {host.pickFolder && (
                <button className="btn" onClick={() => void pickFolder()} disabled={busy}>
                  <FolderOpen size={15} /> Choisir un dossier…
                </button>
              )}
            </div>
            <p className="imp-formats">EPUB · PDF · Word · Markdown · Texte · HTML · Photos (JPG, PNG, HEIC…)</p>
          </section>

          {result && (
            <div className="imp-result" role="status" data-testid="import-result">
              <Check size={16} />
              <div>
                <strong>
                  {total
                    ? `${total} document${total > 1 ? 's' : ''} importé${total > 1 ? 's' : ''}${result.folder && result.folder !== 'ce dossier' ? ` depuis « ${result.folder} »` : ''}`
                    : 'Rien de nouveau à importer'}
                </strong>
                <span>
                  {[
                    result.books ? `${result.books} dans la bibliothèque` : '',
                    result.drafts ? `${result.drafts} écrit${result.drafts > 1 ? 's' : ''}` : '',
                    result.skipped ? `${result.skipped} fichier${result.skipped > 1 ? 's' : ''} d’un autre format ignoré${result.skipped > 1 ? 's' : ''}` : '',
                    result.truncated ? 'dossier très volumineux : les 300 premiers documents' : '',
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
              </div>
              <span className="spacer" />
              {result.books > 0 && (
                <button className="btn btn-sm" onClick={() => useStore.getState().navigate(ws ? { name: 'workspace', workspaceId: ws.id, groupId: groupId ?? null } : { name: 'library' })}>
                  {ws ? 'Voir l’espace' : 'Voir la bibliothèque'}
                </button>
              )}
              {result.drafts > 0 && !result.books && !ws && (
                <button className="btn btn-sm" onClick={() => useStore.getState().navigate({ name: 'write', draftId: null })}>
                  Voir les écrits
                </button>
              )}
            </div>
          )}

          <h2 className="imp-sub">Depuis le téléphone ou une autre app</h2>
          <div className="imp-ways">
            {wifiAvailable() && (
              <section className="imp-way">
                <QrCode size={22} strokeWidth={1.6} />
                <h3>Depuis le téléphone, par QR code</h3>
                <p>Scannez un code avec l’iPhone ou le téléphone Android : photos de pages, livres, documents et notes copiées arrivent aussitôt, par le Wi-Fi.</p>
                <button className="btn" onClick={openWifiReceive}>
                  Afficher le QR code
                </button>
              </section>
            )}
            <section className="imp-way">
              <FolderSync size={22} strokeWidth={1.6} />
              <h3>Par un dossier synchronisé</h3>
              {inboxOn && info ? (
                <p>
                  Marginalia surveille <strong>{prettyDir(info.dir)}</strong> : ce que vous y déposez depuis le téléphone arrive dans la Boîte de réception.
                </p>
              ) : (
                <p>Un dossier « Marginalia » dans {mac ? 'iCloud Drive' : 'OneDrive'}, surveillé : ce que vous y déposez depuis le téléphone arrive tout seul.</p>
              )}
              {inboxOn ? (
                <button className="btn" onClick={() => useStore.getState().navigate({ name: 'inbox' })}>
                  <Inbox size={14} /> Ouvrir la Boîte{waiting ? ` (${waiting})` : ''}
                </button>
              ) : (
                <button className="btn" onClick={() => void setInboxEnabled(true)}>
                  Activer le dossier
                </button>
              )}
            </section>
            {host.appleBooksScan && (
              <section className="imp-way">
                <BookOpen size={22} strokeWidth={1.6} />
                <h3>Depuis l’app Livres</h3>
                <p>Vos EPUB et PDF de l’app Livres d’Apple, avec surlignages, notes et signets. Les nouveaux livres arrivent ensuite tout seuls.</p>
                <button
                  className="btn"
                  onClick={() => {
                    useStore.getState().navigate({ name: 'library' });
                    setTimeout(() => window.dispatchEvent(new Event(OPEN_APPLE_BOOKS)), 50);
                  }}
                >
                  Choisir dans Livres…
                </button>
              </section>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
