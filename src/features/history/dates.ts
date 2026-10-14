// Regroupement par jour (Aujourd'hui, Hier, « lundi 12 octobre »).
export const dayKey = (ts: number) => {
  const d = new Date(ts);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
};

export function dayLabel(ts: number, now = Date.now()): string {
  const k = dayKey(ts);
  if (k === dayKey(now)) return 'Aujourd’hui';
  if (k === dayKey(now - 86_400_000)) return 'Hier';
  const d = new Date(ts);
  const sameYear = d.getFullYear() === new Date(now).getFullYear();
  const s = d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', ...(sameYear ? {} : { year: 'numeric' }) });
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export const timeLabel = (ts: number) => new Date(ts).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });

export function groupByDay<T>(items: T[], at: (x: T) => number): { key: string; label: string; items: T[] }[] {
  // Regroupement par clé (et non par voisinage) : une horloge qui a changé ne crée pas deux « Aujourd'hui ».
  const m = new Map<string, { key: string; label: string; items: T[] }>();
  for (const it of items) {
    const k = dayKey(at(it));
    const g = m.get(k);
    if (g) g.items.push(it);
    else m.set(k, { key: k, label: dayLabel(at(it)), items: [it] });
  }
  return [...m.values()];
}
