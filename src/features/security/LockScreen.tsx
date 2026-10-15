// Écran de verrouillage : affiché avant tout chargement des données quand Marginalia est verrouillé
// (mot de passe, Touch ID, ou clé de secours). Le rendu ne reçoit aucune donnée avant le déverrouillage :
// le processus principal refuse les lectures tant que la clé n'est pas en mémoire.
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowLeft, Fingerprint, KeyRound, Lock, TriangleAlert } from 'lucide-react';
import { host, type SecurityStatus } from '../../lib/platform';
import { formatKeyInput } from './state';
import { fmtKeys } from '../../lib/keys';
import './security.css';

type Mode = 'password' | 'recovery';

export function LockScreen({ status, onUnlocked }: { status: SecurityStatus; onUnlocked: () => void }) {
  const api = host.security!;
  const reason = status.lockReason;
  const [mode, setMode] = useState<Mode>(reason === 'lock' || (reason === 'keychain' && status.hasPassword) ? 'password' : 'recovery');
  const [password, setPassword] = useState('');
  const [key, setKey] = useState('');
  const [newPw, setNewPw] = useState('');
  const [newPw2, setNewPw2] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [shake, setShake] = useState(0);
  const pwRef = useRef<HTMLInputElement>(null);
  const keyRef = useRef<HTMLInputElement>(null);
  const triedTouch = useRef(false);
  const needNewPassword = status.lock;

  useEffect(() => {
    (mode === 'password' ? pwRef : keyRef).current?.focus();
  }, [mode]);

  const done = (r: { ok: boolean; error?: string }) => {
    if (r.ok) {
      setError('');
      onUnlocked();
      return;
    }
    setError(r.error ?? 'Impossible de déverrouiller.');
    setShake((n) => n + 1);
  };

  const touch = async () => {
    setBusy(true);
    try {
      done(await api.unlockTouchId());
    } finally {
      setBusy(false);
    }
  };
  // Touch ID proposé d'emblée au lancement (une fois). Après un verrouillage demandé ou automatique,
  // on attend que l'utilisateur revienne : le bouton suffit.
  useEffect(() => {
    if (status.touchId && reason === 'lock' && !status.lockedBy && !triedTouch.current) {
      triedTouch.current = true;
      void touch().then(() => pwRef.current?.focus());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const submitPassword = async (e: FormEvent) => {
    e.preventDefault();
    if (!password || busy) return;
    setBusy(true);
    try {
      const r = await api.unlockPassword(password);
      if (!r.ok) setPassword('');
      done(r);
    } finally {
      setBusy(false);
      pwRef.current?.focus();
    }
  };
  const submitRecovery = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    if (needNewPassword) {
      if ([...newPw].length < 8) return done({ ok: false, error: 'Le nouveau mot de passe doit compter au moins 8 caractères.' });
      if (newPw !== newPw2) return done({ ok: false, error: 'Les deux mots de passe ne sont pas identiques.' });
    }
    setBusy(true);
    try {
      done(await api.unlockRecovery(key, needNewPassword ? newPw : undefined));
    } finally {
      setBusy(false);
    }
  };

  const title = reason === 'orphan' ? 'Clé introuvable' : reason === 'keychain' ? 'Clé de secours nécessaire' : 'Marginalia est verrouillé';

  return (
    <div className="lock-screen">
      <div className="lock-top drag" />
      <main className="lock-card panel anim-scale" aria-labelledby="lock-title">
        <div className={`lock-emblem ${reason === 'lock' ? '' : 'warn'}`} aria-hidden="true">
          {reason === 'lock' ? <Lock size={22} strokeWidth={1.8} /> : reason === 'orphan' ? <TriangleAlert size={22} strokeWidth={1.8} /> : <KeyRound size={22} strokeWidth={1.8} />}
        </div>
        <p className="lock-brand">Marginalia</p>
        <h1 id="lock-title" className="lock-title">
          {title}
        </h1>

        {reason === 'orphan' ? (
          <p className="lock-text">
            Vos données sont chiffrées, mais le fichier qui protège leur clé (<code>keystore.json</code>) a disparu du dossier de Marginalia. Rien n’a été
            modifié ni effacé. Remettez ce fichier en place (depuis une copie de votre dossier, par exemple), puis relancez Marginalia.
          </p>
        ) : mode === 'password' ? (
          <form className="lock-form" onSubmit={submitPassword} key={'pw' + shake}>
            <p className="lock-text">Saisissez votre mot de passe pour ouvrir votre bibliothèque.</p>
            <label className="sr-only" htmlFor="lock-password">
              Mot de passe
            </label>
            <input
              id="lock-password"
              ref={pwRef}
              className={`input lock-input ${error ? 'invalid' : ''} ${shake ? 'lock-shake' : ''}`}
              type="password"
              autoComplete="current-password"
              placeholder="Mot de passe"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                setError('');
              }}
              disabled={busy}
            />
            {error && (
              <p className="lock-error" role="alert">
                {error}
              </p>
            )}
            <button className="btn btn-primary lock-submit" type="submit" disabled={!password || busy}>
              {busy ? 'Vérification…' : 'Déverrouiller'}
            </button>
            {status.touchId && (
              <button type="button" className="btn lock-touch" onClick={touch} disabled={busy}>
                <Fingerprint size={16} /> Utiliser Touch ID
              </button>
            )}
            <button type="button" className="lock-link" onClick={() => (setMode('recovery'), setError(''))}>
              Mot de passe oublié ? Utiliser la clé de secours
            </button>
          </form>
        ) : (
          <form className="lock-form" onSubmit={submitRecovery} key={'rk' + shake}>
            <p className="lock-text">
              {reason === 'keychain'
                ? `${status.platform === 'darwin' ? 'Le trousseau de macOS' : 'Le système'} n’a pas rendu la clé de vos données (cela peut arriver après une mise à jour de Marginalia, ou si l’accès a été refusé). Saisissez votre clé de secours : elle sera de nouveau confiée au trousseau.`
                : 'Saisissez la clé de secours notée ou imprimée lors de l’activation, puis choisissez un nouveau mot de passe.'}
            </p>
            <label className="sr-only" htmlFor="lock-key">
              Clé de secours
            </label>
            <input
              id="lock-key"
              ref={keyRef}
              className={`input lock-input lock-key ${error ? 'invalid' : ''} ${shake ? 'lock-shake' : ''}`}
              placeholder="XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX"
              spellCheck={false}
              autoComplete="off"
              value={key}
              onChange={(e) => {
                setKey(formatKeyInput(e.target.value));
                setError('');
              }}
              disabled={busy}
            />
            {needNewPassword && (
              <>
                <input
                  className="input lock-input"
                  type="password"
                  autoComplete="new-password"
                  placeholder="Nouveau mot de passe (8 caractères au moins)"
                  aria-label="Nouveau mot de passe"
                  value={newPw}
                  onChange={(e) => (setNewPw(e.target.value), setError(''))}
                  disabled={busy}
                />
                <input
                  className="input lock-input"
                  type="password"
                  autoComplete="new-password"
                  placeholder="Confirmer le nouveau mot de passe"
                  aria-label="Confirmer le nouveau mot de passe"
                  value={newPw2}
                  onChange={(e) => (setNewPw2(e.target.value), setError(''))}
                  disabled={busy}
                />
              </>
            )}
            {error && (
              <p className="lock-error" role="alert">
                {error}
              </p>
            )}
            <button className="btn btn-primary lock-submit" type="submit" disabled={key.replace(/-/g, '').length !== 32 || busy}>
              {busy ? 'Vérification…' : 'Déverrouiller'}
            </button>
            {status.hasPassword && (
              <button type="button" className="lock-link" onClick={() => (setMode('password'), setError(''))}>
                <ArrowLeft size={13} /> Revenir au mot de passe
              </button>
            )}
          </form>
        )}
      </main>
      <p className="lock-foot">
        Tout reste sur cet ordinateur.
        {reason === 'lock' && <> Pour verrouiller à tout moment : {fmtKeys('⇧⌘L')}.</>}
      </p>
    </div>
  );
}
