// Vue « Réglages » : confidentialité et sécurité (chiffrement local, verrouillage, clé de secours).
// Tout est optionnel et désactivé par défaut ; rien ne quitte l'ordinateur.
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  Check,
  Copy,
  FileDown,
  Fingerprint,
  HardDrive,
  Info,
  KeyRound,
  LockKeyhole,
  MoonStar,
  Printer,
  ShieldCheck,
  Smile,
  MessageCircle,
  Hourglass,
  Timer,
  TriangleAlert,
} from 'lucide-react';
import { host, type SecurityStatus } from '../../lib/platform';
import { useStore } from '../../lib/store';
import { Modal } from '../workspaces/wsUi';
import { fmtKeys } from '../../lib/keys';
import { machine, normKeyPart, refreshSecurity, useSecurity } from './state';
import { Sprite } from '../mascot/Sprite';
import { LEVEL_STEPS, MASCOT_DEFAULT, levelFor, type MascotFreq } from '../mascot/Mascot';
import { STAY_HINT, STAY_LABELS } from '../mascot/scenes';
import './security.css';

const DELAYS: { v: number; label: string }[] = [
  { v: 5, label: '5 min' },
  { v: 15, label: '15 min' },
  { v: 30, label: '30 min' },
  { v: 60, label: '1 h' },
  { v: 0, label: 'Jamais' },
];

type DialogKind = 'enable' | 'enableLock' | 'disableLock' | 'disable' | 'changePassword' | 'newRecovery';

export function Switch({ on, onChange, label, disabled }: { on: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} className={`sec-switch ${on ? 'on' : ''}`} disabled={disabled} onClick={() => onChange(!on)}>
      <span />
    </button>
  );
}

const keychainText = (st: SecurityStatus | null) =>
  st?.platform === 'darwin' ? 'le trousseau de macOS' : st?.platform === 'win32' ? 'votre session Windows' : 'le trousseau du système';

export function SettingsView() {
  const st = useSecurity();
  const [dialog, setDialog] = useState<DialogKind | null>(null);
  const toast = useStore((s) => s.toast);
  const desktop = !!host.security;
  const where = machine(st?.platform ?? (desktop ? host.platform : undefined));

  const setOption = async (o: Parameters<NonNullable<typeof host.security>['setOptions']>[0]) => {
    const r = await host.security!.setOptions(o);
    if (!r.ok) toast(r.error, 'error');
    await refreshSecurity();
  };

  return (
    <>
      <header className="topbar">
        <span className="spacer" />
      </header>
      <div className="set-scroll">
        <div className="set-page anim-view">
          <div className="set-head">
            <h1 className="page-title">Réglages</h1>
            <p className="set-lede">Ces réglages concernent Marginalia sur ce {where}. Vos données ne quittent jamais l’ordinateur.</p>
          </div>

          <section className="set-section" aria-labelledby="set-privacy">
            <h2 className="set-section-title" id="set-privacy">
              <ShieldCheck size={18} strokeWidth={1.8} /> Confidentialité et sécurité
            </h2>
            {!desktop ? (
              <Unavailable />
            ) : !st ? (
              <div className="set-list set-loading skeleton" style={{ height: 180 }} />
            ) : (
              <PrivacyCards st={st} where={where} open={setDialog} setOption={setOption} />
            )}
          </section>

          <MascotSettings />
        </div>
      </div>
      {dialog && st && <SecurityDialog kind={dialog} st={st} where={where} onClose={() => setDialog(null)} />}
    </>
  );
}

function Unavailable() {
  return (
    <>
      <ul className="set-list" aria-disabled="true">
        <Row icon={<HardDrive size={17} />} title="Chiffrer mes données sur cet ordinateur" desc="Vos données sont chiffrées sur le disque ; la clé est rangée dans le trousseau du système.">
          <Switch on={false} onChange={() => {}} label="Chiffrer mes données" disabled />
        </Row>
        <Row icon={<LockKeyhole size={17} />} title="Verrouiller Marginalia" desc="Mot de passe (ou Touch ID) à l’ouverture et après un temps d’inactivité.">
          <Switch on={false} onChange={() => {}} label="Verrouiller Marginalia" disabled />
        </Row>
      </ul>
      <p className="set-note">
        <Info size={14} /> Disponible dans l’app de bureau : dans un navigateur, les données sont gardées par le navigateur lui-même.
      </p>
    </>
  );
}

