// Plans de dissertation : liste des plans, puis éditeur (route { name: 'plans', planId }).
import { useMemo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { FileText, ListTree, Plus, Search } from 'lucide-react';
import { uid, useStore } from '../../lib/store';
import type { EssayPlan } from '../../lib/types';
import { relativeTime } from '../../components/ui';
import { PlanEditor } from './PlanEditor';
import { countItems } from './planTree';
import './plans.css';

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export function PlansView({ planId }: { planId: string | null }) {
  const plan = useStore((s) => (planId ? (s.plans.find((p) => p.id === planId) ?? null) : null));
  if (planId && plan) return <PlanEditor key={plan.id} plan={plan} />;
  return <PlanList missing={!!planId} />;
}

function PlanList({ missing }: { missing: boolean }) {
  const plans = useStore(useShallow((s) => s.plans));
  const insert = useStore((s) => s.insert);
  const navigate = useStore((s) => s.navigate);
  const [q, setQ] = useState('');

  const create = () => {
    const now = Date.now();
    const p: EssayPlan = {
      id: uid(),
      title: 'Nouveau plan',
      sujet: '',
      definitions: '',
      problematique: '',
      parts: [],
      conclusion: '',
      draftId: null,
      createdAt: now,
      updatedAt: now,
    };
    insert('plans', p);
    navigate({ name: 'plans', planId: p.id });
  };

  const shown = useMemo(() => {
    const n = norm(q.trim());
    return [...plans]
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .filter((p) => !n || norm(`${p.title} ${p.sujet} ${p.problematique}`).includes(n));
  }, [plans, q]);

  return (
    <div className="plan-view anim-view">
      <header className="topbar">
        <span className="spacer" />
        <button className="btn btn-primary" onClick={create}>
          <Plus size={14} /> Nouveau plan
        </button>
      </header>
      <div className="plan-list-wrap">
        <div className="plan-list-inner">
          <h1 className="page-title">Plans</h1>
          <p className="plan-lede muted">
            Posez le sujet, définissez ses termes, formulez la problématique, puis rangez vos extraits, concepts et
            arguments dans les parties.
          </p>
          {missing && <p className="plan-warn">Ce plan n’existe plus. Choisissez-en un autre ci-dessous.</p>}
          {plans.length > 0 && (
            <div className="plan-search">
              <Search size={14} />
              <input
                className="plan-search-input"
                placeholder="Rechercher un plan"
                aria-label="Rechercher un plan"
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
            </div>
          )}
          {plans.length === 0 ? (
            <div className="empty plan-empty anim-in">
              <ListTree size={26} />
              <h3>Aucun plan pour l’instant</h3>
              <p>Un plan réunit le sujet, la problématique et des parties où vous glissez vos extraits.</p>
              <button className="btn btn-primary" onClick={create}>
                <Plus size={14} /> Nouveau plan
              </button>
            </div>
          ) : shown.length === 0 ? (
            <div className="empty plan-empty anim-in">
              <Search size={24} />
              <h3>Aucun résultat</h3>
              <p>Aucun plan ne correspond à « {q} ».</p>
            </div>
          ) : (
            <div className="plan-grid anim-stagger" data-testid="plan-grid">
              {shown.map((p, i) => (
                <button
                  key={p.id}
                  className="plan-card lift"
                  style={{ ['--i' as string]: i }}
                  data-pid={p.id}
                  onClick={() => navigate({ name: 'plans', planId: p.id })}
                >
                  <span className="plan-card-title">{p.sujet.trim() || p.title || 'Sans titre'}</span>
                  <span className="plan-card-sub">
                    {p.problematique.trim() || 'Pas encore de problématique'}
                  </span>
                  <span className="plan-card-meta">
                    <FileText size={12} />
                    {p.parts.length} {p.parts.length > 1 ? 'parties' : 'partie'} · {countItems(p.parts)}{' '}
                    {countItems(p.parts) > 1 ? 'éléments' : 'élément'} · {relativeTime(p.updatedAt)}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
