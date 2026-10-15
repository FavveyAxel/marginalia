// 16. Conversions : « Créer un plan à partir de la carte » (convertToPlan) et « Rédiger une explication
// à partir de la carte » (convertToDraft). Confirmation légère avec aperçu (parties, citations), titre
// modifiable ; une version de la carte est enregistrée avant (modèle : autoSnapshot 'convert').
import { useMemo, useState } from 'react';
import { FilePen, History, ListTree } from 'lucide-react';
import { useStore } from '../../../../lib/store';
import type { EssayPlan, PlanNode } from '../../../../lib/types';
import { Modal } from '../../../workspaces/wsUi';
import { convertToDraft, convertToPlan, lookup, readMap } from '../../model/actions';
import { mapDisplayTitle, mapToDraftHtml, mapToPlan } from '../../model/convert';
import './convert.css';

export type ConvertKind = 'plan' | 'draft';

const plural = (n: number, one: string, many: string) => `${n} ${n > 1 ? many : one}`;

function planStats(parts: PlanNode[]) {
  let sub = 0;
  let cites = 0;
  const walk = (ns: PlanNode[], depth: number) => {
    for (const n of ns) {
      if (depth > 0) sub++;
      cites += n.items.filter((it) => it.ref.kind === 'highlight').length;
      walk(n.children, depth + 1);
    }
  };
  walk(parts, 0);
  return { parts: parts.length, sub, cites };
}

interface Preview {
  title: string;
  name: string;
  plan?: EssayPlan;
  stats?: { parts: number; sub: number; cites: number };
  cites?: number;
  sections?: number;
}

export function ConvertDialog({ mapKey, kind, onClose }: { mapKey: string; kind: ConvertKind; onClose(): void }) {
  const preview = useMemo<Preview>(() => {
    const m = readMap(mapKey);
    const lk = lookup();
    const name = mapDisplayTitle(m, lk);
    if (kind === 'plan') {
      const p = mapToPlan(m, lk);
      return { title: p.title, name, plan: p, stats: planStats(p.parts) };
    }
    const d = mapToDraftHtml(m, lk);
    const sections = (d.html.match(/<h3>/g) ?? []).length;
    return { title: d.title, name, cites: d.citedHighlightIds.length, sections };
  }, [mapKey, kind]);
  const [title, setTitle] = useState(preview.title);
  const [busy, setBusy] = useState(false);
  const plan = kind === 'plan';

  const run = async () => {
    const s = useStore.getState();
    setBusy(true);
    try {
      if (plan) {
        const id = convertToPlan(mapKey, title.trim() || preview.title);
        onClose();
        s.navigate({ name: 'plans', planId: id });
        s.toast('Plan créé à partir de la carte (une version de la carte a été enregistrée)', 'success');
      } else {
        const id = await convertToDraft(mapKey, title.trim() || preview.title);
        onClose();
        s.navigate({ name: 'write', draftId: id });
        s.toast('Explication créée à partir de la carte (une version de la carte a été enregistrée)', 'success');
      }
    } catch (e) {
      console.error(e);
      setBusy(false);
      s.toast(plan ? 'Impossible de créer le plan' : 'Impossible de créer l’écrit', 'error');
    }
  };

  const empty = plan ? preview.stats!.parts === 0 && !preview.plan!.problematique : preview.cites === 0 && preview.sections === 0;
  return (
    <Modal title={plan ? 'Créer un plan à partir de la carte' : 'Rédiger une explication à partir de la carte'} onClose={onClose}>
      <form
        className="cv-dialog"
        data-testid="convert-dialog"
        onSubmit={(e) => {
          e.preventDefault();
          if (!busy) void run();
        }}
      >
        <header className="cv-head">
          <span className="cv-ico">{plan ? <ListTree size={18} /> : <FilePen size={18} />}</span>
          <div>
            <h3>{plan ? 'Créer un plan' : 'Rédiger une explication'}</h3>
            <p>
              {plan
                ? 'Problème → sujet, thèse → problématique, arguments → parties, objections et réponses → discussion.'
                : 'Un brouillon dans l’ordre de la lecture guidée : chaque extrait cité avec sa référence en note.'}
            </p>
          </div>
        </header>
        <label className="cv-field">
          <span>Titre</span>
          <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} autoFocus data-testid="convert-title" />
        </label>
        <ul className="cv-stats" data-testid="convert-preview">
          {plan ? (
            <>
              <li>
                <b>{preview.stats!.parts}</b> {preview.stats!.parts > 1 ? 'parties' : 'partie'}
              </li>
              <li>
                <b>{preview.stats!.sub}</b> {preview.stats!.sub > 1 ? 'sous-parties' : 'sous-partie'}
              </li>
              <li>
                <b>{preview.stats!.cites}</b> {preview.stats!.cites > 1 ? 'citations' : 'citation'}
              </li>
            </>
          ) : (
            <>
              <li>
                <b>{preview.sections}</b> {(preview.sections ?? 0) > 1 ? 'sections' : 'section'}
              </li>
              <li>
                <b>{preview.cites}</b> {(preview.cites ?? 0) > 1 ? 'citations' : 'citation'}
              </li>
            </>
          )}
        </ul>
        {plan && preview.plan!.parts.length > 0 && (
          <ol className="cv-outline">
            {preview.plan!.parts.slice(0, 5).map((p) => (
              <li key={p.id} className="truncate">
                {p.title || 'Partie'}
              </li>
            ))}
            {preview.plan!.parts.length > 5 && <li className="cv-more">et {plural(preview.plan!.parts.length - 5, 'autre partie', 'autres parties')}</li>}
          </ol>
        )}
        {empty && <p className="cv-warn">La carte ne contient encore ni thèse ni argument relié : le résultat sera presque vide.</p>}
        <p className="cv-note">
          <History size={13} /> Une version de « {preview.name} » est enregistrée avant la conversion ; la carte n’est pas modifiée.
        </p>
        <footer className="cv-foot">
          <button type="button" className="btn" onClick={onClose}>
            Annuler
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy} data-testid="convert-go">
            {plan ? 'Créer et ouvrir le plan' : 'Créer et ouvrir l’écrit'}
          </button>
        </footer>
      </form>
    </Modal>
  );
}