function Row({ icon, title, desc, children, sub, id }: { icon: ReactNode; title: ReactNode; desc?: ReactNode; children?: ReactNode; sub?: boolean; id?: string }) {
  return (
    <li className={`set-row ${sub ? 'sub' : ''}`} id={id}>
      <span className="set-icon" aria-hidden="true">
        {icon}
      </span>
      <div className="set-body">
        <span className="set-title">{title}</span>
        {desc && <span className="set-desc">{desc}</span>}
      </div>
      {children && <div className="set-control">{children}</div>}
    </li>
  );
}

function MigrationLine({ st }: { st: SecurityStatus }) {
  const m = st.migration;
  if (!m || m.finished) return null;
  const pct = m.total ? Math.round((m.done / m.total) * 100) : 0;
  if (m.running)
    return (
      <div className="set-progress" role="status">
        <div className="set-progress-text">
          <span>{m.to === 'encrypted' ? 'Chiffrement de vos fichiers…' : 'Déchiffrement de vos fichiers…'}</span>
          <span className="set-progress-n">
            {m.done} / {m.total || '…'}
          </span>
        </div>
        <div className="set-bar">
          <span style={{ width: `${pct}%` }} />
        </div>
      </div>
    );
  return (
    <div className="set-callout warn" role="alert">
      <TriangleAlert size={16} />
      <div>
        <strong>{m.to === 'encrypted' ? 'Chiffrement interrompu.' : 'Déchiffrement interrompu.'}</strong> Vos fichiers restent lisibles par Marginalia (certains sont chiffrés,
        d’autres pas encore).{m.error ? ` Détail : ${m.error}` : ''}
        <div className="set-callout-actions">
          <button className="btn btn-sm" onClick={() => void host.security!.resume()}>
            Reprendre
          </button>
        </div>
      </div>
    </div>
  );
}

