// Espaces chiffrés : écran d'un espace verrouillé, bandeau d'un espace déverrouillé, et fenêtres
// (chiffrer un espace, retirer le chiffrement, mot de passe et Touch ID).
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Check, Copy, Fingerprint, KeyRound, Lock, LockOpen, ShieldCheck } from 'lucide-react';
import { useStore } from '../../lib/store';
import { host } from '../../lib/platform';
import { Modal } from '../workspaces/wsUi';
import { decryptSpace, encryptSpace, lockSpace, openSpaceDialog, refreshSpaceStatus, setupSpaces, unlockSpace, useSpaceUi } from './spaceActions';
import './spaces.css';

const PASSWORD_MIN = 8;

/** Autour de la vue d'un espace : écran de déverrouillage s'il est verrouillé, bandeau s'il est ouvert. */
export function SpaceGate({ workspaceId, children }: { workspaceId: string; children: ReactNode }) {
  const ws = useStore((s) => s.workspaces.find((w) => w.id === workspaceId));
  const open = useStore((s) => s.unlockedSpaces.includes(workspaceId));
  const [busy, setBusy] = useState(false);
  if (!ws?.encrypted) return <>{children}</>;
  if (!open) return <SpaceLockPanel workspaceId={workspaceId} name={ws.name} />;
  return (
    <div className="sp-open">
      <div className="sp-bar" data-testid="space-bar">
        <LockOpen size={14} />
        <span>Espace chiffré, déverrouillé. Son contenu n’est lisible que pendant qu’il est ouvert.</span>
        <button
          className="btn btn-sm"
          disabled={busy}
          aria-busy={busy}
          data-testid="space-lock"
          onClick={async () => {
            setBusy(true);
            const r = await lockSpace(workspaceId);
            setBusy(false);
            if (!r.ok) useStore.getState().toast(r.error, 'error');
          }}
        >
          <Lock size={13} /> {busy ? 'Verrouillage…' : 'Verrouiller'}
        </button>
      </div>
      {children}
    </div>
  );
}

function SpaceLockPanel({ workspaceId, name }: { workspaceId: string; name: string }) {
  const touch = useSpaceUi((s) => s.touchId);
  const [secret, setSecret] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    void refreshSpaceStatus();
    setSecret('');
    setError(null);
    setTimeout(() => input.current?.focus(), 30);
  }, [workspaceId]);
  const go = async (value: string | null) => {
    setBusy(true);
    setError(null);
    const r = await unlockSpace(workspaceId, value);
    setBusy(false);
    if (!r.ok) {
      setError(r.waitMs ? `${r.error} Nouvel essai possible dans ${Math.ceil(r.waitMs / 1000)} s.` : r.error);
      setSecret('');
      input.current?.focus();
    }
  };
  return (
    <div className="sp-locked anim-view" data-testid="space-locked">
      <form
        className="sp-locked-card"
        onSubmit={(e) => {
          e.preventDefault();
          if (secret && !busy) void go(secret);
        }}
      >
        <div className="sp-locked-icon">
          <Lock size={22} strokeWidth={1.8} />
        </div>
        <h2>« {name} » est verrouillé</h2>
        <p>Cet espace est chiffré. Son contenu n’apparaît ni dans la recherche, ni dans la révision, ni dans le journal tant qu’il est verrouillé.</p>
        <input
          ref={input}
          className="input"
          type="password"
          autoComplete="off"
          spellCheck={false}
          placeholder="Mot de passe des espaces chiffrés"
          aria-label="Mot de passe des espaces chiffrés"
          value={secret}
          onChange={(e) => setSecret(e.target.value)}
          disabled={busy}
          data-testid="space-password"
        />
        {error && (
          <p className="sp-error" role="alert" data-testid="space-error">
            {error}
          </p>
        )}
        <button className="btn btn-primary" type="submit" disabled={!secret || busy} aria-busy={busy} data-testid="space-unlock">
          {busy ? 'Déverrouillage…' : 'Déverrouiller'}
        </button>
        {touch.available && touch.enabled && (
          <button type="button" className="btn" disabled={busy} onClick={() => void go(null)} data-testid="space-touchid">
            <Fingerprint size={15} /> Utiliser Touch ID
          </button>
        )}
        <p className="sp-hint">Mot de passe oublié : saisissez à la place votre clé de secours (32 caractères).</p>
      </form>
    </div>
  );
}

