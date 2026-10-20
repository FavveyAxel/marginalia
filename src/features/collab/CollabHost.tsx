// Fenêtres de « Travailler à plusieurs », montées une fois pour toute l'application :
//  - « Travailler à plusieurs » (hôte) : prénom et couleur, puis le code « 735-700 », les présents,
//    les demandes à accepter, « Arrêter le partage » ;
//  - « Rejoindre un espace partagé » (invité) : prénom et couleur, code, attente de l'accord, arrivée ;
//  - les demandes reçues quand la fenêtre de l'hôte est fermée (en bas à droite).
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { BookOpen, Check, FilePen, Folder, Highlighter, ListTree, Lock, MoreHorizontal, Network, RefreshCw, ScrollText, Sigma, Trash2, Upload, Users, X } from 'lucide-react';
import type { WorkspaceItemKind } from '../../lib/types';
import { host, type CollabMember, type CollabRequest } from '../../lib/platform';
import { useStore } from '../../lib/store';
import { errorMessage } from '../share/shareUi';
import { BigCode, Bridge, Steps, Trouble } from '../share/shareVisuals';
import type { Choice } from './docxMerge';
import { COLLAB_COLORS, dashed, isLiveIn, readProfile, stopCollab, useCollab, writeProfile, type CollabProfile } from './collabState';
import '../inbox/inbox.css';
import '../share/share.css';
import './collab.css';

const session = () => import('./session');

/** Collaboration par Internet : permise (réglage) et possible sur cet ordinateur (module présent). */
function useInternetOk() {
  const on = useStore((s) => s.settings.collabInternet !== false);
  const [supported, setSupported] = useState(false);
  useEffect(() => {
    let alive = true;
    void session()
      .then((m) => m.internetState())
      .then((r) => alive && setSupported(r.supported && r.enabled), () => undefined);
    return () => {
      alive = false;
    };
  }, []);
  return on && supported;
}

export function CollabHost() {
  const panelFor = useCollab((s) => s.panelFor);
  const joinOpen = useCollab((s) => s.joinOpen);
  const requests = useCollab((s) => s.requests);
  const role = useCollab((s) => s.role);
  const reunion = useCollab((s) => s.reunion);
  const afterSession = useCollab((s) => s.afterSession);
  const ready = useStore((s) => s.ready);
  useEffect(() => {
    if (ready) void import('./memory').then((m) => m.initMemory());
    // Réglage « Partager et travailler à plusieurs par Internet » appliqué dès le lancement.
    if (ready) void session().then((m) => m.applyInternet());
  }, [ready]);
  useEffect(() => {
    void session().then((m) => m.closeStale());
    // Accès de test (app lancée par un test de bout en bout : ?e2e).
    if (new URLSearchParams(location.search).has('e2e')) (window as unknown as { __collab?: unknown }).__collab = { state: useCollab, session };
  }, []);
  return (
    <>
      {panelFor && <CollabPanel workspaceId={panelFor} onClose={() => useCollab.setState({ panelFor: null })} />}
      {joinOpen && !reunion && <JoinDialog onClose={() => useCollab.setState({ joinOpen: false })} />}
      {reunion && <ReunionDialog key={reunion.items.map((i) => i.id).join('|')} />}
      {afterSession && !reunion && <KeepDialog key={afterSession.workspaceId} />}
      {role === 'host' && !panelFor && requests.length > 0 && createPortal(<div className="cl-asks" data-testid="collab-asks">{requests.map((r) => <Ask key={r.reqId} r={r} />)}</div>, document.body)}
    </>
  );
}

function Ask({ r }: { r: CollabRequest }) {
  const title = useCollab((s) => s.title);
  const [busy, setBusy] = useState(false);
  const act = (ok: boolean) => {
    setBusy(true);
    void session().then((m) => (ok ? m.acceptRequest(r.reqId) : m.rejectRequest(r.reqId)));
  };
  return (
    <div className="cl-ask anim-scale" role="alertdialog" aria-label="Demande pour rejoindre l’espace" data-testid="collab-request">
      <span className="cl-ask-face" style={{ background: r.color }} aria-hidden="true">{r.name.charAt(0).toUpperCase()}</span>
      <div className="cl-ask-text">
        <strong className="cl-ask-name">{r.name}</strong>
        <span>
          sur {r.device} demande à rejoindre « {title} »
        </span>
        <span className="cl-ask-sub">Pourra tout lire et modifier · {r.address}</span>
        {r.wasRemoved && (
          <span className="cl-ask-removed" data-testid="collab-request-removed">
            Retiré de cette session tout à l’heure
          </span>
        )}
      </div>
      <div className="cl-ask-actions">
        <button className="btn" disabled={busy} onClick={() => act(false)} data-testid="collab-reject">Refuser</button>
        <button className="btn btn-primary" disabled={busy} onClick={() => act(true)} data-testid="collab-accept">Accepter</button>
      </div>
    </div>
  );
}

