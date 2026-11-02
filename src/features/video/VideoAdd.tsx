// « Ajouter une vidéo » (bibliothèque, espaces) : lien collé → plateforme reconnue → titre, chaîne,
// durée et miniature (processus principal, réglage « Vidéos en ligne ») → aperçu modifiable → ajout.
// Option : récupérer la transcription (sous-titres YouTube), rangée avec la vidéo.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, Link2, MonitorPlay } from 'lucide-react';
import { useStore } from '../../lib/store';
import { host } from '../../lib/platform';
import { PROVIDER_LABEL, addVideoBook, fetchThumb, fetchTranscript, findVideoBook, fmtDuration, parseVideoUrl, videoOnline, type ParsedVideo } from './video';
import './video.css';

export function VideoAddButton({ workspaceId, groupId }: { workspaceId?: string | null; groupId?: string | null }) {
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
        className={`btn ${open ? 'active' : ''}`}
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="dialog"
        aria-expanded={open}
        title="Ajouter une vidéo (YouTube, Vimeo, Dailymotion, ou un lien)"
        data-testid="video-add"
      >
        <MonitorPlay size={14} /> Vidéo
      </button>
      {open && <VideoAddPop anchor={btn} onClose={close} workspaceId={workspaceId} groupId={groupId} />}
    </>
  );
}

interface Meta {
  title: string;
  author: string;
  duration: number;
  thumb: string | null;
}

