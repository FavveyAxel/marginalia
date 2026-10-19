// Fenêtres de « Travailler à plusieurs », montées une fois pour toute l'application :
//  - « Travailler à plusieurs » (hôte) : prénom et couleur, puis le code « 735-700 », les présents,
//    les demandes à accepter, « Arrêter le partage » ;
//  - « Rejoindre un espace partagé » (invité) : prénom et couleur, code, attente de l'accord, arrivée ;
//  - les demandes reçues quand la fenêtre de l'hôte est fermée (en bas à droite).
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, Lock, RefreshCw, Users, X } from 'lucide-react';
import { host, type CollabMember, type CollabRequest } from '../../lib/platform';
import { useStore } from '../../lib/store';
import { errorMessage, hotspotHint } from '../share/shareUi';
import type { Choice } from './docxMerge';
import { COLLAB_COLORS, dashed, isLiveIn, readProfile, stopCollab, useCollab, writeProfile, type CollabProfile } from './collabState';
import '../inbox/inbox.css';
import '../share/share.css';
import './collab.css';

const session = () => import('./session');

export function CollabHost() {
  const panelFor = useCollab((s) => s.panelFor);
  const joinOpen = useCollab((s) => s.joinOpen);
  const requests = useCollab((s) => s.requests);
  const role = useCollab((s) => s.role);
  const reunion = useCollab((s) => s.reunion);
  const ready = useStore((s) => s.ready);
  useEffect(() => {
    if (ready) void import('./memory').then((m) => m.initMemory());
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
      <p>
        <span className="cl-face" style={{ background: r.color }} aria-hidden="true">{r.name.charAt(0).toUpperCase()}</span>
        <span>
          <strong>{r.device}</strong> demande à rejoindre « {title} »
        </span>
      </p>
      <p className="cl-ask-sub">Prénom : {r.name} · adresse {r.address}. N’acceptez que si vous savez qui c’est : cette personne pourra tout lire et tout modifier dans l’espace.</p>
      <div className="cl-ask-actions">
        <button className="btn" disabled={busy} onClick={() => act(false)} data-testid="collab-reject">Refuser</button>
        <button className="btn btn-primary" disabled={busy} onClick={() => act(true)} data-testid="collab-accept">Accepter</button>
      </div>
    </div>
  );
}

function Who({ profile, setProfile }: { profile: CollabProfile; setProfile: (p: CollabProfile) => void }) {
  return (
    <div className="cl-who">
      <label>
        <span>Votre prénom, montré aux autres</span>
        <input type="text" value={profile.name} maxLength={40} onChange={(e) => setProfile({ ...profile, name: e.target.value })} placeholder="Léa" spellCheck={false} data-testid="collab-name" autoFocus />
      </label>
      <div>
        <span className="cl-person-meta">Votre couleur, celle de votre curseur chez les autres</span>
        <div className="cl-swatches" role="radiogroup" aria-label="Votre couleur">
          {COLLAB_COLORS.map((c) => (
            <button key={c} className="cl-swatch" style={{ background: c }} role="radio" aria-checked={profile.color === c} aria-label={`Couleur ${c}`} onClick={() => setProfile({ ...profile, color: c })} data-color={c} />
          ))}
        </div>
      </div>
    </div>
  );
}

function People({ members, me }: { members: CollabMember[]; me: string | null }) {
  return (
    <ul className="cl-people" data-testid="collab-people">
      {members.map((m) => (
        <li key={m.id} className="cl-person" data-member={m.name}>
          <span className="cl-face" style={{ background: m.color }} aria-hidden="true">{m.name.charAt(0).toUpperCase()}</span>
          <span>
            <span className="cl-person-name">{m.name}</span> <span className="cl-person-meta">· {m.device}</span>
          </span>
          <span className="spacer" />
          {m.host && <span className="cl-tag">hôte</span>}
          {m.id === me && <span className="cl-tag">vous</span>}
          {m.state === 'away' && <span className="cl-tag away">connexion perdue</span>}
        </li>
      ))}
    </ul>
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

function Frame({ title, onClose, children, testid }: { title: string; onClose: () => void; children: React.ReactNode; testid: string }) {
  useEscape(onClose);
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
        <footer className="wr-foot">
          <Lock size={13} />
          <span>
            Tout passe chiffré par votre réseau local, jamais par Internet. Six personnes au plus, hôte compris.
            {host.platform === 'win32' && ' Sous Windows, si une fenêtre du pare-feu s’ouvre, autorisez Marginalia sur les réseaux privés.'}
            {host.platform === 'darwin' && ' Sur Mac, autorisez Marginalia à accéder au réseau local si le système le demande.'}
          </span>
        </footer>
      </div>
    </div>,
    document.body,
  );
}

// ── Hôte ─────────────────────────────────────────────────────
function CollabPanel({ workspaceId, onClose }: { workspaceId: string; onClose: () => void }) {
  const ws = useStore((s) => s.workspaces.find((w) => w.id === workspaceId));
  const c = useCollab();
  const live = isLiveIn(c, workspaceId);
  const [profile, setProfile] = useState<CollabProfile>(() => readProfile() ?? { name: '', color: COLLAB_COLORS[0] });
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
        await (await session()).startHost(workspaceId, p);
      } catch (e) {
        setError(errorMessage(e));
      } finally {
        setBusy(false);
      }
    };
    content = (
      <div className="cl-body" data-testid="collab-start">
        <p className="cl-lede">
          Invitez jusqu’à cinq personnes du même réseau à travailler <strong>en direct</strong> dans « {ws.name} » : écrits, cartes, extraits et groupes. Vous verrez leurs curseurs. Chacun garde son exemplaire quand vous arrêtez.
        </p>
        <Who profile={profile} setProfile={setProfile} />
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
            <p className="cl-lede">Sur l’autre ordinateur : <strong>Importer › Rejoindre un espace partagé</strong>, puis saisissez ce code. Vous accepterez chaque demande.</p>
            <div className="sh-code" data-testid="collab-code" data-code={c.code} aria-label={`Code ${c.code.split('').join(' ')}`}>
              {c.code.slice(0, 3)}
              <span className="sh-dash" aria-hidden="true">-</span>
              {c.code.slice(3)}
            </div>
            {c.addresses.length > 0 && <p className="sh-left">Si l’autre ordinateur ne trouve pas la session : adresse <span className="sh-mono">{c.addresses[0]}</span></p>}
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
        <p className="cl-section-title">Présents · {n} sur 6</p>
        <People members={c.members} me={c.me} />
        <p className="sh-hint">{hotspotHint(host.platform)}</p>
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
          {c.phase === 'reconnecting' ? 'Connexion perdue : vous continuez seul, Marginalia se reconnecte…' : <>Vous travaillez en direct dans « {ws.name} ».</>}
        </p>
        <p className="cl-section-title">Présents · {c.members.length} sur 6</p>
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
    if (digits.length !== 6) return;
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
        <p className="cl-lede">Sur l’ordinateur de l’hôte : menu <strong>⋯</strong> de l’espace › <strong>Travailler à plusieurs…</strong> Saisissez ici le code qui s’affiche ; l’hôte acceptera votre demande.</p>
        <Who profile={profile} setProfile={setProfile} />
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
          onKeyDown={(e) => e.key === 'Enter' && code.length === 6 && void go()}
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
          <div className="wr-status" aria-live="polite"><span className="wr-pulse" aria-hidden="true" /> Recherche sur le réseau…</div>
        ) : (
          <div className="sh-actions">
            <button className="sh-link" onClick={() => setManual((m) => !m)}>{manual ? 'Chercher sur le réseau' : 'Saisir une adresse'}</button>
            <span className="spacer" />
            <button className="btn btn-primary" disabled={code.length !== 6} onClick={() => void go()} data-testid="join-go">Rejoindre</button>
          </div>
        )}
        <p className="sh-hint">{hotspotHint(host.platform)}</p>
        {error && <p className="sh-error" role="alert" data-testid="join-error">{error}</p>}
      </div>
    );
  } else if (step.s === 'asking') {
    content = (
      <div className="cl-body" data-testid="join-asking">
        <section className="sh-sum">
          <span className="sh-kicker">Espace partagé par {step.host}</span>
          <h3>{step.title}</h3>
          <p className="sh-note"><Users size={13} /> Sur {step.device}</p>
        </section>
        <div className="wr-status" aria-live="polite"><span className="wr-pulse" aria-hidden="true" /> Demande envoyée : {step.host} doit l’accepter…</div>
        <div className="sh-actions">
          <span className="spacer" />
          <button className="btn" onClick={() => void stopCollab().finally(onClose)}>Annuler</button>
        </div>
      </div>
    );
  } else {
    content = (
      <div className="cl-body" data-testid="join-arriving">
        <section className="sh-sum">
          <span className="sh-kicker"><Check size={12} className="sh-inline" />Accepté</span>
          <h3>{step.title}</h3>
        </section>
        <div className="sh-bar indeterminate" role="progressbar"><span style={{ width: '35%' }} /></div>
        <p className="sh-small">{c.progress ?? 'Réception de l’espace…'}</p>
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
function ReunionDialog() {
  const r = useCollab((s) => s.reunion)!;
  const [choices, setChoices] = useState<Record<string, Choice>>({});
  const all = r.items.every((i) => choices[i.id]);
  const set = (id: string, c: Choice) => setChoices((x) => ({ ...x, [id]: c }));
  return createPortal(
    <div className="wr-back anim-fade">
      <div className="wr-dialog cl-dialog cl-reunion panel anim-scale" role="dialog" aria-modal="true" aria-labelledby="cl-reu-title" data-testid="reunion-dialog">
        <header className="wr-head">
          <h2 id="cl-reu-title">Réunir avec {r.hostName}</h2>
        </header>
        <div className="cl-body">
          <p className="cl-lede">
            Vous avez travaillé chacun de votre côté. Tout ce qui n’a changé que d’un côté est déjà réuni. {r.items.length > 1 ? `Ces ${r.items.length} passages ont été modifiés des deux côtés` : 'Ce passage a été modifié des deux côtés'} : choisissez ce que vous gardez. Une version « Avant la reconnexion avec {r.hostName} » garde chaque écrit tel qu’il était chez vous.
          </p>
          {r.items.map((it) => (
            <section key={it.id} className="cl-conflict" data-testid="reunion-item" data-kind={it.kind}>
              <p className="cl-section-title">
                {it.kind === 'paragraph' ? 'Paragraphe' : 'Texte'} de {it.where}
              </p>
              <div className="cl-versions">
                <div className={`cl-version ${choices[it.id] === 'mine' || choices[it.id] === 'both' ? 'kept' : ''}`}>
                  <span className="sh-kicker">Votre version</span>
                  <p data-testid="reunion-mine">{it.mine || <em>(vide)</em>}</p>
                </div>
                <div className={`cl-version ${choices[it.id] === 'theirs' || choices[it.id] === 'both' ? 'kept' : ''}`}>
                  <span className="sh-kicker">Version de {r.hostName}</span>
                  <p data-testid="reunion-theirs">{it.theirs || <em>(vide)</em>}</p>
                </div>
              </div>
              <div className="cl-choices" role="radiogroup" aria-label="Que garder ?">
                {(
                  [
                    ['mine', 'Garder la mienne'],
                    ['theirs', `Garder celle de ${r.hostName}`],
                    ['both', 'Garder les deux'],
                  ] as [Choice, string][]
                ).map(([c, l]) => (
                  <button key={c} className={`btn btn-sm ${choices[it.id] === c ? 'btn-primary' : ''}`} role="radio" aria-checked={choices[it.id] === c} onClick={() => set(it.id, c)} data-choice={c}>
                    {l}
                  </button>
                ))}
              </div>
            </section>
          ))}
          <div className="sh-actions">
            <span className="cl-count">{Object.keys(choices).length} sur {r.items.length} choisi{r.items.length > 1 ? 's' : ''}</span>
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
