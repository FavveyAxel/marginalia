// Côté écrit du lien plan ↔ écrit (plans/planLink.ts) :
//  - relève les titres et leurs mots (draft.outline) et fait suivre le plan rattaché ;
//  - à l'ouverture : va au titre demandé (« Écrire cette partie »), crée le titre d'une partie du
//    plan absente de l'écrit, range les sections comme le plan si des fiches y ont été déplacées ;
//  - bouton « Plan » de la barre (ouvrir le plan, en rattacher un, le créer depuis les titres) et ⌘⌥P.
import { useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react';
import { ListTree } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { uid, useStore } from '../../lib/store';
import type { Draft, DraftHeading, EssayPlan, PlanProgress } from '../../lib/types';
import { fmtKeys, matchKeys } from '../../lib/keys';
import type { DocEngine, OutlineItem } from './engine';
import { Popover, usePop } from './Popover';
import { desiredOrder, levelsOf, pendingRenameList, matchPlan, normTitle, partsFromOutline, planEntries, planOfDraft, stripLabel, syncPlanFromDraft } from '../plans/planLink';

export interface HeadingMark extends PlanProgress {
  words: number;
}

const sameOutline = (a: DraftHeading[] | undefined, b: DraftHeading[]) => !!a && a.length === b.length && a.every((h, i) => h.level === b[i].level && h.text === b[i].text && h.words === b[i].words);

/** Fait suivre le plan rattaché d'après les titres de l'écrit. */
export function syncLinkedPlan(draftId: string, outline: DraftHeading[]) {
  const s = useStore.getState();
  const plan = planOfDraft(s.plans, draftId);
  if (!plan) return;
  const parts = syncPlanFromDraft(plan, outline);
  if (parts) s.patch('plans', plan.id, { parts });
}

export function usePlanLink({
  draft,
  engineRef,
  ready,
  editable,
  outline,
  refresh,
}: {
  draft: Draft;
  engineRef: MutableRefObject<DocEngine | null>;
  ready: boolean;
  editable: boolean;
  outline: OutlineItem[];
  refresh: () => void;
}) {
  const plan = useStore((s) => planOfDraft(s.plans, draft.id));
  const route = useStore((s) => s.route);
  const patch = useStore((s) => s.patch);
  const toast = useStore((s) => s.toast);
  const navigate = useStore((s) => s.navigate);

  // 1. Titres et mots : relevés une seconde après la dernière modification.
  useEffect(() => {
    if (!ready) return;
    const t = setTimeout(() => {
      const e = engineRef.current;
      if (!e) return;
      const hw = e.headingWords();
      const d = useStore.getState().drafts.find((x) => x.id === draft.id);
      if (!d) return;
      if (!sameOutline(d.outline, hw)) patch('drafts', d.id, { outline: hw });
      syncLinkedPlan(d.id, hw);
    }, 700);
    return () => clearTimeout(t);
  }, [ready, outline, draft.id, engineRef, patch]);

  // 2. À l'ouverture : ordre du plan, titre à créer, titre où aller (une fois chacun).
  const done = useRef(new Set<string>());
  useEffect(() => {
    if (!ready || !editable) return;
    const e = engineRef.current;
    if (!e || route.name !== 'write' || route.draftId !== draft.id) return;
    void (async () => {
      const p = planOfDraft(useStore.getState().plans, draft.id);
      if (p?.pendingRenames && !done.current.has('renames')) {
        done.current.add('renames');
        let n = 0;
        for (const r of pendingRenameList(p)) if (e.renameHeading(r.from, r.to, normTitle)) n++;
        patch('plans', p.id, { pendingRenames: undefined });
        if (n) toast(n > 1 ? `${n} titres renommés comme dans le plan` : 'Titre renommé comme dans le plan', 'success');
        refresh();
      }
      if (p?.pendingOrder && !done.current.has('order')) {
        done.current.add('order');
        const hw = e.headingWords();
        const changed = e.arrangeSections(levelsOf(hw).part, desiredOrder(p, hw), normTitle);
        patch('plans', p.id, { pendingOrder: false });
        if (changed) toast(`Sections rangées comme le plan. ${fmtKeys('⌘Z')} pour revenir.`, 'success');
        refresh();
      }
      const ins = route.insert;
      if (ins && !done.current.has(ins.nonce)) {
        done.current.add(ins.nonce);
        const pos = await e.insertHeading(ins.level, ins.text, ins.after, ins.before, normTitle);
        refresh();
        if (pos !== null) {
          e.goTo(pos);
          toast(`Titre « ${stripLabel(ins.text)} » ajouté à l’écrit`, 'success');
        }
        navigate({ name: 'write', draftId: draft.id });
        return;
      }
      if (route.at && !done.current.has(`at:${route.at}`)) {
        done.current.add(`at:${route.at}`);
        const want = normTitle(route.at);
        const hit = e.outline().find((o) => normTitle(o.text) === want);
        if (hit) e.goTo(hit.pos);
      }
    })();
  }, [ready, editable, route, draft.id, engineRef, patch, toast, navigate, refresh]);

  // 3. Repères du plan sur les titres du panneau Plan de l'écrit (statut, mots / objectif).
  const marks = useMemo(() => {
    const out = new Map<number, HeadingMark>();
    if (!plan || !outline.length) return out;
    const hw: DraftHeading[] = outline.map((o, i) => ({ level: o.level, text: o.text, words: draft.outline?.[i]?.text === o.text ? draft.outline[i].words : 0 }));
    const m = matchPlan(plan, hw);
    const entries = new Map(planEntries(plan).map((x) => [x.key, x]));
    m.byKey.forEach((i, key) => {
      const en = entries.get(key)!;
      const prog: PlanProgress | undefined = en.kind === 'intro' ? plan.introProgress : en.kind === 'conclusion' ? plan.conclusionProgress : en.node ?? undefined;
      out.set(i, { status: prog?.status, goal: prog?.goal, words: m.sectionWords[i] });
    });
    return out;
  }, [plan, outline, draft.outline]);

  // 4. ⌘⌥P : de l'écrit à son plan, sur la partie du curseur.
  const caretRef = useRef<string | null>(null);
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (!matchKeys(ev, '⌘⌥P')) return;
      const p = planOfDraft(useStore.getState().plans, draft.id);
      if (!p) return;
      ev.preventDefault();
      navigate({ name: 'plans', planId: p.id, at: caretRef.current ?? undefined });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [draft.id, navigate]);

  return { plan, marks, caretRef };
}