function VideoAddPop({ anchor, onClose, workspaceId, groupId }: { anchor: React.RefObject<HTMLElement>; onClose(): void; workspaceId?: string | null; groupId?: string | null }) {
  const online = useStore((s) => s.settings.videoOnline !== false) && !!host.video;
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const [link, setLink] = useState('');
  const [parsed, setParsed] = useState<ParsedVideo | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [meta, setMeta] = useState<Meta | null>(null);
  const [title, setTitle] = useState('');
  const [author, setAuthor] = useState('');
  const [withTranscript, setWithTranscript] = useState(true);
  const seq = useRef(0);

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
  }, [anchor, parsed, meta]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (ref.current?.contains(t) || anchor.current?.contains(t)) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      onClose();
    };
    window.addEventListener('mousedown', onDown, true);
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('mousedown', onDown, true);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [onClose, anchor]);

  // Lien reconnu → titre, chaîne, durée, miniature (au fil de la frappe, avec un court délai).
  useEffect(() => {
    const p = parseVideoUrl(link);
    setParsed(p);
    setError('');
    setMeta(null);
    if (!p) return;
    if (p.provider === 'link' || !online) {
      setTitle('');
      setAuthor('');
      return;
    }
    const n = ++seq.current;
    setLoading(true);
    const t = window.setTimeout(async () => {
      const r = await host.video!.meta(p.provider, p.id).catch(() => null);
      if (n !== seq.current) return;
      if (!r || !r.ok) {
        setLoading(false);
        setError(r?.error ?? 'Impossible de joindre la plateforme. Vous pouvez remplir le titre à la main.');
        return;
      }
      const thumb = await fetchThumb(r.thumb);
      if (n !== seq.current) return;
      setMeta({ title: r.title ?? '', author: r.author ?? '', duration: r.duration ?? 0, thumb });
      setTitle(r.title ?? '');
      setAuthor(r.author ?? '');
      setLoading(false);
    }, 350);
    return () => {
      window.clearTimeout(t);
      setLoading(false);
    };
  }, [link, online]);

  const existing = parsed ? findVideoBook(parsed) : null;
  const canAdd = !!parsed && !existing && !loading && (parsed.provider !== 'link' || title.trim().length > 0) && (online || title.trim().length > 0 || parsed.provider !== 'link');

  const add = () => {
    if (!parsed || !canAdd) return;
    const book = addVideoBook(
      {
        provider: parsed.provider,
        id: parsed.id,
        url: parsed.url,
        title: title || meta?.title || '',
        author,
        duration: meta?.duration,
        cover: meta?.thumb ?? null,
      },
      { workspaceId, groupId },
    );
    const st = useStore.getState();
    if (parsed.start) st.updateBook(book.id, { video: { ...book.video!, position: parsed.start } });
    st.toast(`« ${book.title} » ajoutée à la bibliothèque`, 'success', { label: 'Ouvrir', run: () => useStore.getState().openBook(book.id) });
    if (parsed.provider === 'youtube' && withTranscript && online) {
      void fetchTranscript(book.id).then((r) => {
        useStore.getState().toast(r.ok ? `Transcription de « ${book.title} » prête` : `Transcription de « ${book.title} » : ${r.error}`, r.ok ? 'success' : 'info');
      });
    }
    onClose();
  };

  const kindLine = parsed ? (parsed.provider === 'link' ? 'Lien : la vidéo s’ouvrira dans votre navigateur' : [PROVIDER_LABEL[parsed.provider], fmtDuration(meta?.duration)].filter(Boolean).join(' · ')) : '';

  return createPortal(
    <div ref={ref} className="floating va-pop anim-scale" role="dialog" aria-label="Ajouter une vidéo" style={{ top: pos?.top ?? -9999, left: pos?.left ?? -9999 }} data-testid="video-menu">
      <h3 className="va-title">Ajouter une vidéo</h3>
      <p className="va-help">Collez le lien d’un documentaire, d’un cours ou d’une conférence.</p>
      <div className="va-field">
        <span className="va-input">
          <Link2 size={14} aria-hidden="true" />
          <input
            className="input"
            autoFocus
            value={link}
            onChange={(e) => setLink(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                add();
              }
            }}
            placeholder="https://www.youtube.com/watch?v=…"
            spellCheck={false}
            aria-label="Lien de la vidéo"
            data-testid="video-link"
          />
        </span>
      </div>
      {link.trim() && !parsed && <p className="va-note">Ce n’est pas un lien web.</p>}

      {parsed && (
        <div className="va-preview" data-testid="video-preview">
          <div className="va-thumb" aria-hidden="true">
            {meta?.thumb ? <img src={meta.thumb} alt="" /> : <MonitorPlay size={22} />}
            {loading && <span className="va-loading" />}
          </div>
          <div className="va-fields">
            <input className="input va-name" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={loading ? 'Recherche du titre…' : 'Titre de la vidéo'} aria-label="Titre" data-testid="video-title" />
            <input className="input" value={author} onChange={(e) => setAuthor(e.target.value)} placeholder="Auteur ou chaîne" aria-label="Auteur ou chaîne" data-testid="video-author" />
            <span className="va-kind">{kindLine}</span>
          </div>
        </div>
      )}
      {error && <p className="va-note">{error}</p>}
      {parsed && !online && parsed.provider !== 'link' && (
        <p className="va-note">Les vidéos en ligne sont désactivées dans les Réglages : remplissez le titre à la main. La vidéo s’ouvrira dans votre navigateur.</p>
      )}
      {existing && (
        <p className="va-note">
          Déjà dans la bibliothèque : «&nbsp;{existing.title}&nbsp;».{' '}
          <button className="btn btn-ghost btn-sm" onClick={() => (useStore.getState().openBook(existing.id), onClose())}>
            Ouvrir
          </button>
        </p>
      )}
      {parsed?.provider === 'youtube' && online && !existing && (
        <label className="va-check">
          <input type="checkbox" checked={withTranscript} onChange={(e) => setWithTranscript(e.target.checked)} data-testid="video-with-transcript" />
          <span>
            Récupérer la transcription
            <small>Les sous-titres de la vidéo, pour surligner des passages comme dans un livre.</small>
          </span>
        </label>
      )}
      {parsed && parsed.provider !== 'link' && !online ? null : parsed?.provider === 'link' ? (
        <p className="va-note">Plateformes à abonnement (Canal+, Netflix…) : leur lecteur ne s’intègre pas dans l’app. La vidéo s’ouvre dans votre navigateur, vous notez ici les moments qui comptent.</p>
      ) : null}
      <div className="va-foot">
        <button className="btn btn-sm btn-ghost" onClick={onClose}>
          Annuler
        </button>
        <button className="btn btn-sm btn-primary" onClick={add} disabled={!canAdd} data-testid="video-add-confirm">
          <Check size={13} /> Ajouter la vidéo
        </button>
      </div>
    </div>,
    document.body,
  );
}
