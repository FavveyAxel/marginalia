// État du chiffrement et du verrouillage (app de bureau), partagé par l'écran de verrouillage,
// les réglages et la palette de commandes. Absent en navigateur (host.security non défini).
import { useEffect, useState } from 'react';
import { host, type SecurityStatus } from '../../lib/platform';

let current: SecurityStatus | null = null;
const subs = new Set<(s: SecurityStatus | null) => void>();
let started = false;

function publish(s: SecurityStatus) {
  current = s;
  for (const f of subs) f(s);
}

export async function refreshSecurity(): Promise<SecurityStatus | null> {
  if (!host.security) return null;
  const s = await host.security.status();
  publish(s);
  return s;
}

function start() {
  if (started || !host.security) return;
  started = true;
  host.security.onChange(publish);
  void refreshSecurity();
}

export const getSecurity = () => current;

export function useSecurity(): SecurityStatus | null {
  const [s, setS] = useState(current);
  useEffect(() => {
    start();
    subs.add(setS);
    setS(current);
    return () => void subs.delete(setS);
  }, []);
  return s;
}

/** Nom de l'ordinateur dans les textes (« sur ce Mac », « sur ce PC »). */
export const machine = (platform?: string) => (platform === 'darwin' ? 'Mac' : platform === 'win32' ? 'PC' : 'ordinateur');

/** Clé de secours normalisée (comparaison tolérante : minuscules, espaces, O/0, I/L/1). */
export function normKeyPart(s: string): string {
  return s
    .toUpperCase()
    .replace(/[\s\-_.]/g, '')
    .replace(/O/g, '0')
    .replace(/[IL]/g, '1')
    .replace(/U/g, 'V');
}

/** Saisie de clé de secours mise en forme au fil de la frappe : « ABCD-EFGH-… ». */
export function formatKeyInput(s: string): string {
  const raw = s.toUpperCase().replace(/[^0-9A-Z]/g, '').slice(0, 32);
  return (raw.match(/.{1,4}/g) ?? []).join('-');
}