function PrivacyCards({
  st,
  where,
  open,
  setOption,
}: {
  st: SecurityStatus;
  where: string;
  open: (k: DialogKind) => void;
  setOption: (o: { touchId?: boolean; autoLockMinutes?: number; lockOnSleep?: boolean }) => Promise<void>;
}) {
  const busy = !!st.migration?.running;
  const systemOk = st.system.ok;
  const created = st.recoveryCreatedAt ? new Date(st.recoveryCreatedAt).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }) : null;
  const isMac = st.platform === 'darwin';

  return (
    <>
      <ul className="set-list">
        <Row
          id="set-encrypt"
          icon={<HardDrive size={17} />}
          title={
            <>
              Chiffrer mes données sur ce {where}
              {st.encrypted && <span className="set-badge">Activé</span>}
            </>
          }
          desc={
            !systemOk && !st.encrypted ? (
              <>
                {st.system.reason} Le verrouillage par mot de passe reste possible.
              </>
            ) : (
              <>
                Livres, extraits, notes, écrits et sauvegardes sont chiffrés sur le disque (AES-256).{' '}
                {st.lock
                  ? `Avec le verrouillage, la clé n’est rendue que par votre mot de passe${st.touchId ? ' ou Touch ID' : ''} (ou la clé de secours).`
                  : `La clé est rangée dans ${keychainText(st)} : rien à taper, Marginalia s’ouvre normalement, mais une copie de vos fichiers emportée hors de votre session reste illisible. Quasiment aucun risque de perte.`}
              </>
            )
          }
        >
          <Switch
            on={st.encrypted}
            label={`Chiffrer mes données sur ce ${where}`}
            disabled={busy || (!st.encrypted && !systemOk)}
            onChange={(v) => open(v ? 'enable' : 'disable')}
          />
        </Row>
        {st.migration && !st.migration.finished && (
          <li className="set-row-extra">
            <MigrationLine st={st} />
          </li>
        )}

        <Row
          id="set-lock"
          icon={<LockKeyhole size={17} />}
          title={
            <>
              Verrouiller Marginalia
              {st.lock && <span className="set-badge">Activé</span>}
            </>
          }
          desc={
            <>
              Mot de passe{st.touchIdAvailable ? ' ou Touch ID' : ''} à l’ouverture, et verrouillage automatique après un temps d’inactivité. Une clé de secours, à
              imprimer ou noter, évite de tout perdre en cas d’oubli.
            </>
          }
        >
          <Switch on={st.lock} label="Verrouiller Marginalia" disabled={busy} onChange={(v) => open(v ? 'enableLock' : systemOk ? 'disableLock' : 'disable')} />
        </Row>
        {st.lock && (
          <>
            {st.touchIdAvailable && (
              <Row sub icon={<Fingerprint size={16} />} title="Déverrouiller avec Touch ID" desc="Plus rapide. Votre mot de passe et la clé de secours restent les vrais secrets : Touch ID ne fait qu’ouvrir l’accès à la clé gardée par le trousseau.">
                <Switch on={st.touchId} label="Déverrouiller avec Touch ID" onChange={(v) => void setOption({ touchId: v })} disabled={!systemOk} />
              </Row>
            )}
            <Row sub icon={<Timer size={16} />} title="Verrouiller après" desc="Sans activité dans Marginalia pendant ce temps. Vos modifications sont enregistrées avant.">
              <div className="segmented set-seg" role="radiogroup" aria-label="Verrouiller après">
                {DELAYS.map((d) => (
                  <button key={d.v} role="radio" aria-checked={st.autoLockMinutes === d.v} className={st.autoLockMinutes === d.v ? 'active' : ''} onClick={() => void setOption({ autoLockMinutes: d.v })}>
                    {d.label}
                  </button>
                ))}
              </div>
            </Row>
            <Row sub icon={<MoonStar size={16} />} title="Verrouiller à la mise en veille" desc={`Et quand la session ${isMac ? 'du Mac' : 'de l’ordinateur'} est verrouillée.`}>
              <Switch on={st.lockOnSleep} label="Verrouiller à la mise en veille" onChange={(v) => void setOption({ lockOnSleep: v })} />
            </Row>
            <li className="set-row sub set-actions">
              <button className="btn btn-sm" onClick={() => open('changePassword')}>
                Changer le mot de passe
              </button>
              <button className="btn btn-sm" onClick={() => void host.security!.lockNow()} disabled={busy}>
                <LockKeyhole size={13} /> Verrouiller maintenant <span className="set-kbd">{fmtKeys('⇧⌘L')}</span>
              </button>
            </li>
          </>
        )}

        <Row
          id="set-recovery"
          icon={<KeyRound size={17} />}
          title="Clé de secours"
          desc={
            st.encrypted || st.lock ? (
              <>
                Elle remplace un mot de passe oublié, ou le trousseau s’il ne rend plus la clé (après certaines mises à jour, par exemple).
                {created && <> Clé actuelle créée le {created}.</>} En afficher une nouvelle rend l’ancienne inutilisable.
              </>
            ) : (
              'Créée et affichée une seule fois quand vous activez le chiffrement ou le verrouillage.'
            )
          }
        >
          <button className="btn btn-sm" disabled={!st.encrypted || busy} onClick={() => open('newRecovery')}>
            Afficher une nouvelle clé de secours
          </button>
        </Row>
      </ul>

      <div className="set-callout danger">
        <TriangleAlert size={16} />
        <div>
          <strong>Sans mot de passe ni clé de secours, vos données sont définitivement illisibles.</strong> Personne ne peut les récupérer à votre place : gardez
          la clé de secours imprimée ou notée, loin de l’ordinateur.
        </div>
      </div>

      <div className="set-about">
        <h3>
          <Info size={15} /> À savoir
        </h3>
        <ul>
          <li>
            <strong>Ce que le chiffrement protège :</strong> les copies de vos fichiers faites hors de votre session (disque retiré ou volé, dossier copié sur
            une clé USB, sauvegarde non chiffrée). <strong>Ce qu’il ne protège pas :</strong> quelqu’un qui utilise votre session ouverte, sauf si Marginalia est
            verrouillé.
          </li>
          <li>
            Les <strong>exports</strong> (Word, PDF, Markdown, page web, images) sont enregistrés en clair : ce sont des copies faites pour être partagées. Pour
            une <strong>sauvegarde complète</strong>, Marginalia vous laisse choisir entre une archive chiffrée et une archive en clair.
          </li>
          <li>
            Pour protéger tout l’ordinateur, activez aussi{' '}
            {isMac ? (
              <>
                <strong>FileVault</strong> (Réglages système › Confidentialité et sécurité)
              </>
            ) : st.platform === 'win32' ? (
              <>
                <strong>BitLocker</strong> ou le chiffrement de l’appareil (Paramètres › Confidentialité et sécurité)
              </>
            ) : (
              <>le chiffrement du disque de votre système</>
            )}
            .
          </li>
        </ul>
      </div>
    </>
  );
}

