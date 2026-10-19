// Mises à jour : fenêtre « Quoi de neuf » au premier lancement d'une nouvelle version (nouveautés
// livrées avec l'app), et annonce d'une nouvelle version publiée (Release GitHub, vérifiée au
// lancement si le réglage le permet ; seule connexion sortante de l'app, sans donnée envoyée).
// Mise à jour automatique (Mac et Windows installés, manifeste signé vérifié par le processus
// principal) : téléchargement en arrière-plan, puis « Marginalia X est prête » avec « Redémarrer pour
// mettre à jour » ou « Plus tard » (installation à la fermeture). Ailleurs, ou en cas d'échec :
// l'annonce propose la page de téléchargement du site.
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { create } from 'zustand';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { Download, FolderSearch, HardDrive, NotebookPen, RefreshCw, RotateCw, Settings2, Smartphone, Sparkles, Lock, Network, X } from 'lucide-react';
import { flushPendingSave, useStore } from '../../lib/store';
import { host, type UpdateInfo, type UpdateState } from '../../lib/platform';
import { openWifiReceive } from '../inbox/inbox';
import { NEWS, compareVersions, newsSince, type NewsAction, type NewsEntry, type NewsIcon } from './news';
import './updates.css';

interface UpdatesUi {
  version: string | null;
  /** Nouveautés à montrer (fenêtre « Quoi de neuf ») ; null : fermée. */
  news: NewsEntry[] | null;
  /** Nouvelle version disponible (annonce). */
  update: UpdateInfo | null;
  /** Récap de la nouvelle version (texte de la Release) ouvert. */
  notesOpen: boolean;
  /** Mac : autorisation « Accès complet au disque » à (re)donner ; updated : juste après une mise à jour. */
  diskAccess: { updated: boolean } | null;
  /** Mise à jour automatique : téléchargement / prête / erreur (null : pas de mise à jour automatique en cours). */
  dl: UpdateState | null;
  /** Bannière de progression masquée (le téléchargement continue). */
  progressHidden: boolean;
  /** « Plus tard » choisi sur « prête » (pour cette session). */
  later: boolean;
}
export const useUpdates = create<UpdatesUi>(() => ({ version: null, news: null, update: null, notesOpen: false, diskAccess: null, dl: null, progressHidden: false, later: false }));

const autoInstall = () => useStore.getState().settings.updateAutoInstall !== 'ask';

/** Installer à la fermeture : réglage « Oui », ou « Plus tard » choisi explicitement. */
export function syncInstallOnQuit() {
  const { dl, later } = useUpdates.getState();
  void host.updates?.setInstallOnQuit?.(dl?.status === 'ready' && (autoInstall() || later));
}

function applyState(st: UpdateState | null | undefined) {
  if (!st) return;
  // « idle » après une annulation : plus rien à montrer pour la mise à jour automatique.
  useUpdates.setState({ dl: st.status === 'idle' ? null : st });
  if (st.status === 'ready') syncInstallOnQuit();
}

/** Lance le téléchargement en arrière-plan (fichier choisi et vérifié par le processus principal). */
async function startAutoUpdate() {
  const api = host.updates;
  if (!api?.download) return;
  const r = await api.download().catch(() => null);
  if (r?.ok && r.state) applyState(r.state);
}

/** Vérifie maintenant (bouton des réglages) : met à jour l'annonce et renvoie le résultat. */
export async function checkForUpdate(): Promise<UpdateInfo | null> {
  const api = host.updates;
  if (!api) return null;
  const r = await api.check().catch(() => null);
  if (r?.newer) {
    useUpdates.setState({ update: r });
    if (r.auto?.ok) await startAutoUpdate();
  }
  return r;
}

/**
 * « Redémarrer pour mettre à jour » : fin propre d'une session de travail à plusieurs, dernières
 * modifications écrites, puis le processus principal vérifie encore le fichier et redémarre.
 */
export async function restartToUpdate(): Promise<boolean> {
  const api = host.updates;
  const prev = useUpdates.getState().dl;
  if (!api?.install || prev?.status !== 'ready') return false;
  useUpdates.setState({ dl: { ...prev, status: 'installing' } });
  try {
    await import('../collab/session').then((m) => m.stopSession()).catch(() => undefined);
    await flushPendingSave().catch(() => undefined);
  } catch {
    /* l'écriture est refaite par le processus principal avant de quitter */
  }
  const r = await api.install().catch((e) => ({ ok: false, error: String((e as Error)?.message || e) }));
  if (!r.ok) {
    useUpdates.setState({ dl: { ...prev, status: 'error', error: r.error || 'Installation impossible.' } });
    return false;
  }
  return true;
}