/** Bouton « Plan » de la barre de l'écrit. */
export function PlanButton({ draft, plan, caret, disabled }: { draft: Draft; plan: EssayPlan | null; caret: string | null; disabled: boolean }) {
  const pop = usePop();
  const navigate = useStore((s) => s.navigate);
  const patch = useStore((s) => s.patch);
  const insert = useStore((s) => s.insert);
  const toast = useStore((s) => s.toast);
  const plans = useStore(useShallow((s) => s.plans));
  const drafts = useStore(useShallow((s) => s.drafts));
  const [q, setQ] = useState('');
  const free = useMemo(
    () =>
      [...plans]
        .filter((p) => !p.draftId || !drafts.some((d) => d.id === p.draftId))
        .filter((p) => !q.trim() || (p.title + ' ' + p.sujet).toLowerCase().includes(q.trim().toLowerCase()))
        .sort((a, b) => b.updatedAt - a.updatedAt),
    [plans, drafts, q],
  );

  if (plan)
    return (
      <button
        className="btn ed-plan-btn"
        onClick={() => navigate({ name: 'plans', planId: plan.id, at: caret ?? undefined })}
        title={fmtKeys(`Ouvrir le plan « ${plan.title || plan.sujet || 'Plan'} » (⌘⌥P)`)}
        data-testid="ed-open-plan"
      >
        <ListTree size={14} /> Plan
      </button>
    );

  const attach = (p: EssayPlan) => {
    patch('plans', p.id, { draftId: draft.id, pendingOrder: false });
    pop.close();
    if (draft.outline?.length) syncLinkedPlan(draft.id, draft.outline);
    toast(`Plan « ${p.title || p.sujet || 'Plan'} » rattaché à l’écrit`, 'success', { label: 'Ouvrir le plan', run: () => navigate({ name: 'plans', planId: p.id }) });
  };
  const fromHeadings = () => {
    const parts = partsFromOutline(draft.outline ?? []);
    const now = Date.now();
    const p: EssayPlan = { id: uid(), title: draft.title || 'Nouveau plan', sujet: draft.title, definitions: '', problematique: '', parts, conclusion: '', draftId: draft.id, createdAt: now, updatedAt: now };
    insert('plans', p);
    pop.close();
    toast(parts.length ? `Plan créé depuis ${parts.length} titre${parts.length > 1 ? 's' : ''}` : 'Plan créé : ajoutez des titres à l’écrit, ils y apparaîtront', 'success', {
      label: 'Ouvrir le plan',
      run: () => navigate({ name: 'plans', planId: p.id }),
    });
  };
  const heads = (draft.outline ?? []).length;

  return (
    <>
      <button className="btn ed-plan-btn" disabled={disabled} onClick={(e) => pop.toggle(e.currentTarget)} aria-haspopup="menu" data-testid="ed-plan-menu" title="Rattacher un plan à cet écrit">
        <ListTree size={14} /> Plan
      </button>
      <Popover pop={pop} label="Plan de l’écrit" className="ed-menu ed-plan-pop">
        <div className="ed-plan-pop-h">
          <b>Cet écrit n’a pas de plan</b>
          <span>Un plan rattaché suit les titres de l’écrit : statut, objectif et mots par partie.</span>
        </div>
        <button className="ed-plan-pop-row primary" onClick={fromHeadings} data-testid="ed-plan-from-headings">
          <ListTree size={14} /> Créer le plan depuis les titres {heads > 0 && <small>{heads} titre{heads > 1 ? 's' : ''}</small>}
        </button>
        {plans.length > 0 && (
          <>
            <div className="ed-plan-pop-sep">Rattacher un plan existant</div>
            {plans.length > 6 && <input className="input ed-plan-pop-q" placeholder="Rechercher un plan" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Rechercher un plan" />}
            <div className="ed-plan-pop-list">
              {free.map((p) => (
                <button key={p.id} className="ed-plan-pop-row" onClick={() => attach(p)} data-testid="ed-plan-attach">
                  <span className="truncate">{p.title || p.sujet || 'Plan sans titre'}</span>
                  <small>{p.parts.length} partie{p.parts.length > 1 ? 's' : ''}</small>
                </button>
              ))}
              {!free.length && <div className="ed-plan-pop-none">Tous vos plans sont déjà rattachés à un écrit.</div>}
            </div>
          </>
        )}
      </Popover>
    </>
  );
}
