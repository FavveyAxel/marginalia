// Éditeur d'un plan de dissertation : sujet, définitions, problématique, parties, conclusion.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import {
  ArrowDown,
  ChevronLeft,
  ArrowUp,
  FilePen,
  Link2,
  PanelRight,
  Plus,
  Send,
  Trash2,
  X,
} from 'lucide-react';
import { useStore } from '../../lib/store';
import type { EssayPlan, PlanItemRef, PlanNode, PlanProgress } from '../../lib/types';
import { KindDot } from '../../components/ui';
import { createDraft } from '../editor/api';
import { AutoTextarea } from '../study/AutoTextarea';
import { ResourcePanel } from './ResourcePanel';
import { RedString } from './RedString';
import { ITEM_MIME, RES_MIME, hasType, type ResRef } from './dnd';
import { planDraftTitle, planHtml } from './planHtml';
import { matchPlan, missingEntries, normTitle, planEntries, syncPlanFromDraft, totalGoal, wordsByKey } from './planLink';
import { FichesView, ProgressBar, StatusPill, TableauView, WordMeter, statusKey, type ViewProps } from './PlanViews';
import { statusOf } from './planLink';
import { uid } from '../../lib/store';
import {
  MAX_DEPTH,
  addChild,
  addItem,
  findItem,
  findNode,
  flatten,
  moveNodeTo,
  newNode,
  nodeLabel,
  placedRefs,
  removeItem,
  removeNode,
  shiftNode,
  updateNode,
} from './planTree';