/** « Plus tard » sur « prête » : installée à la fermeture (réglage « Oui » ou choix explicite). */
export function installLater() {
  useUpdates.setState({ later: true });
  syncInstallOnQuit();
  useStore.getState().toast('La mise à jour s’installera à la fermeture de Marginalia.', 'info');
}

/** Rouvre les nouveautés de la version installée (réglages). */
export function showNews() {
  const v = useUpdates.getState().version;
  if (!v) return;
  const all = newsSince(undefined, v);
  if (all.length) useUpdates.setState({ news: all.slice(0, 1) });
}

const hasNewsFor = (v: string) => NEWS.some((e) => compareVersions(e.version, v) === 0);
export const newsAvailable = () => {
  const v = useUpdates.getState().version;
  return !!v && newsSince(undefined, v).length > 0;
};

/** Branché une fois dans l'app, quand les données sont prêtes. */
export function useUpdatesSync() {
  const ready = useStore((s) => s.ready);
  const started = useRef(false);
  useEffect(() => {
    const api = host.updates;
    if (!api || !ready || started.current) return;
    started.current = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    void (async () => {
      const version = await api.version().catch(() => null);
      if (!version) return;
      useUpdates.setState({ version });
      const st = useStore.getState();
      const seen = st.settings.lastSeenVersion;
      if (!seen || compareVersions(version, seen) > 0) {
        // Premier lancement d'une nouvelle version. Nouvel utilisateur (aucune donnée) : pas de
        // « Quoi de neuf », il découvre tout. Sinon : les nouveautés pas encore vues.
        const isNew = !seen && !st.books.length && !st.drafts.length && !st.highlights.length;
        const news = isNew ? [] : newsSince(seen, version);
        if (news.length) useUpdates.setState({ news });
        else st.updateSettings({ lastSeenVersion: version });
      }
      // Mac : l'app Livres est là mais macOS refuse la lecture (premier lancement, ou autorisation
      // perdue avec la mise à jour). Proposé une fois par version.
      if (host.diskAccess && st.settings.diskAccessAskedVersion !== version) {
        const r = await host.diskAccess.status().catch(() => null);
        if (r?.status === 'denied') useUpdates.setState({ diskAccess: { updated: !!(st.settings.diskAccessAskedVersion || seen) } });
        else if (r) st.updateSettings({ diskAccessAskedVersion: version });
      }
      // Interface rechargée pendant un téléchargement : on reprend l'état du processus principal.
      const cur = await api.state?.().catch(() => null);
      if (cur && cur.status !== 'idle') applyState(cur);
      if (st.settings.updateCheck === false) return;
      // Un peu après le lancement : l'interface d'abord.
      timer = setTimeout(async () => {
        const r = await api.check().catch(() => null);
        if (!r?.newer || !r.latest) return;
        if (r.auto?.ok) {
          useUpdates.setState({ update: r });
          await startAutoUpdate();
        } else if (useStore.getState().settings.updateDismissed !== r.latest) useUpdates.setState({ update: r });
      }, 4000);
    })();
    return () => clearTimeout(timer);
  }, [ready]);
  // Progression, fin et erreurs du téléchargement (processus principal).
  useEffect(() => host.updates?.onEvent?.((e) => applyState(e)), []);
  // Réglage « Installer automatiquement » changé : l'installation à la fermeture suit.
  const mode = useStore((s) => s.settings.updateAutoInstall);
  useEffect(() => {
    if (useUpdates.getState().dl?.status === 'ready') syncInstallOnQuit();
  }, [mode]);
}

function NewsIconFor({ icon }: { icon: NewsIcon }) {
  const p = { size: 18, strokeWidth: 1.7 };
  switch (icon) {
    case 'phone':
      return <Smartphone {...p} />;
    case 'notes':
      return <NotebookPen {...p} />;
    case 'update':
      return <RefreshCw {...p} />;
    case 'map':
      return <Network {...p} />;
    case 'lock':
      return <Lock {...p} />;
    default:
      return <Sparkles {...p} />;
  }
}

