// Questions du processus principal à l'utilisateur : clé de secours ou mot de passe d'une
// sauvegarde chiffrée à restaurer (menu Fichier › Restaurer une sauvegarde…).
import { useEffect, useRef, useState } from 'react';
import { KeyRound } from 'lucide-react';
import { host } from '../../lib/platform';
import { Modal } from '../workspaces/wsUi';
import './security.css';

interface Ask {
  id: number;
  title: string;
  message: string;
  resolve: (v: string | null) => void;
}

export function SecurityAsk() {
  const [ask, setAsk] = useState<Ask | null>(null);
  const [value, setValue] = useState('');
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!host.security) return;
    return host.security.onAsk(
      (req) =>
        new Promise<string | null>((resolve) => {
          setValue('');
          setAsk({ id: req.id, title: req.title, message: req.message, resolve });
        }),
    );
  }, []);
  useEffect(() => {
    if (ask) setTimeout(() => input.current?.focus(), 30);
  }, [ask]);
  if (!ask) return null;
  const answer = (v: string | null) => {
    ask.resolve(v);
    setAsk(null);
  };
  return (
    <Modal title={ask.title} onClose={() => answer(null)}>
      <form
        className="sec-dialog sec-ask"
        onSubmit={(e) => {
          e.preventDefault();
          if (value.trim()) answer(value);
        }}
      >
        <div className="sec-dialog-head">
          <h3>
            <KeyRound size={20} style={{ verticalAlign: '-3px', marginRight: 8 }} />
            {ask.title}
          </h3>
        </div>
        <p className="sec-p">{ask.message}</p>
        <div className="sec-fields">
          <input
            ref={input}
            className="input"
            type="password"
            autoComplete="off"
            spellCheck={false}
            placeholder="Clé de secours ou mot de passe"
            aria-label="Clé de secours ou mot de passe"
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />
        </div>
        <div className="sec-foot">
          <button type="button" className="btn" onClick={() => answer(null)}>
            Annuler
          </button>
          <button className="btn btn-primary" type="submit" disabled={!value.trim()}>
            Ouvrir la sauvegarde
          </button>
        </div>
      </form>
    </Modal>
  );
}