export function PlanEditor({ plan }: { plan: EssayPlan }) {
  const patch = useStore((s) => s.patch);
  const remove = useStore((s) => s.remove);
  const navigate = useStore((s) => s.navigate);
  const toast = useStore((s) => s.toast);
  const books = useStore(useShallow((s) => s.books));
  const highlights = useStore(useShallow((s) => s.highlights));
  const concepts = useStore(useShallow((s) => s.concepts));
  const args = useStore(useShallow((s) => s.arguments));
  const draftExists = useStore((s) => !!plan.draftId && s.drafts.some((d) => d.id === plan.draftId));

  const [panel, setPanel] = useState(true);
  const docRef = useRef<HTMLDivElement>(null);
  const skeuo = useStore((s) => s.settings.appStyle === 'skeuo');
  const [target, setTarget] = useState<string | null>(null);
  const [confirmDel, setConfirmDel] = useState(false);
  const [sending, setSending] = useState(false);
  const [fresh, setFresh] = useState<string | null>(null);

  const set = (p: Partial<EssayPlan>) => patch('plans', plan.id, p);
  const setParts = (parts: PlanNode[]) => set({ parts });

  // ── Lien avec l'écrit (planLink.ts) ──
  const draft = useStore((s) => (plan.draftId ? s.drafts.find((d) => d.id === plan.draftId) : undefined));
  const linked = !!draft;
  const outline = draft?.outline;
  // Le plan suit les titres de l'écrit (relevés par l'éditeur) : à l'ouverture et à chaque relevé.
  useEffect(() => {
    if (!outline) return;
    const cur = useStore.getState().plans.find((p) => p.id === plan.id);
    const parts = cur && syncPlanFromDraft(cur, outline);
    if (parts) patch('plans', plan.id, { parts });
  }, [outline, plan.id, patch]);
  const match = useMemo(() => (outline ? matchPlan(plan, outline) : null), [plan, outline]);
  const words = useMemo(() => (match ? wordsByKey(match) : new Map<string, number>()), [match]);
  const missingMap = useMemo(() => (outline && linked ? missingEntries(plan, outline) : new Map()), [plan, outline, linked]);
  const missing = useMemo(() => {
    const m = new Set<string>(missingMap.keys());
    if (match && linked) for (const k of ['intro', 'conclusion']) if (!match.byKey.has(k)) m.add(k);
    return m;
  }, [missingMap, match, linked]);
  const totalWords = linked && match ? Array.from(match.byKey.values()).reduce((s, i) => s + (outline![i].level === match.levels.part ? match.sectionWords[i] : 0), 0) : null;
  /** Parties réordonnées dans le plan : l'écrit suivra à sa prochaine ouverture. */
  const reorder = (parts: PlanNode[]) => set(linked ? { parts, pendingOrder: true } : { parts });
  const rename = (id: string, title: string, parts: PlanNode[]) => {
    const i = match?.byKey.get(id);
    if (linked && i !== undefined && !plan.pendingRenames?.[id]) set({ parts, pendingRenames: { ...plan.pendingRenames, [id]: outline![i].text } });
    else setParts(parts);
    void title;
  };
  const setProgress = (key: string, p: PlanProgress) => {
    if (key === 'intro') set({ introProgress: p });
    else if (key === 'conclusion') set({ conclusionProgress: p });
    else setParts(updateNode(plan.parts, key, (n) => ({ ...n, status: p.status, goal: p.goal })));
  };
  const headingText = (key: string): string | null => {
    const i = match?.byKey.get(key);
    return i === undefined ? null : outline![i].text;
  };
  /** « Écrire cette partie » : l'écrit à ce titre ; absente de l'écrit, le titre y est créé. */
  const write = (key: string) => {
    if (!plan.draftId) return;
    const at = headingText(key);
    if (at) return navigate({ name: 'write', draftId: plan.draftId, at });
    const m = missingMap.get(key);
    const f = flatten(plan.parts).find((x) => x.node.id === key);
    const text = key === 'intro' ? 'Introduction' : key === 'conclusion' ? 'Conclusion' : f ? `${f.label} ${f.node.title.trim() || 'Sans titre'}` : null;
    if (!text) return;
    const entries = planEntries(plan);
    const pos = entries.findIndex((e) => e.key === key);
    const before = key === 'intro' ? (entries.slice(1).map((e) => headingText(e.key)).find(Boolean) ?? null) : null;
    const after = key === 'conclusion' ? ([...entries].reverse().map((e) => (e.depth === 0 ? headingText(e.key) : null)).find(Boolean) ?? null) : null;
    navigate({
      name: 'write',
      draftId: plan.draftId,
      insert: { text, level: m?.level ?? (match?.levels.part === 1 ? 2 : (match?.levels.part as 2 | 3) ?? 2), after: m ? m.after : after, before: m ? m.before : before, nonce: uid() },
    });
    void pos;
  };
  const sourcesOf = (n: PlanNode) => n.items.filter((it) => it.ref.kind !== 'text').length;

  // ── Vue : Plan (contenu), Fiches (ordre), Tableau (avancement) ──
  const route = useStore((s) => s.route);
  const [view, setViewState] = useState<'plan' | 'fiches' | 'tableau'>(() => {
    if (route.name === 'plans' && route.view) return route.view;
    try {
      const v = localStorage.getItem('mg.plan.view');
      if (v === 'fiches' || v === 'tableau') return v;
    } catch {
      /* stockage indisponible */
    }
    return 'plan';
  });
  const setView = (v: 'plan' | 'fiches' | 'tableau') => {
    setViewState(v);
    try {
      localStorage.setItem('mg.plan.view', v);
    } catch {
      /* stockage indisponible */
    }
  };
  // Ouvert depuis l'écrit (⌘⌥P, bouton Plan) : sur la partie du curseur.
  const openAt = (key: string) => {
    setView('plan');
    setTarget(key);
    requestAnimationFrame(() => document.querySelector(`[data-nid="${key}"], [data-field="${key === 'intro' ? 'def' : 'concl'}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' }));
  };
  const atDone = useRef<string | null>(null);
  useEffect(() => {
    if (route.name !== 'plans' || !route.at || atDone.current === route.at) return;
    atDone.current = route.at;
    const want = normTitle(route.at);
    const e = planEntries(plan).find((x) => normTitle(x.title) === want) ?? (match ? planEntries(plan).find((x) => match.byKey.has(x.key) && normTitle(outline![match.byKey.get(x.key)!].text) === want) : undefined);
    if (e) requestAnimationFrame(() => openAt(e.key));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route]);
  // ⌘⌥P : du plan à l'écrit, sur la partie visée.
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (!(ev.altKey && (ev.metaKey || ev.ctrlKey) && ev.code === 'KeyP') || !plan.draftId || !linked) return;
      ev.preventDefault();
      const at = target ? headingText(target) : null;
      navigate({ name: 'write', draftId: plan.draftId, ...(at ? { at } : {}) });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const moveCard: ViewProps['move'] = (id, to) => {
    const depthOf = (x: string) => flatten(plan.parts).find((f) => f.node.id === x)?.depth ?? -1;
    let next: PlanNode[] | null = null;
    if ('parentId' in to) {
      if (depthOf(id) === 0 && depthOf(to.parentId) === 0) {
        // partie lâchée sur une autre rangée : elle passe avant
        next = moveNodeTo(plan.parts, id, to.parentId, false);
      } else {
        const n = findNode(plan.parts, id);
        if (!n || id === to.parentId) return;
        const parent = findNode(plan.parts, to.parentId);
        if (parent?.children.at(-1)?.id === id) return;
        next = addChild(removeNode(plan.parts, id), to.parentId, n);
      }
    } else {
      const td = depthOf(to.targetId);
      if (depthOf(id) === 0 && td === 1) {
        const parent = plan.parts.find((p) => p.children.some((c) => c.id === to.targetId));
        next = parent ? moveNodeTo(plan.parts, id, parent.id, to.after) : null;
      } else next = moveNodeTo(plan.parts, id, to.targetId, to.after);
    }
    if (next) reorder(next);
  };
  const vp: ViewProps = {
    plan,
    words,
    missing,
    linked,
    setProgress,
    move: moveCard,
    addChild: (pid) => addPart(pid),
    openAt,
    write,
    sourcesOf,
  };

  const flat = useMemo(() => flatten(plan.parts), [plan.parts]);
  const targetNode = flat.find((f) => f.node.id === target) ?? flat[0] ?? null;

  const placed = useMemo(
    () => ({
      highlight: placedRefs(plan.parts, 'highlight'),
      concept: placedRefs(plan.parts, 'concept'),
      argument: placedRefs(plan.parts, 'argument'),
    }),
    [plan.parts],
  );

  const place = (nodeId: string, ref: PlanItemRef) => {
    const next = addItem(plan.parts, nodeId, ref);
    setParts(next);
    setTarget(nodeId);
  };

  const addPart = (parentId: string | null) => {
    const n = newNode();
    setParts(addChild(plan.parts, parentId, n));
    setFresh(n.id);
    setTarget(n.id);
  };

  const send = async () => {
    if (sending) return;
    setSending(true);
    try {
      const html = planHtml(plan, { highlights, books, concepts, arguments: args });
      const draft = await createDraft({ title: planDraftTitle(plan), template: 'dissertation', html });
      set({ draftId: draft.id });
      toast('Écrit créé depuis le plan', 'success', {
        label: 'Ouvrir l’écrit',
        run: () => navigate({ name: 'write', draftId: draft.id }),
      });
    } catch (e) {
      console.error(e);
      toast('L’écrit n’a pas pu être créé. Votre plan est intact : réessayez dans un instant.', 'error');
    } finally {
      setSending(false);
    }
  };

  const del = () => {
    remove('plans', plan.id);
    navigate({ name: 'plans', planId: null });
  };

  const hasContent = !!(plan.sujet.trim() || plan.parts.length);

  return (
    <div className="plan-view plan-editor-view anim-view">
      <header className="topbar">
        <button className="btn btn-ghost btn-sm" onClick={() => navigate({ name: 'plans', planId: null })}>
          <ChevronLeft size={16} /> Plans
        </button>
        <span className="spacer" />
        {confirmDel ? (
          <span className="plan-confirm anim-fade">
            Supprimer ce plan ? Il restera 30 jours dans la corbeille.
            <button className="btn btn-sm btn-danger" onClick={del} data-testid="plan-del-yes">
              Supprimer
            </button>
            <button className="btn btn-sm btn-ghost" onClick={() => setConfirmDel(false)}>
              Garder
            </button>
          </span>
        ) : (
          <button className="icon-btn" aria-label="Supprimer le plan" title="Supprimer le plan" onClick={() => setConfirmDel(true)}>
            <Trash2 size={15} />
          </button>
        )}
        <button
          className={`icon-btn${panel ? ' active' : ''}`}
          aria-label="Ressources"
          aria-pressed={panel}
          title={panel ? 'Masquer les ressources' : 'Afficher les ressources'}
          onClick={() => setPanel((p) => !p)}
        >
          <PanelRight size={15} />
        </button>
        <span className="segmented plan-views" role="tablist" aria-label="Vue du plan">
          {(
            [
              ['plan', 'Plan'],
              ['fiches', 'Fiches'],
              ['tableau', 'Tableau'],
            ] as const
          ).map(([v, l]) => (
            <button key={v} role="tab" aria-selected={view === v} className={view === v ? "active" : ""} onClick={() => setView(v)} data-testid={`plan-view-${v}`}>
              {l}
            </button>
          ))}
        </span>
        {draftExists && plan.draftId ? (
          <button className="btn btn-primary" onClick={() => navigate({ name: 'write', draftId: plan.draftId })} title="Ouvrir l’écrit rattaché (⌘⌥P)" data-testid="plan-open-draft">
            <FilePen size={14} /> Ouvrir l’écrit
          </button>
        ) : (
          <>
            <AttachButton plan={plan} />
            <button className="btn btn-primary" onClick={send} disabled={sending || !hasContent} data-testid="plan-send">
              <Send size={14} /> Créer l’écrit
            </button>
          </>
        )}
      </header>

      <div className="plan-body">
        {view !== 'plan' && (
          <div className="plan-scroll pv-scroll">
            <div className="pv-head">
              <h1 className="pv-title">{plan.sujet.trim() || plan.title || 'Plan sans titre'}</h1>
              {linked && <LinkedLine plan={plan} draftTitle={draft!.title} />}
              <ProgressBar plan={plan} words={totalWords} goal={totalGoal(plan)} />
              {view === 'fiches' && <p className="pv-hint">{linked ? 'Glissez une fiche pour changer l’ordre : le texte de l’écrit suivra. Touches 1 à 4 : statut de la fiche choisie.' : 'Glissez une fiche pour changer l’ordre du plan. Touches 1 à 4 : statut de la fiche choisie.'}</p>}
              {view === 'tableau' && <p className="pv-hint">Glissez une fiche d’une colonne à l’autre pour changer son statut. L’ordre du plan ne bouge pas.</p>}
            </div>
            {view === 'fiches' ? <FichesView {...vp} /> : <TableauView {...vp} />}
          </div>
        )}
        {view === 'plan' && (
        <div className="plan-scroll">
          <div className="plan-doc" ref={docRef}>
            {skeuo && <RedString docRef={docRef} />}
            <AutoTextarea
              className="plan-sujet"
              value={plan.sujet}
              placeholder="Le sujet, tel qu’il est posé"
              aria-label="Sujet"
              rows={1}
              onChange={(v) => set({ sujet: v, title: v.trim() ? v.trim().slice(0, 80) : 'Nouveau plan' })}
            />
            {linked && <LinkedLine plan={plan} draftTitle={draft!.title} />}
            {(linked || plan.parts.length > 0) && <ProgressBar plan={plan} words={totalWords} goal={totalGoal(plan)} />}
            <SectionBar label="Introduction" k="intro" progress={plan.introProgress ?? {}} vp={vp} />

            <Field
              label="Définitions"
              hint="Les termes du sujet, tels que vous les entendez. Une définition par ligne."
              value={plan.definitions}
              placeholder="Liberté : …"
              onChange={(v) => set({ definitions: v })}
              id="def"
            />
            <Field
              label="Problématique"
              hint="La question que le sujet fait naître, et qu’il faut trancher."
              value={plan.problematique}
              placeholder="Peut-on… sans… ?"
              onChange={(v) => set({ problematique: v })}
              id="prob"
            />

            <section className="plan-parts">
              <h2 className="plan-h">Parties</h2>
              {plan.parts.length === 0 ? (
                <div className="plan-parts-empty anim-in">
                  <p>
                    Une dissertation avance en deux ou trois parties. Ajoutez la première, puis glissez-y des extraits
                    depuis le panneau de droite.
                  </p>
                  <button className="btn" onClick={() => addPart(null)} data-testid="add-part">
                    <Plus size={14} /> Ajouter une partie
                  </button>
                </div>
              ) : (
                <>
                  <div className="plan-nodes">
                    {plan.parts.map((n, i) => (
                      <NodeCard
                        key={n.id}
                        node={n}
                        depth={0}
                        index={i}
                        siblings={plan.parts.length}
                        parts={plan.parts}
                        setParts={setParts}
                        targetId={targetNode?.node.id ?? null}
                        setTarget={setTarget}
                        fresh={fresh}
                        onAddChild={addPart}
                        onPlace={place}
                        vp={vp}
                        reorder={reorder}
                        rename={rename}
                        inDraft={linked && !missing.has(n.id)}
                      />
                    ))}
                  </div>
                  <button className="btn btn-sm plan-add-part" onClick={() => addPart(null)} data-testid="add-part">
                    <Plus size={13} /> Ajouter une partie
                  </button>
                </>
              )}
            </section>

            <SectionBar label="Conclusion" k="conclusion" progress={plan.conclusionProgress ?? {}} vp={vp} />
            <Field
              label="Conclusion"
              hint="La réponse à la problématique, en deux ou trois phrases."
              value={plan.conclusion}
              placeholder="En somme…"
              onChange={(v) => set({ conclusion: v })}
              id="concl"
            />
          </div>
        </div>
        )}
        {panel && view === 'plan' && (
          <ResourcePanel
            placed={placed}
            targetLabel={targetNode ? targetNode.path : null}
            onAdd={(ref) => targetNode && place(targetNode.node.id, ref)}
          />
        )}
      </div>
    </div>
  );
}

function Field({
  label,
  hint,
  value,
  placeholder,
  onChange,
  id,
}: {
  label: string;
  hint: string;
  value: string;
  placeholder: string;
  onChange(v: string): void;
  id: string;
}) {
  return (
    <section className="plan-field" data-field={id}>
      <label className="plan-h" htmlFor={`plan-${id}`}>
        {label}
      </label>
      <AutoTextarea
        id={`plan-${id}`}
        className="textarea plan-ta"
        value={value}
        placeholder={placeholder}
        rows={2}
        onChange={onChange}
      />
      <div className="plan-help">{hint}</div>
    </section>
  );
}

interface NodeProps {
  node: PlanNode;
  depth: number;
  index: number;
  siblings: number;
  parts: PlanNode[];
  setParts(p: PlanNode[]): void;
  targetId: string | null;
  setTarget(id: string): void;
  fresh: string | null;
  onAddChild(parentId: string): void;
  onPlace(nodeId: string, ref: PlanItemRef): void;
  vp: ViewProps;
  reorder(p: PlanNode[]): void;
  rename(id: string, title: string, p: PlanNode[]): void;
  /** Partie présente dans l'écrit rattaché (sa suppression passe par l'écrit). */
  inDraft: boolean;
}

function NodeCard(props: NodeProps) {
  const { node, depth, index, siblings, parts, setParts, targetId, setTarget, fresh, onAddChild, onPlace, vp, reorder, rename } = props;
  const inDraft = vp.linked && !vp.missing.has(node.id);
  const [over, setOver] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState('');
  const label = nodeLabel(depth, index);
  const upd = (fn: (n: PlanNode) => PlanNode) => setParts(updateNode(parts, node.id, fn));

  const accepts = (e: React.DragEvent) => hasType(e, RES_MIME) || hasType(e, ITEM_MIME);

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setOver(false);
    document.body.classList.remove('plan-dragging');
    const res = e.dataTransfer.getData(RES_MIME);
    if (res) {
      try {
        onPlace(node.id, JSON.parse(res) as ResRef);
      } catch {
        /* charge invalide : ignorée */
      }
      return;
    }
    const itemId = e.dataTransfer.getData(ITEM_MIME);
    const it = itemId ? findItem(parts, itemId) : null;
    if (it && !node.items.some((x) => x.id === itemId)) {
      setParts(addItem(removeItem(parts, itemId), node.id, it.ref));
      setTarget(node.id);
    }
  };

  const addText = () => {
    const t = draft.trim();
    if (t) onPlace(node.id, { kind: 'text', text: t });
    setDraft('');
    setAdding(false);
  };

  return (
    <div
      className={`plan-node depth-${depth}${over ? ' over' : ''}${targetId === node.id ? ' target' : ''}${fresh === node.id ? ' plan-pop' : ''}`}
      data-nid={node.id}
      onFocusCapture={() => setTarget(node.id)}
      onClick={() => setTarget(node.id)}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return;
        statusKey(e, (st) => vp.setProgress(node.id, { status: st === 'todo' ? undefined : st, goal: node.goal }));
      }}
      tabIndex={-1}

      onDragOver={(e) => {
        if (!accepts(e)) return;
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = hasType(e, ITEM_MIME) ? 'move' : 'copy';
        if (!over) setOver(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(false);
      }}
      onDrop={onDrop}
    >
      <div className="plan-node-head">
        <span className="plan-node-label">{label}</span>
        <input
          className="plan-node-title"
          value={node.title}
          placeholder={depth === 0 ? 'Titre de la partie' : 'Titre de la sous-partie'}
          aria-label={`Titre ${label}`}
          autoFocus={fresh === node.id}
          onChange={(e) => rename(node.id, e.target.value, updateNode(parts, node.id, (n) => ({ ...n, title: e.target.value })))}
        />
        <StatusPill progress={node} words={vp.words.get(node.id)} onChange={(p) => vp.setProgress(node.id, p)} />
        <div className="plan-node-tools">
          <button
            className="icon-btn sm"
            aria-label="Monter"
            title="Monter"
            disabled={index === 0}
            onClick={() => reorder(shiftNode(parts, node.id, -1))}
          >
            <ArrowUp size={13} />
          </button>
          <button
            className="icon-btn sm"
            aria-label="Descendre"
            title="Descendre"
            disabled={index === siblings - 1}
            onClick={() => reorder(shiftNode(parts, node.id, 1))}
          >
            <ArrowDown size={13} />
          </button>
          {confirm && inDraft && depth < 2 ? (
            <span className="plan-confirm anim-fade">
              Cette partie est dans l’écrit : supprimez son titre là-bas.
              <button className="btn btn-sm" onClick={() => vp.write(node.id)}>
                Ouvrir l’écrit
              </button>
              <button className="icon-btn sm" aria-label="Annuler" onClick={() => setConfirm(false)}>
                <X size={13} />
              </button>
            </span>
          ) : confirm ? (
            <span className="plan-confirm anim-fade">
              <button className="btn btn-sm btn-danger" onClick={() => setParts(removeNode(parts, node.id))}>
                Supprimer
              </button>
              <button className="icon-btn sm" aria-label="Annuler" onClick={() => setConfirm(false)}>
                <X size={13} />
              </button>
            </span>
          ) : (
            <button className="icon-btn sm" aria-label="Supprimer" title="Supprimer" onClick={() => setConfirm(true)}>
              <Trash2 size={13} />
            </button>
          )}
        </div>
      </div>

      <AutoTextarea
        className="plan-node-note"
        value={node.note}
        placeholder="Idée directrice : ce que cette partie établit"
        aria-label={`Idée directrice ${label}`}
        rows={1}
        onChange={(v) => upd((n) => ({ ...n, note: v }))}
      />
      <NodeMeta k={node.id} progress={node} vp={vp} />

      <div className="plan-items">
        {node.items.map((it) => (
          <ItemCard
            key={it.id}
            id={it.id}
            refItem={it.ref}
            onRemove={() => setParts(removeItem(parts, it.id))}
          />
        ))}
        {node.items.length === 0 && !adding && (
          <div className="plan-drop-hint">{over ? 'Déposez ici' : 'Glissez un extrait, un concept ou un argument'}</div>
        )}
        {over && node.items.length > 0 && <div className="plan-drop-hint plan-drop-live">Déposez ici</div>}
      </div>

      <div className="plan-node-foot">
        {adding ? (
          <div className="plan-add-text anim-fade">
            <input
              className="input"
              autoFocus
              value={draft}
              placeholder="Une remarque, un exemple, une transition"
              aria-label="Texte libre"
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') addText();
                if (e.key === 'Escape') {
                  setDraft('');
                  setAdding(false);
                }
              }}
            />
            <button className="btn btn-sm" onClick={addText}>
              Ajouter
            </button>
          </div>
        ) : (
          <button className="plan-link" onClick={() => setAdding(true)}>
            <Plus size={12} /> Texte libre
          </button>
        )}
        {depth + 1 < MAX_DEPTH && (
          <button className="plan-link" onClick={() => onAddChild(node.id)} data-testid="add-sub">
            <Plus size={12} /> Sous-partie
          </button>
        )}
      </div>

      {node.children.length > 0 && (
        <div className="plan-children">
          {node.children.map((c, i) => (
            <NodeCard
              key={c.id}
              {...props}
              node={c}
              depth={depth + 1}
              index={i}
              siblings={node.children.length}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ItemCard({ id, refItem, onRemove }: { id: string; refItem: PlanItemRef; onRemove(): void }) {
  const hl = useStore((s) => (refItem.kind === 'highlight' ? s.highlights.find((h) => h.id === refItem.id) : undefined));
  const book = useStore((s) => (hl ? s.books.find((b) => b.id === hl.bookId) : undefined));
  const cpt = useStore((s) => (refItem.kind === 'concept' ? s.concepts.find((c) => c.id === refItem.id) : undefined));
  const arg = useStore((s) => (refItem.kind === 'argument' ? s.arguments.find((a) => a.id === refItem.id) : undefined));

  let kind = 'Texte';
  let body = '';
  let meta = '';
  let missing = false;
  switch (refItem.kind) {
    case 'highlight':
      kind = 'Extrait';
      if (hl) {
        body = hl.text.replace(/\s+/g, ' ').trim();
        meta = [book?.title, hl.printedPage ? `p. ${hl.printedPage}` : hl.locationLabel].filter(Boolean).join(' · ');
      } else missing = true;
      break;
    case 'concept':
      kind = 'Concept';
      if (cpt) body = cpt.name;
      else missing = true;
      break;
    case 'argument':
      kind = 'Argument';
      if (arg) body = arg.title || 'Argument sans titre';
      else missing = true;
      break;
    case 'text':
      body = refItem.text;
      break;
  }

  return (
    <div
      className={`plan-item kind-${refItem.kind}${missing ? ' missing' : ''}`}
      draggable
      data-iid={id}
      onDragStart={(e) => {
        e.stopPropagation();
        e.dataTransfer.setData(ITEM_MIME, id);
        e.dataTransfer.effectAllowed = 'move';
        document.body.classList.add('plan-dragging');
      }}
      onDragEnd={() => document.body.classList.remove('plan-dragging')}
    >
      <div className="plan-item-main">
        <div className="plan-item-kind">
          {refItem.kind === 'highlight' && hl && <KindDot h={hl} size={7} />}
          {kind}
        </div>
        <div className={`plan-item-body${refItem.kind === 'highlight' ? ' read' : ''}`}>
          {missing ? 'Élément supprimé de la bibliothèque' : body}
        </div>
        {meta && <div className="plan-item-meta truncate">{meta}</div>}
      </div>
      <button className="icon-btn sm plan-item-x" aria-label="Retirer du plan" title="Retirer du plan" onClick={onRemove}>
        <X size={13} />
      </button>
    </div>
  );
}

/** Mots écrits / objectif et « Écrire cette partie » (plan rattaché à un écrit). */
function NodeMeta({ k, progress, vp }: { k: string; progress: PlanProgress; vp: ViewProps }) {
  const w = vp.words.get(k);
  if (!vp.linked && !progress.goal) return null;
  const miss = vp.missing.has(k);
  return (
    <div className="plan-node-meta">
      <WordMeter words={vp.linked ? (w ?? 0) : undefined} goal={progress.goal} status={statusOf(progress)} />
      {vp.linked && (
        <button className="plan-link plan-write" onClick={() => vp.write(k)} data-testid="plan-write">
          <FilePen size={12} /> {miss ? 'Ajouter dans l’écrit' : 'Écrire cette partie'}
        </button>
      )}
      {vp.linked && miss && <span className="plan-missing">pas encore dans l’écrit</span>}
    </div>
  );
}

/** Introduction / Conclusion : statut, mots, accès à l'écrit. */
function SectionBar({ label, k, progress, vp }: { label: string; k: 'intro' | 'conclusion'; progress: PlanProgress; vp: ViewProps }) {
  return (
    <div className="plan-section-bar" data-section={k}>
      <span className="plan-h">{label}</span>
      <StatusPill progress={progress} words={vp.words.get(k)} onChange={(p) => vp.setProgress(k, p)} />
      <NodeMeta k={k} progress={progress} vp={vp} />
    </div>
  );
}

/** « Lié à l'écrit … » sous le sujet. */
function LinkedLine({ plan, draftTitle }: { plan: EssayPlan; draftTitle: string }) {
  const navigate = useStore((s) => s.navigate);
  const patch = useStore((s) => s.patch);
  const toast = useStore((s) => s.toast);
  return (
    <div className="plan-linked" data-testid="plan-linked">
      <Link2 size={13} />
      Lié à l’écrit
      <button className="plan-linked-name" onClick={() => navigate({ name: 'write', draftId: plan.draftId })}>
        « {draftTitle || 'Sans titre'} »
      </button>
      <span className="muted">
        · {plan.pendingOrder || plan.pendingRenames ? 'l’écrit suivra vos changements à sa prochaine ouverture' : 'le plan suit les titres de l’écrit'}
      </span>
      <button
        className="plan-link plan-unlink"
        onClick={() => {
          patch('plans', plan.id, { draftId: null, pendingOrder: false, pendingRenames: undefined });
          toast('Plan détaché de l’écrit. L’écrit est intact.', 'info');
        }}
      >
        Détacher
      </button>
    </div>
  );
}

/** « Rattacher à un écrit… » : un écrit qui n'a pas encore de plan. */
function AttachButton({ plan }: { plan: EssayPlan }) {
  const [open, setOpen] = useState(false);
  const drafts = useStore(useShallow((s) => s.drafts));
  const plans = useStore(useShallow((s) => s.plans));
  const patch = useStore((s) => s.patch);
  const toast = useStore((s) => s.toast);
  const taken = new Set(plans.filter((p) => p.id !== plan.id && p.draftId).map((p) => p.draftId));
  const free = [...drafts].filter((d) => !taken.has(d.id)).sort((a, b) => b.updatedAt - a.updatedAt);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);
  if (!drafts.length) return null;
  return (
    <div className="plan-attach" ref={ref}>
      <button className="btn" onClick={() => setOpen((o) => !o)} aria-haspopup="menu" aria-expanded={open} data-testid="plan-attach">
        <Link2 size={14} /> Rattacher à un écrit
      </button>
      {open && (
        <div className="plan-attach-menu anim-fade" role="menu">
          <div className="plan-attach-h">Le plan suivra les titres de l’écrit choisi.</div>
          {free.map((d) => (
            <button
              key={d.id}
              role="menuitem"
              onClick={() => {
                const outline = d.outline ?? [];
                const parts = syncPlanFromDraft({ ...plan, draftId: d.id, pendingOrder: false }, outline);
                patch('plans', plan.id, { draftId: d.id, pendingOrder: false, ...(parts ? { parts } : {}) });
                setOpen(false);
                if (!d.outline) {
                  toast(`Plan rattaché à « ${d.title || 'Sans titre'} ». Ouvrez l’écrit une fois : ses titres y seront retrouvés.`, 'success');
                  return;
                }
                const m = matchPlan({ ...plan, parts: parts ?? plan.parts }, outline);
                const found = Array.from(m.byKey.keys()).filter((k) => k !== 'intro' && k !== 'conclusion').length;
                toast(`Plan rattaché à « ${d.title || 'Sans titre'} » : ${found} partie${found > 1 ? 's' : ''} retrouvée${found > 1 ? 's' : ''} dans le texte`, 'success');
              }}
            >
              <span className="truncate">{d.title || 'Sans titre'}</span>
              <small>{(d.outline?.length ?? 0) || 'aucun'} titre{(d.outline?.length ?? 0) > 1 ? 's' : ''}</small>
            </button>
          ))}
          {!free.length && <div className="plan-attach-none">Tous vos écrits ont déjà un plan.</div>}
        </div>
      )}
    </div>
  );
}