function runAction(a: NewsAction) {
  const s = useStore.getState();
  if (a === 'wifi') openWifiReceive();
  else if (a === 'inbox') s.navigate({ name: 'inbox' });
  else if (a === 'settings') s.navigate({ name: 'settings' });
  else if (a === 'maps') s.navigate({ name: 'maps' });
  else if (a === 'import') s.navigate({ name: 'import' });
  else if (a === 'tour') void import('../tour/Tour').then((m) => m.startTour());
}

function useEscape(onClose: () => void) {
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
}

function WhatsNew({ news }: { news: NewsEntry[] }) {
  const close = () => {
    const v = useUpdates.getState().version;
    if (v) useStore.getState().updateSettings({ lastSeenVersion: v });
    useUpdates.setState({ news: null });
  };
  useEscape(close);
  const btn = useRef<HTMLButtonElement>(null);
  useEffect(() => btn.current?.focus(), []);
  const [first, ...older] = news;
  return createPortal(
    <div className="up-back anim-fade" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="up-dialog panel anim-scale" role="dialog" aria-modal="true" aria-labelledby="up-title" data-testid="whats-new">
        <header className="up-head">
          <p className="up-kicker">
            <Sparkles size={14} /> Quoi de neuf
          </p>
          <h2 id="up-title">Marginalia {first.version}</h2>
        </header>
        <ul className="up-items">
          {[first, ...older].flatMap((e) => e.items).map((it) => (
            <li key={it.title}>
              <span className="up-icon" aria-hidden="true">
                <NewsIconFor icon={it.icon} />
              </span>
              <div>
                <h3>{it.title}</h3>
                <p>{it.text}</p>
                {it.action && (
                  <button
                    className="btn btn-sm up-try"
                    onClick={() => {
                      close();
                      runAction(it.action!.run);
                    }}
                  >
                    {it.action.label}
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
        {older.length > 0 && <p className="up-since">Avec les nouveautés des versions {older.map((e) => e.version).join(', ')}.</p>}
        <footer className="up-foot">
          <button ref={btn} className="btn btn-primary" onClick={close}>
            Continuer
          </button>
        </footer>
      </div>
    </div>,
    document.body,
  );
}

/** Texte de la Release (Markdown) en HTML sûr ; les liens s'ouvrent dans le navigateur. */
function notesHtml(md: string): string {
  const html = DOMPurify.sanitize(marked.parse(md, { gfm: true, async: false }) as string, { FORBID_TAGS: ['img', 'iframe', 'style', 'form'] });
  return html.replace(/<a /g, '<a target="_blank" rel="noreferrer" ');
}

function ReleaseNotes({ u }: { u: UpdateInfo }) {
  const close = () => useUpdates.setState({ notesOpen: false });
  useEscape(close);
  const html = useMemo(() => notesHtml(u.notes || ''), [u.notes]);
  const ready = useUpdates((s) => s.dl?.status === 'ready');
  return createPortal(
    <div className="up-back anim-fade" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="up-dialog panel anim-scale" role="dialog" aria-modal="true" aria-labelledby="up-notes-title" data-testid="release-notes">
        <header className="up-head row">
          <div>
            <p className="up-kicker">
              <RefreshCw size={14} /> Nouvelle version
            </p>
            <h2 id="up-notes-title">Marginalia {u.latest}</h2>
            <p className="up-sub">
              Vous avez la version {u.current}
              {u.publishedAt ? ` · publiée le ${new Date(u.publishedAt).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })}` : ''}
            </p>
          </div>
          <button className="icon-btn sm" onClick={close} aria-label="Fermer">
            <X size={16} />
          </button>
        </header>
        {html.trim() ? <div className="up-notes" dangerouslySetInnerHTML={{ __html: html }} /> : <p className="up-sub">Pas de récapitulatif pour cette version.</p>}
        {ready ? (
          <footer className="up-foot">
            <p className="up-how">Mise à jour téléchargée et vérifiée. Vos livres, notes et écrits sont enregistrés avant le redémarrage.</p>
            <button className="btn btn-primary" onClick={() => void restartToUpdate()}>
              <RotateCw size={14} /> Redémarrer pour mettre à jour
            </button>
          </footer>
        ) : (
          <footer className="up-foot">
            <p className="up-how">Téléchargez la nouvelle version et installez-la par-dessus : vos livres, notes et écrits sont conservés.</p>
            <a className="btn btn-primary" href={u.downloadUrl} target="_blank" rel="noreferrer">
              <Download size={14} /> Télécharger
            </a>
          </footer>
        )}
      </div>
    </div>,
    document.body,
  );
}

/** Premier point du récap (« - Recevoir depuis le téléphone… ») pour l'annonce. */
function teaser(md?: string): string {
  if (!md) return '';
  const line = md
    .split('\n')
    .map((l) => l.trim())
    .find((l) => /^[-*•]\s+\S/.test(l) || (/^[^#>|]/.test(l) && l.length > 20));
  return (line ?? '')
    .replace(/^[-*•]\s+/, '')
    .replace(/\*\*|__|`/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .slice(0, 140);
}

function UpdateBanner({ u, note }: { u: UpdateInfo; note?: string }) {
  const later = () => {
    if (u.latest) useStore.getState().updateSettings({ updateDismissed: u.latest });
    useUpdates.setState({ update: null, dl: null });
  };
  const t = teaser(u.notes);
  return (
    <aside className="up-banner anim-in" aria-label="Nouvelle version disponible" data-testid="update-banner">
      <div className="up-banner-text">
        <strong>Marginalia {u.latest} est disponible</strong>
        {note ? <span className="up-banner-note">{note}</span> : t && <span>{t}</span>}
      </div>
      <div className="up-banner-actions">
        <button className="btn btn-sm" onClick={() => useUpdates.setState({ notesOpen: true })}>
          Voir les nouveautés
        </button>
        <a className="btn btn-sm btn-primary" href={u.downloadUrl} target="_blank" rel="noreferrer">
          <Download size={13} /> Télécharger
        </a>
      </div>
      <button className="icon-btn sm up-banner-close" onClick={later} aria-label="Plus tard (ne plus annoncer cette version)" title="Plus tard">
        <X size={14} />
      </button>
    </aside>
  );
}

const pct = (d: UpdateState) => (d.total > 0 ? Math.min(100, Math.floor((d.received / d.total) * 100)) : 0);

/** Téléchargement en arrière-plan : discret, masquable (le téléchargement continue). */
function UpdateProgress({ d }: { d: UpdateState }) {
  const p = pct(d);
  return (
    <aside className="up-banner up-mini anim-in" aria-label="Téléchargement de la mise à jour" data-testid="update-progress">
      <div className="up-mini-row">
        <span className="up-mini-title">
          <Download size={13} /> Mise à jour {d.version}
        </span>
        <span className="up-mini-pct">{p} %</span>
      </div>
      <div className="up-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={p} aria-label="Progression du téléchargement">
        <span style={{ width: `${p}%` }} />
      </div>
      <span className="up-mini-sub">Téléchargement en arrière-plan · vous pouvez continuer à travailler</span>
      <button className="icon-btn sm up-banner-close" onClick={() => useUpdates.setState({ progressHidden: true })} aria-label="Masquer (le téléchargement continue)" title="Masquer">
        <X size={14} />
      </button>
    </aside>
  );
}

/** Mise à jour téléchargée et vérifiée : redémarrer maintenant, ou plus tard (à la fermeture). */
function UpdateReady({ d, u }: { d: UpdateState; u: UpdateInfo | null }) {
  const installing = d.status === 'installing';
  const t = teaser(u?.notes);
  const [busy, setBusy] = useState(false);
  return (
    <aside className="up-banner up-ready anim-in" aria-label="Mise à jour prête" data-testid="update-ready">
      <div className="up-banner-text">
        <strong>Marginalia {d.version} est prête</strong>
        {t && <span>{t}</span>}
        {u?.notes && (
          <button className="up-link" onClick={() => useUpdates.setState({ notesOpen: true })}>
            Voir les nouveautés
          </button>
        )}
      </div>
      <div className="up-banner-actions">
        <button className="btn btn-sm" onClick={installLater} disabled={installing || busy}>
          Plus tard
        </button>
        <button
          className="btn btn-sm btn-primary"
          disabled={installing || busy}
          onClick={async () => {
            setBusy(true);
            await restartToUpdate();
            setBusy(false);
          }}
        >
          <RotateCw size={13} /> {installing ? 'Redémarrage…' : 'Redémarrer pour mettre à jour'}
        </button>
      </div>
    </aside>
  );
}

/** Mac : guider l'autorisation « Accès complet au disque » (et la retirer / remettre après une mise à jour). */
function DiskAccess({ updated }: { updated: boolean }) {
  const later = () => {
    const v = useUpdates.getState().version;
    if (v) useStore.getState().updateSettings({ diskAccessAskedVersion: v });
    useUpdates.setState({ diskAccess: null });
  };
  useEscape(later);
  const api = host.diskAccess!;
  return createPortal(
    <div className="up-back anim-fade" onMouseDown={(e) => e.target === e.currentTarget && later()}>
      <div className="up-dialog panel anim-scale" role="dialog" aria-modal="true" aria-labelledby="da-title" data-testid="disk-access">
        <header className="up-head">
          <p className="up-kicker">
            <HardDrive size={14} /> Synchronisation avec Livres
          </p>
          <h2 id="da-title">Une autorisation à {updated ? 'redonner' : 'donner'}</h2>
          <p className="up-sub da-lede">
            Pour retrouver vos livres, surlignages et notes de l’app Livres, macOS demande d’autoriser Marginalia dans « Accès complet au disque ». Sans
            cette autorisation, tout le reste fonctionne.
          </p>
        </header>
        {updated && (
          <p className="da-note" role="note">
            Vous venez de mettre à jour Marginalia : macOS ne reconnaît plus l’autorisation donnée à l’ancienne version, même si la case paraît cochée. Il
            faut la retirer puis la remettre.
          </p>
        )}
        <ol className="da-steps">
          <li>
            <div>
              Ouvrez <strong>Réglages Système › Confidentialité et sécurité › Accès complet au disque</strong>.
            </div>
            <button className="btn btn-sm" onClick={() => void api.openSettings()}>
              <Settings2 size={13} /> Ouvrir les Réglages
            </button>
          </li>
          <li>
            <div>
              Si <strong>Marginalia</strong> est déjà dans la liste, sélectionnez-la et cliquez sur <strong>« − »</strong> pour la retirer.
            </div>
          </li>
          <li>
            <div>
              Cliquez sur <strong>« + »</strong> et choisissez Marginalia dans le dossier Applications, ou glissez l’app dans la liste. Vérifiez que
              l’interrupteur est activé.
            </div>
            <button className="btn btn-sm" onClick={() => void api.revealApp()}>
              <FolderSearch size={13} /> Montrer Marginalia dans le Finder
            </button>
          </li>
          <li>
            <div>Relancez Marginalia : l’autorisation ne compte qu’au redémarrage.</div>
          </li>
        </ol>
        <footer className="up-foot">
          <button className="btn" onClick={later}>
            Plus tard
          </button>
          <button className="btn btn-primary" onClick={() => void api.relaunch()}>
            <RotateCw size={14} /> Relancer Marginalia
          </button>
        </footer>
      </div>
    </div>,
    document.body,
  );
}

/** Calque des mises à jour : fenêtres et annonce. */
export function UpdatesLayer() {
  useUpdatesSync();
  const news = useUpdates((s) => s.news);
  const update = useUpdates((s) => s.update);
  const notesOpen = useUpdates((s) => s.notesOpen);
  const disk = useUpdates((s) => s.diskAccess);
  const route = useStore((s) => s.route.name);
  const dl = useUpdates((s) => s.dl);
  const progressHidden = useUpdates((s) => s.progressHidden);
  const later = useUpdates((s) => s.later);
  const free = !notesOpen && !news && !disk && route !== 'reader';
  let banner = null;
  if (dl?.status === 'downloading') banner = progressHidden ? null : <UpdateProgress d={dl} />;
  else if (dl?.status === 'ready' || dl?.status === 'installing') banner = later && dl.status === 'ready' ? null : <UpdateReady d={dl} u={update} />;
  else if (dl?.status === 'error' && update) banner = <UpdateBanner u={update} note={`La mise à jour automatique n’a pas abouti : ${dl.error || 'erreur inconnue'} Vous pouvez la télécharger depuis le site.`} />;
  else if (update) banner = <UpdateBanner u={update} />;
  return (
    <>
      {news && news.length > 0 && <WhatsNew news={news} />}
      {/* Après « Quoi de neuf » : l'autorisation à redonner. */}
      {disk && !(news && news.length) && <DiskAccess updated={disk.updated} />}
      {update && notesOpen && <ReleaseNotes u={update} />}
      {/* L'annonce attend la fin de la lecture (pas dans le lecteur) et la fermeture de « Quoi de neuf ». */}
      {free && banner}
    </>
  );
}

export { hasNewsFor };