// ── Clé de secours : affichage, copie, impression ────────────
function RecoveryKeyCard({ token, value }: { token: string; value: string }) {
  const [copied, setCopied] = useState(false);
  const toast = useStore((s) => s.toast);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = value;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  const print = async (mode: 'print' | 'pdf') => {
    try {
      const r = await host.security!.printRecovery(token, mode);
      if (r.ok && mode === 'pdf') toast('Clé de secours enregistrée en PDF. Imprimez-la, puis rangez la feuille en lieu sûr.', 'success');
    } catch (e) {
      toast(String((e as Error)?.message ?? e), 'error');
    }
  };
  return (
    <div className="sec-keybox">
      <div className="sec-key selectable" aria-label={`Clé de secours : ${value}`} data-key={value}>
        {value.split('-').map((g, i) => (
          <span key={i} className="sec-key-group">
            <span className="sec-key-n">{i + 1}</span>
            {g}
          </span>
        ))}
      </div>
      <div className="sec-key-actions">
        <button className="btn btn-sm" onClick={copy}>
          {copied ? <Check size={14} /> : <Copy size={14} />} {copied ? 'Copiée' : 'Copier'}
        </button>
        <button className="btn btn-sm" onClick={() => void print('print')}>
          <Printer size={14} /> Imprimer…
        </button>
        <button className="btn btn-sm" onClick={() => void print('pdf')}>
          <FileDown size={14} /> Enregistrer en PDF…
        </button>
      </div>
    </div>
  );
}

function pwStrength(pw: string): { level: 0 | 1 | 2 | 3; label: string } {
  const n = [...pw].length;
  if (!n) return { level: 0, label: '' };
  if (n < 8) return { level: 1, label: 'Trop court (8 caractères au moins)' };
  const kinds = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^a-zA-Z0-9]/].filter((r) => r.test(pw)).length;
  if (n >= 14 || (n >= 10 && kinds >= 3)) return { level: 3, label: 'Solide' };
  return { level: 2, label: 'Correct — une phrase de plusieurs mots est encore plus sûre' };
}

type Step = 'intro' | 'password' | 'key' | 'verify' | 'working' | 'confirm' | 'change';