function KeyBox({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="sp-keybox">
      <div className="sp-key selectable" data-testid="space-recovery" data-key={value}>
        {value}
      </div>
      <button
        type="button"
        className="btn btn-sm"
        onClick={async () => {
          await navigator.clipboard.writeText(value).catch(() => {});
          setCopied(true);
        }}
      >
        {copied ? <Check size={14} /> : <Copy size={14} />} {copied ? 'Copiée' : 'Copier'}
      </button>
    </div>
  );
}

function EncryptDialog({ wsId, onClose }: { wsId: string; onClose: () => void }) {
  const ws = useStore((s) => s.workspaces.find((w) => w.id === wsId));
  const configured = useSpaceUi((s) => s.configured);
  const keysLost = useSpaceUi((s) => s.keysLost);
  const anyOpen = useStore((s) => s.unlockedSpaces.length > 0);
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recovery, setRecovery] = useState<string | null>(null);
  const [kept, setKept] = useState(false);
  if (!ws || configured === null) return null;
  if (keysLost)
    return (
      <Modal title="Chiffrer cet espace" onClose={onClose}>
        <div className="sp-dialog" data-testid="space-keys-lost">
          <h3>
            <ShieldCheck size={20} /> Clés des espaces chiffrés introuvables
          </h3>
          <p>Des espaces chiffrés existent sur cet ordinateur, mais leurs clés ne sont plus dans la base. Choisir un nouveau mot de passe rendrait leur contenu définitivement illisible.</p>
          <p>Restaurez une sauvegarde complète (Fichier › Restaurer une sauvegarde…) : elle contient ces clés.</p>
          <div className="sp-actions">
            <button type="button" className="btn btn-primary" onClick={onClose}>
              Fermer
            </button>
          </div>
        </div>
      </Modal>
    );
  const first = !configured;
  // Mot de passe déjà choisi et un espace ouvert : la clé est en mémoire, rien à ressaisir.
  const needSecret = configured && !anyOpen && !recovery;
  const submit = async () => {
    setError(null);
    if (first && !recovery) {
      if ([...pw].length < PASSWORD_MIN) return setError(`Le mot de passe doit compter au moins ${PASSWORD_MIN} caractères.`);
      if (pw !== pw2) return setError('Les deux saisies ne correspondent pas.');
      setBusy(true);
      const r = await setupSpaces(pw);
      setBusy(false);
      if (!r.ok) return setError(r.error);
      setPw('');
      setPw2('');
      return setRecovery(r.recoveryKey);
    }
    setBusy(true);
    const r = await encryptSpace(wsId, needSecret ? pw : undefined);
    setBusy(false);
    if (!r.ok) return setError(r.error);
    useStore.getState().toast(`« ${ws.name} » est maintenant chiffré`, 'success');
    onClose();
  };
  return (
    <Modal title="Chiffrer cet espace" onClose={onClose}>
      <form
        className="sp-dialog"
        data-testid="space-encrypt-dialog"
        onSubmit={(e) => {
          e.preventDefault();
          if (!busy) void submit();
        }}
      >
        <h3>
          <ShieldCheck size={20} /> Chiffrer « {ws.name} »
        </h3>
        {recovery ? (
          <>
            <p>
              Voici la <strong>clé de secours</strong> des espaces chiffrés. Elle n’est affichée que cette fois. Sans le mot de passe ni cette clé, le contenu des espaces chiffrés est définitivement illisible.
            </p>
            <KeyBox value={recovery} />
            <label className="sp-check">
              <input type="checkbox" checked={kept} onChange={(e) => setKept(e.target.checked)} data-testid="space-kept" /> J’ai noté cette clé en lieu sûr
            </label>
          </>
        ) : (
          <>
            <p>Ce qui n’est rangé que dans cet espace (écrits, plans, cartes, livres avec leurs extraits et notes) sera chiffré, et invisible tant que l’espace est verrouillé. Un livre aussi rangé dans un autre espace reste lisible ailleurs.</p>
            <p className="sp-hint">Les copies de secours de Marginalia sont nettoyées. Une sauvegarde complète que vous auriez exportée avant contient encore ce contenu en clair : supprimez-la ou refaites-la.</p>
            {first && (
              <>
                <p>
                  Choisissez le <strong>mot de passe des espaces chiffrés</strong> : le même pour tous, chaque espace se verrouillant séparément.
                </p>
                <input className="input" type="password" autoComplete="new-password" placeholder="Mot de passe (8 caractères au moins)" value={pw} onChange={(e) => setPw(e.target.value)} autoFocus data-testid="space-new-password" />
                <input className="input" type="password" autoComplete="new-password" placeholder="Le même, une seconde fois" value={pw2} onChange={(e) => setPw2(e.target.value)} data-testid="space-new-password2" />
              </>
            )}
            {needSecret && <input className="input" type="password" autoComplete="off" placeholder="Mot de passe des espaces chiffrés" value={pw} onChange={(e) => setPw(e.target.value)} autoFocus data-testid="space-password" />}
          </>
        )}
        {error && (
          <p className="sp-error" role="alert" data-testid="space-error">
            {error}
          </p>
        )}
        <div className="sp-actions">
          <button type="button" className="btn" onClick={onClose}>
            {recovery ? 'Plus tard' : 'Annuler'}
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy || (!!recovery && !kept) || (needSecret && !pw)} aria-busy={busy} data-testid="space-encrypt-go">
            {first && !recovery ? 'Continuer' : busy ? 'Chiffrement…' : 'Chiffrer l’espace'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function DecryptDialog({ wsId, onClose }: { wsId: string; onClose: () => void }) {
  const ws = useStore((s) => s.workspaces.find((w) => w.id === wsId));
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!ws) return null;
  return (
    <Modal title="Retirer le chiffrement" onClose={onClose}>
      <form
        className="sp-dialog"
        data-testid="space-decrypt-dialog"
        onSubmit={async (e) => {
          e.preventDefault();
          if (busy || !pw) return;
          setBusy(true);
          setError(null);
          const r = await decryptSpace(wsId, pw);
          setBusy(false);
          if (!r.ok) return setError(r.error);
          useStore.getState().toast(`« ${ws.name} » n’est plus chiffré`, 'success');
          onClose();
        }}
      >
        <h3>
          <LockOpen size={20} /> Retirer le chiffrement de « {ws.name} »
        </h3>
        <p>Son contenu rejoindra le reste de la bibliothèque : il redeviendra visible partout, et ne sera plus protégé par le mot de passe des espaces chiffrés.</p>
        <input className="input" type="password" autoComplete="off" placeholder="Mot de passe des espaces chiffrés" value={pw} onChange={(e) => setPw(e.target.value)} autoFocus data-testid="space-password" />
        {error && (
          <p className="sp-error" role="alert" data-testid="space-error">
            {error}
          </p>
        )}
        <div className="sp-actions">
          <button type="button" className="btn" onClick={onClose}>
            Annuler
          </button>
          <button type="submit" className="btn btn-danger" disabled={busy || !pw} aria-busy={busy} data-testid="space-decrypt-go">
            {busy ? 'Déchiffrement…' : 'Retirer le chiffrement'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

/** Mot de passe des espaces chiffrés, nouvelle clé de secours, Touch ID. */
function PasswordDialog({ onClose }: { onClose: () => void }) {
  const touch = useSpaceUi((s) => s.touchId);
  const [cur, setCur] = useState('');
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recovery, setRecovery] = useState<string | null>(null);
  const toast = useStore.getState().toast;
  const run = async (fn: () => Promise<{ ok: boolean; error?: string; waitMs?: number; recoveryKey?: string }>, done: string) => {
    setBusy(true);
    setError(null);
    try {
      const r = await fn();
      if (!r.ok) setError(r.error ?? 'Refusé.');
      else {
        if (r.recoveryKey) setRecovery(r.recoveryKey);
        else toast(done, 'success');
        await refreshSpaceStatus();
      }
    } catch (e) {
      setError(String((e as Error)?.message ?? e));
    }
    setBusy(false);
  };
  return (
    <Modal title="Mot de passe des espaces chiffrés" onClose={onClose}>
      <div className="sp-dialog" data-testid="space-password-dialog">
        <h3>
          <KeyRound size={20} /> Mot de passe des espaces chiffrés
        </h3>
        <input className="input" type="password" autoComplete="off" placeholder="Mot de passe actuel" value={cur} onChange={(e) => setCur(e.target.value)} autoFocus data-testid="space-current" />
        {recovery ? (
          <>
            <p>
              Nouvelle <strong>clé de secours</strong> (l’ancienne ne marche plus) :
            </p>
            <KeyBox value={recovery} />
          </>
        ) : (
          <>
            <input className="input" type="password" autoComplete="new-password" placeholder="Nouveau mot de passe" value={pw} onChange={(e) => setPw(e.target.value)} data-testid="space-new-password" />
            <input className="input" type="password" autoComplete="new-password" placeholder="Le même, une seconde fois" value={pw2} onChange={(e) => setPw2(e.target.value)} data-testid="space-new-password2" />
          </>
        )}
        {error && (
          <p className="sp-error" role="alert" data-testid="space-error">
            {error}
          </p>
        )}
        <div className="sp-actions sp-actions-wrap">
          {touch.available && (
            <button className="btn" disabled={busy || (!touch.enabled && !cur)} onClick={() => void run(() => host.spaces!.setTouchId(!touch.enabled, cur), touch.enabled ? 'Touch ID désactivé pour les espaces chiffrés' : 'Touch ID activé pour les espaces chiffrés')} data-testid="space-touchid-toggle">
              <Fingerprint size={14} /> {touch.enabled ? 'Désactiver Touch ID' : 'Activer Touch ID'}
            </button>
          )}
          <button className="btn" disabled={busy || !cur} onClick={() => void run(() => host.spaces!.newRecoveryKey(cur), '')} data-testid="space-new-recovery">
            Nouvelle clé de secours
          </button>
          <span className="spacer" />
          <button className="btn" onClick={onClose}>
            Fermer
          </button>
          <button
            className="btn btn-primary"
            disabled={busy || !cur || !pw}
            aria-busy={busy}
            data-testid="space-change-go"
            onClick={() => {
              if (pw !== pw2) return setError('Les deux saisies ne correspondent pas.');
              void run(async () => {
                const r = await host.spaces!.changePassword(cur, pw);
                if (r.ok) {
                  setCur('');
                  setPw('');
                  setPw2('');
                }
                return r;
              }, 'Mot de passe des espaces chiffrés changé');
            }}
          >
            Changer le mot de passe
          </button>
        </div>
      </div>
    </Modal>
  );
}

/** Fenêtres des espaces chiffrés (montée une fois, dans App). */
export function SpaceHost() {
  const dialog = useSpaceUi((s) => s.dialog);
  const ready = useStore((s) => s.ready);
  // Au chargement : état des clés, et marque « chiffré » remise sur tout espace qui a un contenu scellé.
  useEffect(() => {
    if (ready) void refreshSpaceStatus();
  }, [ready]);
  const close = () => openSpaceDialog(null);
  if (!dialog) return null;
  if (dialog.t === 'encrypt') return <EncryptDialog wsId={dialog.wsId} onClose={close} />;
  if (dialog.t === 'decrypt') return <DecryptDialog wsId={dialog.wsId} onClose={close} />;
  return <PasswordDialog onClose={close} />;
}