/** Prénom et couleur : un grand rond qui prend la couleur et l'initiale au fil de la saisie. */
function Who({ profile, setProfile, taken = [] }: { profile: CollabProfile; setProfile: (p: CollabProfile) => void; taken?: string[] }) {
  const letter = profile.name.trim().charAt(0).toUpperCase();
  return (
    <div className="cl-who">
      <span className={`cl-me${letter ? '' : ' empty'}`} style={{ background: profile.color }} aria-hidden="true">{letter || '?'}</span>
      <div className="cl-who-fields">
        <label>
          <span>Votre prénom, vu par les autres</span>
          <input type="text" value={profile.name} maxLength={40} onChange={(e) => setProfile({ ...profile, name: e.target.value })} placeholder="Léa" spellCheck={false} data-testid="collab-name" autoFocus />
        </label>
        <div className="cl-swatches" role="radiogroup" aria-label="Votre couleur">
          {COLLAB_COLORS.map((c) => {
            const used = taken.includes(c) && profile.color !== c;
            return (
              <button
                key={c}
                className={`cl-swatch${used ? ' used' : ''}`}
                style={{ background: c }}
                role="radio"
                aria-checked={profile.color === c}
                aria-label={used ? `Couleur ${c}, déjà prise` : `Couleur ${c}`}
                title={used ? 'Déjà prise' : undefined}
                disabled={used}
                onClick={() => setProfile({ ...profile, color: c })}
                data-color={c}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}

/**
 * Les six places de la session : les présents en couleur, les places libres en pointillé.
 * `canRemove` (hôte) : un clic sur un invité propose de le retirer, avec une confirmation sur place.
 */
/** Nombre de places de la session (vous compris) : 2 à 6 ; jamais moins que les présents. */
function Places({ value, min = 2, onChange }: { value: number; min?: number; onChange: (n: number) => void }) {
  return (
    <div className="cl-places">
      <span id="cl-places-label">Combien de personnes ?</span>
      <div className="segmented cl-places-seg" role="radiogroup" aria-labelledby="cl-places-label" data-testid="collab-places">
        {[2, 3, 4, 5, 6].map((n) => (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={value === n}
            className={value === n ? 'active' : ''}
            disabled={n < min}
            title={n < min ? 'Moins de places que de présents' : undefined}
            onClick={() => onChange(n)}
            data-places={n}
          >
            {n}
          </button>
        ))}
      </div>
    </div>
  );
}

const PLACES_KEY = 'marginalia:collab-places';
const readPlaces = () => {
  try {
    const n = Number(localStorage.getItem(PLACES_KEY));
    return n >= 2 && n <= 6 ? n : 6;
  } catch {
    return 6;
  }
};
const writePlaces = (n: number) => {
  try {
    localStorage.setItem(PLACES_KEY, String(n));
  } catch {
    /* sans mémoire du choix */
  }
};

function People({ members, me, canRemove = false }: { members: CollabMember[]; me: string | null; canRemove?: boolean }) {
  const max = useCollab((s) => s.maxPeople);
  const free = Math.max(0, max - members.length);
  const [ask, setAsk] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const target = ask ? members.find((m) => m.id === ask && !m.host) : undefined;
  useEffect(() => {
    if (ask && !target) setAsk(null);
  }, [ask, target]);
  const remove = async (id: string) => {
    setBusy(true);
    try {
      await (await session()).removeMember(id);
    } finally {
      setBusy(false);
      setAsk(null);
    }
  };
  return (
    <div className="cl-seats-wrap">
      <ul className="cl-seats" data-testid="collab-people" aria-label={`Présents : ${members.length} sur ${max}`}>
        {members.map((m) => {
          const face = (
            <>
              <span className="cl-seat-face" style={{ background: m.color }}>
                {m.name.charAt(0).toUpperCase()}
                {canRemove && !m.host && (
                  <span className="cl-seat-x" aria-hidden="true">
                    <X size={11} strokeWidth={3} />
                  </span>
                )}
              </span>
              <span className="cl-seat-name">{m.id === me ? 'Vous' : m.name}</span>
              {m.host && <span className="cl-seat-tag">hôte</span>}
            </>
          );
          const cls = `cl-seat${m.state === 'away' ? ' away' : ''}${ask === m.id ? ' asking' : ''}`;
          const tip = `${m.name} · ${m.device}${m.state === 'away' ? ' · connexion perdue' : ''}`;
          return (
            <li key={m.id} className={cls} data-member={m.name} title={tip}>
              {canRemove && !m.host ? (
                <button type="button" className="cl-seat-btn" onClick={() => setAsk(ask === m.id ? null : m.id)} aria-label={`Retirer ${m.name} de la session…`} aria-expanded={ask === m.id} data-testid="collab-member-remove">
                  {face}
                </button>
              ) : (
                face
              )}
            </li>
          );
        })}
        {Array.from({ length: free }).map((_, i) => (
          <li key={`free${i}`} className="cl-seat free" aria-hidden="true">
            <span className="cl-seat-face" />
            <span className="cl-seat-name">libre</span>
          </li>
        ))}
      </ul>
      {target ? (
        <div className="cl-remove anim-scale" role="alertdialog" aria-label={`Retirer ${target.name}`} data-testid="collab-remove-confirm" style={{ ['--who' as string]: target.color }}>
          <p>
            <strong>Retirer {target.name} de la session ?</strong>
            <span>Vos modifications ne s’échangeront plus. Ce qui a déjà été reçu reste sur son ordinateur ; pour revenir, il faudra une nouvelle demande.</span>
          </p>
          <div className="cl-remove-actions">
            <button className="btn btn-sm" disabled={busy} onClick={() => setAsk(null)}>Annuler</button>
            <button className="btn btn-sm btn-danger" disabled={busy} onClick={() => void remove(target.id)} data-testid="collab-remove-go">
              Retirer {target.name}
            </button>
          </div>
        </div>
      ) : (
        <p className="cl-count">{members.length} sur {max}</p>
      )}
    </div>
  );
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

function Frame({ title, onClose, children, testid, foot = true }: { title: string; onClose: () => void; children: React.ReactNode; testid: string; foot?: boolean }) {
  useEscape(onClose);
  const internet = useInternetOk();
  return createPortal(
    <div className="wr-back anim-fade" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="wr-dialog cl-dialog panel anim-scale" role="dialog" aria-modal="true" aria-labelledby="cl-title" data-testid={testid}>
        <header className="wr-head">
          <h2 id="cl-title">{title}</h2>
          <button className="icon-btn sm" onClick={onClose} aria-label="Fermer" title="Fermer">
            <X size={16} />
          </button>
        </header>
        {children}
        {foot && (
          <footer className="wr-foot">
            <Lock size={13} />
            <span>{internet ? 'Chiffré de bout en bout, sur votre réseau ou par Internet.' : 'Chiffré, sur votre réseau local, sans Internet.'}</span>
          </footer>
        )}
      </div>
    </div>,
    document.body,
  );
}

// ── Invité, fin de session : garder l'espace reçu, ou non ─────
function KeepDialog() {
  const a = useCollab((s) => s.afterSession)!;
  const keep = () => useCollab.setState({ afterSession: null });
  const kinds: { k: WorkspaceItemKind | 'highlight'; icon: JSX.Element; one: string; many: string }[] = [
    { k: 'draft', icon: <FilePen size={13} />, one: 'écrit', many: 'écrits' },
    { k: 'map', icon: <Network size={13} />, one: 'carte', many: 'cartes' },
    { k: 'book', icon: <BookOpen size={13} />, one: 'livre', many: 'livres' },
    { k: 'plan', icon: <ListTree size={13} />, one: 'plan', many: 'plans' },
    { k: 'argument', icon: <Sigma size={13} />, one: 'argument', many: 'arguments' },
    { k: 'study', icon: <ScrollText size={13} />, one: 'fiche', many: 'fiches' },
    { k: 'highlight', icon: <Highlighter size={13} />, one: 'extrait', many: 'extraits' },
  ];
  const what = kinds.map((x) => ({ ...x, n: a.targets.filter((t) => t.kind === x.k).length })).filter((x) => x.n > 0);
  const drop = () => {
    // Le message « N éléments placés dans la corbeille — Annuler » vient de la corbeille elle-même.
    void session().then((m) => m.dropSharedWorkspace());
  };
  return (
    <Frame title="Fin du travail à plusieurs" onClose={keep} testid="collab-keep" foot={false}>
      <div className="cl-body">
        <p className="cl-keep-lede">
          Garder « {a.name} » sur cet ordinateur ? <span>L’espace vient de {a.hostName}.</span>
        </p>
        <div className="cl-keep-ways">
          <button className="cl-keep-way is-keep" onClick={keep} data-testid="collab-keep-keep">
            <span className="cl-keep-art" aria-hidden="true">
              <span className="cl-keep-node">
                <Folder size={15} />
                <span className="cl-keep-node-name">{a.name}</span>
                <span className="cl-keep-check">
                  <Check size={11} strokeWidth={3} />
                </span>
              </span>
            </span>
            <strong>Garder l’espace</strong>
            <span>Il reste ici, à jour. La prochaine fois, vos changements seront réunis.</span>
          </button>
          <button className="cl-keep-way is-drop" onClick={drop} data-testid="collab-keep-drop">
            <span className="cl-keep-art" aria-hidden="true">
              <span className="cl-keep-bin">
                <Trash2 size={30} strokeWidth={1.4} />
                <span className="cl-keep-days">30 j</span>
              </span>
            </span>
            <strong>Ne pas garder</strong>
            <span>Tout va dans la corbeille : 30 jours pour changer d’avis.</span>
            {what.length > 0 && (
              <span className="cl-keep-what">
                {what.map((x) => (
                  <span key={x.k}>
                    {x.icon} {x.n} {x.n > 1 ? x.many : x.one}
                  </span>
                ))}
              </span>
            )}
          </button>
        </div>
        <p className="cl-keep-note">Ce qui était déjà dans votre bibliothèque avant la session reste, dans tous les cas.</p>
      </div>
    </Frame>
  );
}

// ── Hôte ─────────────────────────────────────────────────────
function CollabPanel({ workspaceId, onClose }: { workspaceId: string; onClose: () => void }) {
  const ws = useStore((s) => s.workspaces.find((w) => w.id === workspaceId));
  const c = useCollab();
  const live = isLiveIn(c, workspaceId);
  const [profile, setProfile] = useState<CollabProfile>(() => readProfile() ?? { name: '', color: COLLAB_COLORS[0] });
  const [places, setPlaces] = useState(readPlaces);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!ws) return null;

  let content: JSX.Element;
  if (c.role && !live && c.workspaceId) {
    const other = useStore.getState().workspaces.find((w) => w.id === c.workspaceId)?.name ?? 'un autre espace';
    content = (
      <div className="cl-body">
        <p className="cl-lede">Vous travaillez déjà à plusieurs dans « {other} ». Arrêtez cette session pour en ouvrir une ici.</p>
        <div className="sh-actions">
          <span className="spacer" />
          <button className="btn" onClick={() => void stopCollab()}>{c.role === 'host' ? 'Arrêter le partage' : 'Quitter la session'}</button>
        </div>
      </div>
    );
  } else if (!live) {
    const start = async () => {
      const p = { name: profile.name.trim(), color: profile.color };
      if (!p.name) return setError('Indiquez votre prénom : il s’affiche à côté de votre curseur.');
      writeProfile(p);
      setBusy(true);
      setError(null);
      try {
        writePlaces(places);
        await (await session()).startHost(workspaceId, p, places);
      } catch (e) {
        setError(errorMessage(e));
      } finally {
        setBusy(false);
      }
    };
    content = (
      <div className="cl-body" data-testid="collab-start">
        <div className="cl-hero">
          <h3>« {ws.name} », en direct</h3>
          <ul className="cl-live-what" aria-label="Ce qui se modifie à plusieurs">
            <li><FilePen size={16} /> Écrits</li>
            <li><Network size={16} /> Cartes</li>
            <li><Highlighter size={16} /> Extraits</li>
            <li><Users size={16} /> Jusqu’à {places}</li>
          </ul>
        </div>
        <Who profile={profile} setProfile={setProfile} />
        <Places value={places} onChange={setPlaces} />
        <div className="sh-actions">
          <button className="btn" onClick={onClose}>Annuler</button>
          <span className="spacer" />
          <button className="btn btn-primary" disabled={busy || c.phase === 'starting'} onClick={() => void start()} data-testid="collab-open">
            {busy ? 'Ouverture…' : 'Ouvrir la session'}
          </button>
        </div>
        {(error || c.error) && <p className="sh-error" role="alert">{error || c.error}</p>}
      </div>
    );
  } else if (c.role === 'host') {
    const n = c.members.length;
    content = (
      <div className="cl-body" data-testid="collab-live">
        {c.codeState === 'open' && c.code ? (
          <>
            <BigCode code={c.code} testid="collab-code" copy />
            {c.internet && (
              <p className="sh-small center cl-anywhere" data-testid="collab-internet">
                Même sans être sur le même Wi-Fi : le code suffit, d’où que l’on soit.
              </p>
            )}
            {c.requests.length === 0 && (
              <Steps
                items={[
                  { icon: <Upload size={18} />, label: 'Importer' },
                  { icon: <Users size={18} />, label: 'Rejoindre un espace partagé' },
                  { icon: <span className="br-step-code">{c.code.slice(0, 3)}</span>, label: <>Saisir <strong>{c.code.slice(0, 3)}-{c.code.slice(3)}</strong></> },
                ]}
              />
            )}
          </>
        ) : (
          <p className="sh-warn" role="status" data-testid="collab-code-closed">
            Trop d’essais avec un mauvais code : ce code a été fermé par sécurité. Les présents restent ; donnez un nouveau code aux suivants.
            <button className="btn btn-sm" onClick={() => void session().then((m) => m.newCode())}>
              <RefreshCw size={13} /> Nouveau code
            </button>
          </p>
        )}
        {c.requests.map((r) => (
          <Ask key={r.reqId} r={r} />
        ))}
        <People members={c.members} me={c.me} canRemove />
        <Places
          value={c.maxPeople}
          min={Math.max(2, n)}
          onChange={(v) => {
            writePlaces(v);
            void session().then((m) => m.setMaxPeople(v));
          }}
        />
        {n >= c.maxPeople && <p className="sh-note">Session complète : ajoutez une place pour accueillir quelqu’un d’autre.</p>}
        <Trouble address={c.addresses[0]} internet={c.internet} />
        <div className="sh-actions">
          <button className="btn" onClick={onClose}>Fermer</button>
          <span className="spacer" />
          <button className="btn btn-danger" disabled={c.phase === 'stopping'} onClick={() => void stopCollab()} data-testid="collab-stop">
            {c.phase === 'stopping' ? 'Arrêt…' : 'Arrêter le partage'}
          </button>
        </div>
      </div>
    );
  } else {
    content = (
      <div className="cl-body" data-testid="collab-live">
        <p className="cl-lede">
          {c.phase === 'reconnecting' ? 'Connexion perdue : vous continuez seul, Marginalia se reconnecte…' : <>En direct dans « {ws.name} »</>}
        </p>
        <People members={c.members} me={c.me} />
        <div className="sh-actions">
          <button className="btn" onClick={onClose}>Fermer</button>
          <span className="spacer" />
          <button className="btn" onClick={() => void stopCollab()} data-testid="collab-leave">Quitter la session</button>
        </div>
      </div>
    );
  }
  return (
    <Frame title="Travailler à plusieurs" onClose={onClose} testid="collab-dialog">
      {content}
    </Frame>
  );
}

// ── Invité ───────────────────────────────────────────────────
type JoinStep = { s: 'form' } | { s: 'finding' } | { s: 'asking'; title: string; device: string; host: string } | { s: 'arriving'; title: string };

function JoinDialog({ onClose }: { onClose: () => void }) {
  const c = useCollab();
  const [profile, setProfile] = useState<CollabProfile>(() => readProfile() ?? { name: '', color: COLLAB_COLORS[1] });
  const [code, setCode] = useState('');
  const [manual, setManual] = useState(false);
  const [address, setAddress] = useState('');
  const [step, setStep] = useState<JoinStep>({ s: 'form' });
  const [error, setError] = useState<string | null>(null);
  // Après un code faux ou introuvable : 10 s avant d'en essayer un autre (compte à rebours).
  const [waitUntil, setWaitUntil] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const waitLeft = Math.max(0, Math.ceil((waitUntil - now) / 1000));
  useEffect(() => {
    if (!waitUntil || Date.now() >= waitUntil) return;
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, [waitUntil]);
  const internet = useInternetOk();
  const alive = useRef(true);
  useEffect(
    () => () => {
      alive.current = false;
    },
    [],
  );
  // Arrivée terminée : la fenêtre se ferme (l'espace est ouvert).
  useEffect(() => {
    if (step.s === 'arriving' && c.phase === 'live' && c.role === 'guest') onClose();
  }, [step.s, c.phase, c.role, onClose]);

  const go = async (digits = code) => {
    const p = { name: profile.name.trim(), color: profile.color };
    if (!p.name) return setError('Indiquez votre prénom : il s’affiche à côté de votre curseur.');
    if (digits.length !== 6 || waitUntil > Date.now()) return;
    writeProfile(p);
    setError(null);
    setStep({ s: 'finding' });
    try {
      const m = await session();
      const found = await m.guestFind(digits, manual && address.trim() ? address.trim() : undefined, p);
      if (!alive.current) return;
      const title = String(found.meta.title ?? 'Espace partagé');
      setStep({ s: 'asking', title, device: found.from.name, host: found.from.host });
      await m.guestJoin(found.ticket, p, found.from.host);
      if (alive.current) setStep({ s: 'arriving', title });
    } catch (e) {
      if (!alive.current) return;
      setError(errorMessage(e));
      setStep({ s: 'form' });
      const m = await session();
      const left = await m.guestWaitLeft();
      if (alive.current && left > 0) {
        setNow(Date.now());
        setWaitUntil(Date.now() + left * 1000);
      }
    }
  };
  const onCode = (raw: string) => {
    const only = raw.replace(/\D/g, '').slice(0, 6);
    setCode(only);
    setError(null);
  };

  let content: JSX.Element;
  if (step.s === 'form' || step.s === 'finding') {
    const finding = step.s === 'finding';
    content = (
      <div className="cl-body" data-testid="join-form">
        <Who profile={profile} setProfile={setProfile} />
        <Steps
          items={[
            { icon: <MoreHorizontal size={18} />, label: 'Menu de l’espace' },
            { icon: <Users size={18} />, label: 'Travailler à plusieurs' },
            { icon: <span className="br-step-code">123</span>, label: 'Le code s’affiche' },
          ]}
        />
        <input
          className="sh-code-input"
          inputMode="numeric"
          autoComplete="one-time-code"
          placeholder="000-000"
          maxLength={9}
          value={dashed(code)}
          aria-label="Code à 6 chiffres"
          disabled={finding}
          onChange={(e) => onCode(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && code.length === 6 && !waitLeft && void go()}
          spellCheck={false}
          data-testid="join-code"
        />
        {manual && (
          <label className="sh-addr">
            <span>Adresse affichée par l’hôte</span>
            <input type="text" value={address} onChange={(e) => setAddress(e.target.value)} placeholder="192.168.1.20:47804" spellCheck={false} autoCapitalize="off" data-testid="join-address" />
          </label>
        )}
        {finding ? (
          <p className="sh-small center" aria-live="polite">{internet && !manual ? 'Recherche sur le réseau et par Internet…' : 'Recherche sur le réseau…'}</p>
        ) : (
          <div className="sh-actions">
            <Trouble summary="Rien n’est trouvé ?" internet={internet}>
              <button className="sh-link" onClick={() => setManual((m) => !m)}>{manual ? 'Chercher sur le réseau' : 'Saisir une adresse'}</button>
            </Trouble>
            <span className="spacer" />
            <button className="btn btn-primary" disabled={code.length !== 6 || waitLeft > 0} onClick={() => void go()} data-testid="join-go">
              {waitLeft > 0 ? `Rejoindre (${waitLeft} s)` : 'Rejoindre'}
            </button>
          </div>
        )}
        {error && <p className="sh-error" role="alert" data-testid="join-error">{error}</p>}
      </div>
    );
  } else if (step.s === 'asking') {
    content = (
      <div className="cl-body" data-testid="join-asking">
        <Bridge state="ask" left="Vous" leftFace={{ letter: (profile.name.trim().charAt(0) || '?').toUpperCase(), color: profile.color }} right={`${step.host} · ${step.device}`} rightFace={{ letter: step.host.charAt(0).toUpperCase(), color: 'var(--ink-2)' }} />
        <section className="sh-sum center">
          <h3>{step.title}</h3>
          <p className="sh-small" aria-live="polite">{step.host} doit accepter votre demande…</p>
        </section>
        <div className="sh-actions">
          <span className="spacer" />
          <button className="btn" onClick={() => void stopCollab().finally(onClose)}>Annuler</button>
        </div>
      </div>
    );
  } else {
    content = (
      <div className="cl-body" data-testid="join-arriving">
        <Bridge state="flow" left="Vous" leftFace={{ letter: (profile.name.trim().charAt(0) || '?').toUpperCase(), color: profile.color }} right="L’hôte" />
        <section className="sh-sum center">
          <h3>
            <Check size={18} className="sh-inline" /> {step.title}
          </h3>
          <p className="sh-small" role="progressbar">{c.progress ?? 'Réception de l’espace…'}</p>
        </section>
      </div>
    );
  }
  return (
    <Frame title="Rejoindre un espace partagé" onClose={onClose} testid="join-dialog">
      {content}
    </Frame>
  );
}

// ── Réunion : un paragraphe ou un texte modifié des deux côtés ─────────────
/** Mots qui diffèrent entre deux versions (plus longue sous-suite commune, mot à mot). */
function diffMarks(a: string, b: string): [Set<number>, Set<number>] {
  const ta = a.split(/(\s+)/);
  const tb = b.split(/(\s+)/);
  const wa = ta.map((t, i) => [t, i] as const).filter(([t]) => t && !/^\s+$/.test(t));
  const wb = tb.map((t, i) => [t, i] as const).filter(([t]) => t && !/^\s+$/.test(t));
  const ma = new Set<number>();
  const mb = new Set<number>();
  if (wa.length * wb.length > 250_000) return [ma, mb];
  const L = Array.from({ length: wa.length + 1 }, () => new Uint16Array(wb.length + 1));
  for (let i = wa.length - 1; i >= 0; i--) for (let j = wb.length - 1; j >= 0; j--) L[i][j] = wa[i][0] === wb[j][0] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const ka = new Set<number>();
  const kb = new Set<number>();
  for (let i = 0, j = 0; i < wa.length && j < wb.length; ) {
    if (wa[i][0] === wb[j][0]) (ka.add(wa[i][1]), kb.add(wb[j][1]), i++, j++);
    else if (L[i + 1][j] >= L[i][j + 1]) i++;
    else j++;
  }
  wa.forEach(([, i]) => !ka.has(i) && ma.add(i));
  wb.forEach(([, i]) => !kb.has(i) && mb.add(i));
  return [ma, mb];
}

/** Texte avec les mots propres à cette version surlignés (le texte affiché reste exactement le texte). */
function Marked({ text, marks, color }: { text: string; marks: Set<number>; color: string }) {
  if (!text) return <em>(vide)</em>;
  return (
    <>
      {text.split(/(\s+)/).map((t, i) =>
        marks.has(i) ? (
          <mark key={i} className="cl-diff" style={{ ['--who' as string]: color }}>
            {t}
          </mark>
        ) : (
          <span key={i}>{t}</span>
        ),
      )}
    </>
  );
}

function ReunionDialog() {
  const r = useCollab((s) => s.reunion)!;
  const me = readProfile() ?? { name: 'Vous', color: COLLAB_COLORS[0] };
  const otherColor = me.color === COLLAB_COLORS[1] ? COLLAB_COLORS[0] : COLLAB_COLORS[1];
  const [choices, setChoices] = useState<Record<string, Choice>>({});
  const done = Object.keys(choices).length;
  const all = r.items.every((i) => choices[i.id]);
  const set = (id: string, c: Choice) => setChoices((x) => ({ ...x, [id]: c }));
  return createPortal(
    <div className="wr-back anim-fade">
      <div className="wr-dialog cl-dialog cl-reunion panel anim-scale" role="dialog" aria-modal="true" aria-labelledby="cl-reu-title" data-testid="reunion-dialog">
        <header className="wr-head">
          <h2 id="cl-reu-title">Réunir avec {r.hostName}</h2>
        </header>
        <div className="cl-body">
          <div className="cl-reu-intro">
            <span className="cl-pair" aria-hidden="true">
              <span className="cl-seat-face" style={{ background: me.color }}>{(me.name.charAt(0) || 'V').toUpperCase()}</span>
              <span className="cl-seat-face" style={{ background: otherColor }}>{r.hostName.charAt(0).toUpperCase()}</span>
            </span>
            <p>
              <strong>{r.items.length > 1 ? `${r.items.length} passages modifiés` : '1 passage modifié'} des deux côtés.</strong> Le reste est déjà réuni, et une version d’avant est gardée.
            </p>
            <ol className="cl-dots" aria-label={`${done} sur ${r.items.length} choisis`}>
              {r.items.map((it) => (
                <li key={it.id} className={choices[it.id] ? 'on' : ''} />
              ))}
            </ol>
          </div>
          {r.items.map((it) => {
            const ch = choices[it.id];
            const [ma, mb] = diffMarks(it.mine, it.theirs);
            return (
              <section key={it.id} className="cl-conflict" data-testid="reunion-item" data-kind={it.kind}>
                <p className="cl-where">
                  {it.kind === 'paragraph' ? <FilePen size={14} /> : <Network size={14} />} {it.where}
                </p>
                <div className="cl-versions">
                  <div className={`cl-version${ch === 'mine' || ch === 'both' ? ' kept' : ''}${ch === 'theirs' ? ' dropped' : ''}`} style={{ ['--who' as string]: me.color }} onClick={() => set(it.id, 'mine')}>
                    <span className="cl-version-who">
                      <span className="cl-seat-face" style={{ background: me.color }}>{(me.name.charAt(0) || 'V').toUpperCase()}</span> Vous
                      {(ch === 'mine' || ch === 'both') && <Check size={15} className="cl-kept-mark" />}
                    </span>
                    <p data-testid="reunion-mine"><Marked text={it.mine} marks={ma} color={me.color} /></p>
                    <button className={`btn btn-sm ${ch === 'mine' ? 'btn-primary' : ''}`} role="radio" aria-checked={ch === 'mine'} onClick={(e) => (e.stopPropagation(), set(it.id, 'mine'))} data-choice="mine">
                      Garder la mienne
                    </button>
                  </div>
                  <div className={`cl-version${ch === 'theirs' || ch === 'both' ? ' kept' : ''}${ch === 'mine' ? ' dropped' : ''}`} style={{ ['--who' as string]: otherColor }} onClick={() => set(it.id, 'theirs')}>
                    <span className="cl-version-who">
                      <span className="cl-seat-face" style={{ background: otherColor }}>{r.hostName.charAt(0).toUpperCase()}</span> {r.hostName}
                      {(ch === 'theirs' || ch === 'both') && <Check size={15} className="cl-kept-mark" />}
                    </span>
                    <p data-testid="reunion-theirs"><Marked text={it.theirs} marks={mb} color={otherColor} /></p>
                    <button className={`btn btn-sm ${ch === 'theirs' ? 'btn-primary' : ''}`} role="radio" aria-checked={ch === 'theirs'} onClick={(e) => (e.stopPropagation(), set(it.id, 'theirs'))} data-choice="theirs">
                      {`Garder celle de ${r.hostName}`}
                    </button>
                  </div>
                </div>
                <button className={`cl-both${ch === 'both' ? ' on' : ''}`} role="radio" aria-checked={ch === 'both'} onClick={() => set(it.id, 'both')} data-choice="both">
                  Garder les deux
                </button>
              </section>
            );
          })}
          <div className="sh-actions">
            <span className="cl-count">{done} sur {r.items.length} choisi{r.items.length > 1 ? 's' : ''}</span>
            <span className="spacer" />
            <button className="btn btn-primary" disabled={!all} onClick={() => r.resolve(choices)} data-testid="reunion-go">
              Réunir
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
