// Éditeur d'un plan de dissertation : sujet, définitions, problématique, parties, conclusion.
import { useMemo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import {
  ArrowDown,
  ChevronLeft,
  ArrowUp,
  FilePen,
  PanelRight,
  Plus,
  Send,
  Trash2,
  X,
} from 'lucide-react';
import { useStore } from '../../lib/store';
import type { EssayPlan, PlanItemRef, PlanNode } from '../../lib/types';
import { CategoryDot } from '../../components/ui';
import { createDraft } from '../editor/api';
import { AutoTextarea } from '../study/AutoTextarea';
import { ResourcePanel } from './ResourcePanel';
import { ITEM_MIME, RES_MIME, hasType, type ResRef } from './dnd';
import { planDraftTitle, planHtml } from './planHtml';
import {
  MAX_DEPTH,
  addChild,
  addItem,
  findItem,
  flatten,
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
  const [target, setTarget] = useState<string | null>(null);
  const [confirmDel, setConfirmDel] = useState(false);
  const [sending, setSending] = useState(false);
  const [fresh, setFresh] = useState<string | null>(null);

  const set = (p: Partial<EssayPlan>) => patch('plans', plan.id, p);
  const setParts = (parts: PlanNode[]) => set({ parts });

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
        {draftExists && plan.draftId && (
          <button className="btn" onClick={() => navigate({ name: 'write', draftId: plan.draftId })}>
            <FilePen size={14} /> Ouvrir l’écrit
          </button>
        )}
        <button className="btn btn-primary" onClick={send} disabled={sending || !hasContent} data-testid="plan-send">
          <Send size={14} /> {draftExists ? 'Renvoyer vers l’éditeur' : 'Envoyer vers l’éditeur'}
        </button>
      </header>

      <div className="plan-body">
        <div className="plan-scroll">
          <div className="plan-doc">
            <AutoTextarea
              className="plan-sujet"
              value={plan.sujet}
              placeholder="Le sujet, tel qu’il est posé"
              aria-label="Sujet"
              rows={1}
              onChange={(v) => set({ sujet: v, title: v.trim() ? v.trim().slice(0, 80) : 'Nouveau plan' })}
            />

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
                      />
                    ))}
                  </div>
                  <button className="btn btn-sm plan-add-part" onClick={() => addPart(null)} data-testid="add-part">
                    <Plus size={13} /> Ajouter une partie
                  </button>
                </>
              )}
            </section>

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
        {panel && (
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
}

function NodeCard(props: NodeProps) {
  const { node, depth, index, siblings, parts, setParts, targetId, setTarget, fresh, onAddChild, onPlace } = props;
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
          onChange={(e) => upd((n) => ({ ...n, title: e.target.value }))}
        />
        <div className="plan-node-tools">
          <button
            className="icon-btn sm"
            aria-label="Monter"
            title="Monter"
            disabled={index === 0}
            onClick={() => setParts(shiftNode(parts, node.id, -1))}
          >
            <ArrowUp size={13} />
          </button>
          <button
            className="icon-btn sm"
            aria-label="Descendre"
            title="Descendre"
            disabled={index === siblings - 1}
            onClick={() => setParts(shiftNode(parts, node.id, 1))}
          >
            <ArrowDown size={13} />
          </button>
          {confirm ? (
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
          {refItem.kind === 'highlight' && hl?.category && <CategoryDot id={hl.category} size={7} />}
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