function SecurityDialog({ kind, st, where, onClose }: { kind: DialogKind; st: SecurityStatus; where: string; onClose: () => void }) {
  const api = host.security!;
  const live = useSecurity() ?? st;
  const toast = useStore((s) => s.toast);
  const first: Step =
    kind === 'enable' ? 'intro' : kind === 'enableLock' ? 'password' : kind === 'newRecovery' ? (st.lock ? 'confirm' : 'key') : kind === 'changePassword' ? 'change' : 'confirm';
  const [step, setStep] = useState<Step>(first);
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [oldPw, setOldPw] = useState('');
  const [touchId, setTouchId] = useState(st.touchIdAvailable && st.system.ok);
  const [autoLock, setAutoLock] = useState(15);
  const [lockOnSleep, setLockOnSleep] = useState(true);
  const [pending, setPending] = useState<{ token: string; recoveryKey: string } | null>(null);
  const [saved, setSaved] = useState(false);
  const [answers, setAnswers] = useState(['', '']);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const committed = useRef(false);
  const target: 'encrypted' | 'plain' = kind === 'disable' ? 'plain' : 'encrypted';
  // Deux groupes de la clé à retaper (tirés une fois pour toutes).
  const probe = useMemo(() => {
    const a = Math.floor(Math.random() * 4);
    const b = 4 + Math.floor(Math.random() * 4);
    return [a, b];
  }, []);

  const close = () => {
    if (pending && !committed.current) void api.cancelPending();
    onClose();
  };
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError('');
    try {
      await fn();
    } catch (e) {
      setError(String((e as Error)?.message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''));
    } finally {
      setBusy(false);
    }
  };
  const getKey = async (password?: string) => {
    if (kind === 'newRecovery') {
      const r = await api.prepareRecovery(password);
      if (!r.ok) throw new Error(r.error);
      setPending({ token: r.token, recoveryKey: r.recoveryKey });
    } else setPending(await api.prepare());
    setSaved(false);
    setStep('key');
  };
  // Nouvelle clé sans mot de passe (niveau 1) : générée à l'ouverture.
  useEffect(() => {
    if (kind === 'newRecovery' && first === 'key') void run(() => getKey());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const commit = async () => {
    if (!pending) return;
    const groups = pending.recoveryKey.split('-');
    if (probe.some((g, i) => normKeyPart(answers[i]) !== groups[g])) {
      setError('Ces groupes ne correspondent pas à votre clé de secours. Vérifiez votre copie.');
      return;
    }
    await run(async () => {
      if (kind === 'newRecovery') {
        const r = await api.commitRecovery(pending.token);
        if (!r.ok) throw new Error(r.error);
        committed.current = true;
        toast('Nouvelle clé de secours enregistrée. L’ancienne ne fonctionne plus.', 'success');
        onClose();
        return;
      }
      const lock = kind === 'enableLock' ? { password: pw, touchId, autoLockMinutes: autoLock, lockOnSleep } : undefined;
      const r = await api.enable(pending.token, lock);
      if (!r.ok) throw new Error(r.error);
      committed.current = true;
      await refreshSecurity();
      setStep('working');
    });
  };

  const passwordStep = async () => {
    if ([...pw].length < 8) return setError('Le mot de passe doit compter au moins 8 caractères.');
    if (pw !== pw2) return setError('Les deux mots de passe ne sont pas identiques.');
    await run(async () => {
      if (st.encrypted) {
        const r = await api.enableLock({ password: pw, touchId, autoLockMinutes: autoLock, lockOnSleep });
        if (!r.ok) throw new Error(r.error);
        toast('Verrouillage activé. Votre clé de secours actuelle reste valable.', 'success');
        onClose();
      } else await getKey();
    });
  };

  const confirmStep = async () => {
    await run(async () => {
      if (kind === 'disableLock') {
        const r = await api.disableLock(oldPw);
        if (!r.ok) throw new Error(r.error);
        toast('Verrouillage désactivé. Vos données restent chiffrées.', 'success');
        onClose();
      } else if (kind === 'disable') {
        const r = await api.disable(st.lock ? oldPw : undefined);
        if (!r.ok) throw new Error(r.error);
        await refreshSecurity();
        setStep('working');
      } else if (kind === 'newRecovery') await getKey(oldPw);
    });
  };

  const changeStep = async () => {
    if ([...pw].length < 8) return setError('Le nouveau mot de passe doit compter au moins 8 caractères.');
    if (pw !== pw2) return setError('Les deux nouveaux mots de passe ne sont pas identiques.');
    await run(async () => {
      const r = await api.changePassword(oldPw, pw);
      if (!r.ok) throw new Error(r.error);
      toast('Mot de passe changé.', 'success');
      onClose();
    });
  };

  const strength = pwStrength(pw);
  const title =
    kind === 'enable'
      ? `Chiffrer mes données sur ce ${where}`
      : kind === 'enableLock'
        ? 'Verrouiller Marginalia'
        : kind === 'disableLock'
          ? 'Désactiver le verrouillage'
          : kind === 'disable'
            ? 'Désactiver le chiffrement'
            : kind === 'changePassword'
              ? 'Changer le mot de passe'
              : 'Nouvelle clé de secours';
  const stepsOf: Step[] = kind === 'enable' ? ['intro', 'key', 'verify', 'working'] : kind === 'enableLock' && !st.encrypted ? ['password', 'key', 'verify', 'working'] : [];
  const m = live.migration;
  const finished = step === 'working' && !!m && m.to === target && m.finished;

  return (
    <Modal title={title} onClose={close} wide>
      <div className="sec-dialog" data-step={step}>
        <div className="sec-dialog-head">
          <h3>{step === 'key' ? 'Votre clé de secours' : step === 'verify' ? 'Vérifions votre copie' : step === 'working' ? (finished ? 'C’est fait' : title) : title}</h3>
          {stepsOf.length > 0 && (
            <ol className="sec-steps" aria-label="Étapes">
              {stepsOf.map((s, i) => (
                <li key={s} className={stepsOf.indexOf(step) >= i ? 'on' : ''} />
              ))}
            </ol>
          )}
        </div>

        {step === 'intro' && (
          <>
            <p className="sec-p">
              Marginalia va chiffrer vos livres, extraits, notes, écrits et sauvegardes. La clé sera rangée dans {keychainText(st)} : vous n’aurez rien à taper.
            </p>
            <ul className="sec-points">
              <li>Une copie de la base est d’abord mise de côté, puis chaque fichier est chiffré, relu et vérifié avant de remplacer l’original.</li>
              <li>Vous pouvez continuer à travailler pendant ce temps ; si l’opération est interrompue, elle reprend au prochain lancement.</li>
              <li>Une clé de secours va s’afficher : elle permet de tout récupérer si {st.platform === 'darwin' ? 'le trousseau' : 'le système'} ne rendait plus la clé.</li>
            </ul>
            <div className="sec-foot">
              <button className="btn" onClick={close}>
                Annuler
              </button>
              <button className="btn btn-primary" disabled={busy} onClick={() => void run(() => getKey())}>
                Continuer
              </button>
            </div>
          </>
        )}

        {step === 'password' && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void passwordStep();
            }}
          >
            <p className="sec-p">
              Ce mot de passe sera demandé à l’ouverture de Marginalia et après un temps d’inactivité.
              {!st.encrypted && ' Vos données seront chiffrées en même temps.'}
            </p>
            <div className="sec-fields">
              <input className="input" type="password" autoFocus autoComplete="new-password" placeholder="Mot de passe" aria-label="Mot de passe" value={pw} onChange={(e) => (setPw(e.target.value), setError(''))} />
              <div className={`sec-strength l${strength.level}`} aria-live="polite">
                <span />
                <span />
                <span />
                <em>{strength.label}</em>
              </div>
              <input className="input" type="password" autoComplete="new-password" placeholder="Confirmer le mot de passe" aria-label="Confirmer le mot de passe" value={pw2} onChange={(e) => (setPw2(e.target.value), setError(''))} />
            </div>
            <ul className="sec-options">
              {st.touchIdAvailable && st.system.ok && (
                <li>
                  <span>
                    <Fingerprint size={15} /> Déverrouiller aussi avec Touch ID
                  </span>
                  <Switch on={touchId} onChange={setTouchId} label="Déverrouiller aussi avec Touch ID" />
                </li>
              )}
              <li>
                <span>
                  <Timer size={15} /> Verrouiller après
                </span>
                <div className="segmented set-seg" role="radiogroup" aria-label="Verrouiller après">
                  {DELAYS.map((d) => (
                    <button type="button" key={d.v} role="radio" aria-checked={autoLock === d.v} className={autoLock === d.v ? 'active' : ''} onClick={() => setAutoLock(d.v)}>
                      {d.label}
                    </button>
                  ))}
                </div>
              </li>
              <li>
                <span>
                  <MoonStar size={15} /> Verrouiller à la mise en veille
                </span>
                <Switch on={lockOnSleep} onChange={setLockOnSleep} label="Verrouiller à la mise en veille" />
              </li>
            </ul>
            <p className="sec-warn">
              <TriangleAlert size={14} /> Sans mot de passe ni clé de secours, vos données sont définitivement illisibles.
            </p>
            {error && (
              <p className="sec-error" role="alert">
                {error}
              </p>
            )}
            <div className="sec-foot">
              <button type="button" className="btn" onClick={close}>
                Annuler
              </button>
              <button className="btn btn-primary" type="submit" disabled={busy || !pw || !pw2}>
                {st.encrypted ? 'Activer le verrouillage' : 'Continuer'}
              </button>
            </div>
          </form>
        )}

        {step === 'key' && pending && (
          <>
            <p className="sec-p">
              Notez-la ou imprimez-la maintenant : <strong>elle ne sera plus jamais affichée.</strong> Avec elle, vous retrouvez vos données si vous oubliez votre
              mot de passe ou si ce {where} ne rend plus la clé.
            </p>
            <RecoveryKeyCard token={pending.token} value={pending.recoveryKey} />
            <p className="sec-hint">Rangez-la loin de l’ordinateur (pas dans un fichier à côté de vos données). Quiconque la possède, avec une copie de vos fichiers, peut les lire.</p>
            <label className="sec-check">
              <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} />
              <span>J’ai noté ou imprimé ma clé de secours, et je la range en lieu sûr.</span>
            </label>
            <div className="sec-foot">
              <button className="btn" onClick={close}>
                Annuler
              </button>
              <button className="btn btn-primary" disabled={!saved} onClick={() => (setStep('verify'), setError(''))}>
                Continuer
              </button>
            </div>
          </>
        )}

        {step === 'verify' && pending && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void commit();
            }}
          >
            <p className="sec-p">Pour être sûr que votre copie est juste, retapez deux groupes de la clé, en la lisant sur votre feuille.</p>
            <div className="sec-probe">
              {probe.map((g, i) => (
                <label key={g}>
                  <span>Groupe n° {g + 1}</span>
                  <input
                    className="input sec-probe-input"
                    maxLength={4}
                    autoFocus={i === 0}
                    spellCheck={false}
                    autoComplete="off"
                    placeholder="XXXX"
                    value={answers[i]}
                    onChange={(e) => {
                      const v = e.target.value.toUpperCase();
                      setAnswers((a) => a.map((x, j) => (j === i ? v : x)));
                      setError('');
                    }}
                  />
                </label>
              ))}
            </div>
            {error && (
              <p className="sec-error" role="alert">
                {error}
              </p>
            )}
            <div className="sec-foot">
              <button type="button" className="btn" onClick={() => (setStep('key'), setError(''))}>
                Revoir la clé
              </button>
              <button className="btn btn-primary" type="submit" disabled={busy || answers.some((a) => a.length < 4)}>
                {kind === 'newRecovery' ? 'Remplacer l’ancienne clé' : kind === 'enableLock' ? 'Activer le verrouillage' : 'Chiffrer mes données'}
              </button>
            </div>
          </form>
        )}

        {step === 'confirm' && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void confirmStep();
            }}
          >
            <p className="sec-p">
              {kind === 'disable'
                ? `Marginalia va remettre tous vos fichiers en clair sur ce ${where}${st.lock ? ' et désactiver le verrouillage' : ''}. Ils redeviendront lisibles par quiconque accède au disque.`
                : kind === 'disableLock'
                  ? `Marginalia s’ouvrira sans mot de passe. Vos données restent chiffrées, avec la clé rangée dans ${keychainText(st)}.`
                  : 'Saisissez votre mot de passe pour afficher une nouvelle clé de secours. L’ancienne cessera de fonctionner dès que vous aurez confirmé la nouvelle.'}
            </p>
            {st.lock && (
              <div className="sec-fields">
                <input className="input" type="password" autoFocus autoComplete="current-password" placeholder="Mot de passe actuel" aria-label="Mot de passe actuel" value={oldPw} onChange={(e) => (setOldPw(e.target.value), setError(''))} />
              </div>
            )}
            {error && (
              <p className="sec-error" role="alert">
                {error}
              </p>
            )}
            <div className="sec-foot">
              <button type="button" className="btn" onClick={close}>
                Annuler
              </button>
              <button className={`btn ${kind === 'newRecovery' ? 'btn-primary' : 'btn-primary sec-danger'}`} type="submit" disabled={busy || (st.lock && !oldPw)}>
                {kind === 'disable' ? 'Tout remettre en clair' : kind === 'disableLock' ? 'Désactiver le verrouillage' : 'Continuer'}
              </button>
            </div>
          </form>
        )}

        {step === 'change' && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void changeStep();
            }}
          >
            <div className="sec-fields">
              <input className="input" type="password" autoFocus autoComplete="current-password" placeholder="Mot de passe actuel" aria-label="Mot de passe actuel" value={oldPw} onChange={(e) => (setOldPw(e.target.value), setError(''))} />
              <input className="input" type="password" autoComplete="new-password" placeholder="Nouveau mot de passe" aria-label="Nouveau mot de passe" value={pw} onChange={(e) => (setPw(e.target.value), setError(''))} />
              <div className={`sec-strength l${strength.level}`} aria-live="polite">
                <span />
                <span />
                <span />
                <em>{strength.label}</em>
              </div>
              <input className="input" type="password" autoComplete="new-password" placeholder="Confirmer le nouveau mot de passe" aria-label="Confirmer le nouveau mot de passe" value={pw2} onChange={(e) => (setPw2(e.target.value), setError(''))} />
            </div>
            <p className="sec-hint">Votre clé de secours ne change pas.</p>
            {error && (
              <p className="sec-error" role="alert">
                {error}
              </p>
            )}
            <div className="sec-foot">
              <button type="button" className="btn" onClick={close}>
                Annuler
              </button>
              <button className="btn btn-primary" type="submit" disabled={busy || !oldPw || !pw || !pw2}>
                Changer le mot de passe
              </button>
            </div>
          </form>
        )}

        {step === 'working' && (
          <>
            {finished ? (
              <div className="sec-done">
                <span className="sec-done-icon">
                  <Check size={20} />
                </span>
                <p className="sec-p">
                  {target === 'encrypted'
                    ? `Vos données sont chiffrées sur ce ${where}.${kind === 'enableLock' ? ' Marginalia vous demandera votre mot de passe à la prochaine ouverture.' : ''}`
                    : 'Vos données sont de nouveau enregistrées en clair. Le fichier de clés a été retiré.'}
                </p>
              </div>
            ) : (
              <>
                <p className="sec-p">
                  {target === 'encrypted' ? 'Chiffrement de vos fichiers en cours.' : 'Déchiffrement de vos fichiers en cours.'} Vous pouvez fermer cette fenêtre et
                  continuer à travailler : l’opération se poursuit, et reprendrait au prochain lancement si elle était interrompue.
                </p>
                <MigrationLine st={live} />
              </>
            )}
            <div className="sec-foot">
              <button className="btn btn-primary" onClick={onClose}>
                {finished ? 'Terminé' : 'Continuer en arrière-plan'}
              </button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}

const MASCOT_FREQS: { v: MascotFreq; label: string }[] = [
  { v: 'off', label: 'Jamais' },
  { v: 'rare', label: 'Rarement' },
  { v: 'sometimes', label: 'Parfois' },
  { v: 'often', label: 'Souvent' },
];

function MascotSettings() {
  const freq = useStore((s) => s.settings.mascot ?? MASCOT_DEFAULT);
  const docs = useStore((s) => s.books.length + s.drafts.length);
  const update = useStore((s) => s.updateSettings);
  const stay = useStore((s) => s.settings.mascotStay ?? 2);
  const silent = useStore((s) => !!s.settings.mascotSilent);
  const level = levelFor(docs);
  const next = LEVEL_STEPS[level + 1];
  const halo = document.documentElement.dataset.theme === 'dark' ? '#e9dfcc' : undefined;
  return (
    <section className="set-section" aria-labelledby="set-mascot">
      <h2 className="set-section-title" id="set-mascot">
        <Smile size={18} strokeWidth={1.8} /> Compagnon
      </h2>
      <ul className="set-list">
        <li className="set-row set-mascot">
          <span className="set-mascot-sprite">
            <Sprite pose="wave" frame={0} level={level} halo={halo} title="Le compagnon" />
          </span>
          <div className="set-body">
            <span className="set-title">Un petit cerveau qui passe sur l’interface</span>
            <span className="set-desc">
              Il s’assoit au bord des encadrés, lit, réfléchit et cite parfois un philosophe. Cliquez sur lui pour une citation. Plus la bibliothèque grandit, plus il se muscle :
              niveau {level} sur 4 ({docs} document{docs > 1 ? 's' : ''}{next ? `, prochain niveau à ${next}` : ''}).
            </span>
          </div>
          <div className="set-control">
            <div className="segmented set-seg" role="radiogroup" aria-label="Visites du compagnon">
              {MASCOT_FREQS.map((f) => (
                <button type="button" key={f.v} role="radio" aria-checked={freq === f.v} className={freq === f.v ? 'active' : ''} onClick={() => update({ mascot: f.v })}>
                  {f.label}
                </button>
              ))}
            </div>
          </div>
        </li>
        <li className={`set-row sub set-talk ${freq === 'off' ? 'is-off' : ''}`}>
          <span className="set-icon" aria-hidden="true">
            <MessageCircle size={15} />
          </span>
          <div className="set-body">
            <span className="set-title">Bulles de dialogue</span>
            <span className="set-desc">{silent ? 'Il ne dit rien : il lit, joue et se promène en silence.' : 'Citations, blagues et petites remarques de temps en temps.'}</span>
          </div>
          <div className="set-control">
            <Switch on={!silent} onChange={(v) => update({ mascotSilent: !v })} label="Bulles de dialogue du compagnon" disabled={freq === 'off'} />
          </div>
        </li>
        <li className={`set-row sub set-stay ${freq === 'off' ? 'is-off' : ''}`}>
          <span className="set-icon" aria-hidden="true">
            <Hourglass size={15} />
          </span>
          <div className="set-body">
            <label className="set-title" htmlFor="set-mascot-stay">
              Durée des visites
            </label>
            <span className="set-desc">
              {STAY_LABELS[stay]} : il reste {STAY_HINT[stay]} avant de repartir.
            </span>
          </div>
          <div className="set-control set-range-wrap">
            <span className="set-range-end" aria-hidden="true">
              Courte
            </span>
            <input
              id="set-mascot-stay"
              className="set-range"
              type="range"
              min={0}
              max={4}
              step={1}
              value={stay}
              disabled={freq === 'off'}
              aria-valuetext={STAY_LABELS[stay]}
              style={{ ['--p' as string]: `${stay * 25}%` }}
              onChange={(e) => update({ mascotStay: Number(e.target.value) })}
            />
            <span className="set-range-end" aria-hidden="true">
              Longue
            </span>
          </div>
        </li>
      </ul>
    </section>
  );
}
