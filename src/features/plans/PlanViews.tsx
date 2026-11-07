// Statut des parties (pastille + menu), barre d'avancement, vues « Fiches » (l'ordre, par partie)
// et « Tableau » (l'avancement, par statut). Le lien avec l'écrit : planLink.ts.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, FilePen, Plus } from 'lucide-react';
import type { EssayPlan, PlanNode, PlanProgress, PlanStatus } from '../../lib/types';
import { useFloating } from '../../components/ui';
import { STATUSES, statusCounts, statusLabel, statusOf } from './planLink';
import { nodeLabel } from './planTree';
import './status.css';

const fmtN = (n: number) => n.toLocaleString('fr-FR');

/** Touches 1 à 4 sur une fiche ou une partie sélectionnée : change son statut. */
export function statusKey(e: React.KeyboardEvent, set: (s: PlanStatus) => void): boolean {
  const t = e.target as HTMLElement;
  if (e.metaKey || e.ctrlKey || e.altKey || t.closest('input, textarea, [contenteditable="true"]')) return false;
  const k = ['1', '2', '3', '4'].indexOf(e.key);
  if (k < 0) return false;
  e.preventDefault();
  set(STATUSES[k].id);
  return true;
}

/** Pastille de statut : un clic ouvre les quatre statuts et l'objectif de mots. */
export function StatusPill({ progress, onChange, words, compact }: { progress: PlanProgress; onChange(p: PlanProgress): void; words?: number; compact?: boolean }) {
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const [setFloat, style] = useFloating(anchor, 'below');
  const st = statusOf(progress);
  const [goal, setGoal] = useState(progress.goal ? String(progress.goal) : '');
  useEffect(() => setGoal(progress.goal ? String(progress.goal) : ''), [progress.goal]);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      const t = e.target as Node;
      if (btn.current?.contains(t) || (t as HTMLElement).closest?.('.st-menu')) return;
      setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);
  const commitGoal = () => {
    const n = parseInt(goal.replace(/\s/g, ''), 10);
    onChange({ ...progress, goal: Number.isFinite(n) && n > 0 ? n : undefined });
  };
  return (
    <>
      <button
        ref={btn}
        type="button"
        className={`st-pill${compact ? ' compact' : ''}${open ? ' open' : ''}`}
        data-status={st}
        aria-haspopup="menu"
        aria-expanded={open}
        title="Changer le statut (touches 1 à 4)"
        onClick={(e) => {
          e.stopPropagation();
          setAnchor(btn.current!.getBoundingClientRect());
          setOpen((o) => !o);
        }}
      >
        <span className={`st-dot st-${st}`} />
        {statusLabel(st)}
        <ChevronDown size={11} className="st-chev" />
      </button>
      {open &&
        createPortal(
          <div className="st-menu" role="menu" ref={setFloat} style={style} onClick={(e) => e.stopPropagation()}>
            {STATUSES.map((s, i) => (
              <button
                key={s.id}
                role="menuitemradio"
                aria-checked={s.id === st}
                className={s.id === st ? 'on' : ''}
                onClick={() => {
                  onChange({ ...progress, status: s.id === 'todo' ? undefined : s.id });
                  setOpen(false);
                }}
              >
                <span className={`st-dot st-${s.id}`} />
                {s.label}
                <kbd>{i + 1}</kbd>
              </button>
            ))}
            <label className="st-goal">
              Objectif
              <input
                className="input"
                inputMode="numeric"
                value={goal}
                placeholder="—"
                aria-label="Objectif de mots"
                onChange={(e) => setGoal(e.target.value.replace(/[^\d\s]/g, ''))}
                onBlur={commitGoal}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    commitGoal();
                    setOpen(false);
                  }
                }}
              />
              mots
            </label>
            {words !== undefined && <div className="st-written">{fmtN(words)} mots écrits</div>}
          </div>,
          document.body,
        )}
    </>
  );
}

/** Mots écrits / objectif, avec une jauge. */
export function WordMeter({ words, goal, status }: { words: number | undefined; goal?: number; status: PlanStatus }) {
  if (words === undefined && !goal) return null;
  const pct = goal ? Math.min(100, Math.round(((words ?? 0) / goal) * 100)) : 0;
  return (
    <span className="st-meter">
      <span className="st-meter-n">
        {words === undefined ? '—' : fmtN(words)}
        {goal ? ` / ${fmtN(goal)}` : ''} mots
      </span>
      {goal ? (
        <span className="st-meter-bar">
          <i className={`st-${status}`} style={{ width: `${pct}%` }} />
        </span>
      ) : null}
    </span>
  );
}

/** Barre d'avancement du plan : proportion de chaque statut. */
export function ProgressBar({ plan, words, goal }: { plan: EssayPlan; words: number | null; goal: number }) {
  const c = statusCounts(plan);
  const total = c.todo + c.draft + c.review + c.done;
  const parts: string[] = [];
  if (c.done) parts.push(`${c.done} terminée${c.done > 1 ? 's' : ''}`);
  if (c.review) parts.push(`${c.review} à relire`);
  if (c.draft) parts.push(`${c.draft} brouillon${c.draft > 1 ? 's' : ''}`);
  if (c.todo) parts.push(`${c.todo} à écrire`);
  return (
    <div className="st-progress" data-testid="plan-progress">
      <div className="st-progress-bar" aria-hidden>
        {(['done', 'review', 'draft'] as const).map((k) => (c[k] ? <i key={k} className={`st-${k}`} style={{ width: `${(c[k] / total) * 100}%` }} /> : null))}
      </div>
      <span className="st-progress-txt">{parts.join(' · ')}</span>
      {words !== null && (
        <span className="st-progress-words">
          {fmtN(words)}
          {goal ? ` / ${fmtN(goal)}` : ''} mots
        </span>
      )}
    </div>
  );
}

// ── Fiches : l'ordre du plan, une rangée par partie ──

const CARD_MIME = 'application/x-marginalia-plan-card';

export interface ViewProps {
  plan: EssayPlan;
  words: Map<string, number>;
  missing: Set<string>;
  linked: boolean;
  setProgress(key: string, p: PlanProgress): void;
  /** Déplace `id` avant/après `targetId`, ou à la fin des sous-parties de `parentId`. */
  move(id: string, to: { targetId: string; after: boolean } | { parentId: string }): void;
  addChild(parentId: string | null): void;
  openAt(key: string): void;
  write(key: string): void;
  sourcesOf(n: PlanNode): number;
}

function Card({
  k,
  label,
  title,
  note,
  progress,
  words,
  missing,
  sources,
  draggable,
  onDropOn,
  vp,
  extra,
}: {
  k: string;
  label?: string;
  title: string;
  note?: string;
  progress: PlanProgress;
  words: number | undefined;
  missing: boolean;
  sources?: number;
  draggable: boolean;
  onDropOn?: (dragged: string, after: boolean) => void;
  vp: ViewProps;
  extra?: ReactNode;
}) {
  const [drop, setDrop] = useState<'before' | 'after' | null>(null);
  const st = statusOf(progress);
  return (
    <div
      className={`pv-card${drop ? ` drop-${drop}` : ''}${missing && vp.linked ? ' missing' : ''}`}
      tabIndex={0}
      data-key={k}
      data-testid="pv-card"
      draggable={draggable}
      onDragStart={(e) => {
        e.dataTransfer.setData(CARD_MIME, k);
        e.dataTransfer.effectAllowed = 'move';
        (e.currentTarget as HTMLElement).classList.add('lifting');
      }}
      onDragEnd={(e) => (e.currentTarget as HTMLElement).classList.remove('lifting')}
      onDragOver={(e) => {
        if (!onDropOn || !Array.from(e.dataTransfer.types).includes(CARD_MIME)) return;
        e.preventDefault();
        e.stopPropagation();
        const r = e.currentTarget.getBoundingClientRect();
        setDrop(e.clientX > r.left + r.width / 2 ? 'after' : 'before');
      }}
      onDragLeave={() => setDrop(null)}
      onDrop={(e) => {
        const id = e.dataTransfer.getData(CARD_MIME);
        const d = drop;
        setDrop(null);
        if (!onDropOn || !id || id === k) return;
        e.preventDefault();
        e.stopPropagation();
        onDropOn(id, d === 'after');
      }}
      onKeyDown={(e) => {
        if (statusKey(e, (s) => vp.setProgress(k, { ...progress, status: s === 'todo' ? undefined : s }))) return;
        if (e.key === 'Enter' && e.target === e.currentTarget) vp.openAt(k);
      }}
      onDoubleClick={() => vp.openAt(k)}
    >
      <div className="pv-card-top">
        <StatusPill progress={progress} words={words} compact onChange={(p) => vp.setProgress(k, p)} />
        {extra}
      </div>
      <h5 className="pv-card-title">
        {label && <span className="pv-card-label">{label}</span>}
        {title || 'Sans titre'}
      </h5>
      {note?.trim() && <p className="pv-card-note">{note.trim()}</p>}
      <div className="pv-card-foot">
        <WordMeter words={words} goal={progress.goal} status={st} />
        {sources ? <span>{sources} source{sources > 1 ? 's' : ''}</span> : null}
        {vp.linked && (
          <button className="pv-card-write" onClick={() => vp.write(k)} title={missing ? 'Créer ce titre dans l’écrit' : 'Ouvrir l’écrit à cette partie'}>
            <FilePen size={12} /> {missing ? 'Ajouter dans l’écrit' : 'Écrire'}
          </button>
        )}
      </div>
    </div>
  );
}

export function FichesView(vp: ViewProps) {
  const { plan, words, missing } = vp;
  const [overRow, setOverRow] = useState<string | null>(null);
  const rowDrop = (parentId: string) => ({
    onDragOver: (e: React.DragEvent) => {
      if (!Array.from(e.dataTransfer.types).includes(CARD_MIME)) return;
      e.preventDefault();
      setOverRow(parentId);
    },
    onDragLeave: (e: React.DragEvent) => {
      if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOverRow(null);
    },
    onDrop: (e: React.DragEvent) => {
      setOverRow(null);
      const id = e.dataTransfer.getData(CARD_MIME);
      if (!id || id === parentId) return;
      e.preventDefault();
      vp.move(id, { parentId });
    },
  });
  return (
    <div className="pv-fiches" data-testid="plan-fiches">
      <section className="pv-row">
        <h3 className="pv-row-h">
          Introduction <small>{words.has('intro') ? `${fmtN(words.get('intro')!)} mots` : ''}</small>
        </h3>
        <div className="pv-cards">
          <Card k="intro" title="Introduction" note={plan.problematique} progress={plan.introProgress ?? {}} words={words.get('intro')} missing={missing.has('intro')} draggable={false} vp={vp} />
        </div>
      </section>
      {plan.parts.map((p, i) => (
        <section key={p.id} className={`pv-row${overRow === p.id ? ' over' : ''}`} {...rowDrop(p.id)}>
          <h3
            className="pv-row-h"
            draggable
            onDragStart={(e) => {
              e.dataTransfer.setData(CARD_MIME, p.id);
              e.dataTransfer.effectAllowed = 'move';
            }}
            title="Glisser pour déplacer la partie"
          >
            <span className="pv-row-num">{nodeLabel(0, i)}</span> {p.title || 'Sans titre'}
            <small>{words.has(p.id) ? `${fmtN(words.get(p.id)!)} mots` : vp.linked ? 'pas encore dans l’écrit' : ''}</small>
            <span className="pv-row-pill" onDragStart={(e) => e.preventDefault()}>
              <StatusPill progress={p} words={words.get(p.id)} compact onChange={(pr) => vp.setProgress(p.id, pr)} />
            </span>
          </h3>
          <div className="pv-cards">
            {p.children.map((c, j) => (
              <Card
                key={c.id}
                k={c.id}
                label={nodeLabel(1, j)}
                title={c.title}
                note={c.note}
                progress={c}
                words={words.get(c.id)}
                missing={missing.has(c.id)}
                sources={vp.sourcesOf(c)}
                draggable
                onDropOn={(id, after) => vp.move(id, { targetId: c.id, after })}
                vp={vp}
              />
            ))}
            <button className="pv-card pv-card-add" onClick={() => vp.addChild(p.id)}>
              <Plus size={14} /> Sous-partie
            </button>
          </div>
        </section>
      ))}
      <button className="btn btn-sm pv-add-part" onClick={() => vp.addChild(null)}>
        <Plus size={13} /> Ajouter une partie
      </button>
      <section className="pv-row">
        <h3 className="pv-row-h">
          Conclusion <small>{words.has('conclusion') ? `${fmtN(words.get('conclusion')!)} mots` : ''}</small>
        </h3>
        <div className="pv-cards">
          <Card k="conclusion" title="Conclusion" note={plan.conclusion} progress={plan.conclusionProgress ?? {}} words={words.get('conclusion')} missing={missing.has('conclusion')} draggable={false} vp={vp} />
        </div>
      </section>
    </div>
  );
}

// ── Tableau : l'avancement, une colonne par statut ──

interface Unit {
  key: string;
  path: string;
  title: string;
  note: string;
  progress: PlanProgress;
  sources: number;
}

/** Ce qui s'écrit : introduction, sous-parties (ou la partie si elle n'en a pas), conclusion. */
export function writingUnits(plan: EssayPlan, sourcesOf: (n: PlanNode) => number): Unit[] {
  const out: Unit[] = [{ key: 'intro', path: 'Début', title: 'Introduction', note: plan.problematique, progress: plan.introProgress ?? {}, sources: 0 }];
  plan.parts.forEach((p, i) => {
    const pl = `${nodeLabel(0, i)} ${p.title || 'Sans titre'}`;
    if (!p.children.length) out.push({ key: p.id, path: 'Partie', title: pl, note: p.note, progress: p, sources: sourcesOf(p) });
    p.children.forEach((c, j) => out.push({ key: c.id, path: pl, title: `${nodeLabel(1, j)} ${c.title || 'Sans titre'}`, note: c.note, progress: c, sources: sourcesOf(c) }));
  });
  out.push({ key: 'conclusion', path: 'Fin', title: 'Conclusion', note: plan.conclusion, progress: plan.conclusionProgress ?? {}, sources: 0 });
  return out;
}

export function TableauView(vp: ViewProps) {
  const units = writingUnits(vp.plan, vp.sourcesOf);
  const [over, setOver] = useState<PlanStatus | null>(null);
  return (
    <div className="pv-board" data-testid="plan-tableau">
      {STATUSES.map((s) => {
        const col = units.filter((u) => statusOf(u.progress) === s.id);
        return (
          <section
            key={s.id}
            className={`pv-col${over === s.id ? ' over' : ''}`}
            data-status={s.id}
            onDragOver={(e) => {
              if (!Array.from(e.dataTransfer.types).includes(CARD_MIME)) return;
              e.preventDefault();
              setOver(s.id);
            }}
            onDragLeave={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(null);
            }}
            onDrop={(e) => {
              setOver(null);
              const k = e.dataTransfer.getData(CARD_MIME);
              const u = units.find((x) => x.key === k);
              if (!u) return;
              e.preventDefault();
              vp.setProgress(k, { ...u.progress, status: s.id === 'todo' ? undefined : s.id });
            }}
          >
            <h4 className="pv-col-h">
              <span className={`st-dot st-${s.id}`} />
              {s.label}
              <small>{col.length}</small>
            </h4>
            {col.map((u) => (
              <Card
                key={u.key}
                k={u.key}
                title={u.title}
                note={u.note}
                progress={u.progress}
                words={vp.words.get(u.key)}
                missing={vp.missing.has(u.key)}
                sources={u.sources}
                draggable
                vp={vp}
                extra={<span className="pv-card-path truncate">{u.path}</span>}
              />
            ))}
            {!col.length && <div className="pv-col-empty">Glissez une fiche ici</div>}
          </section>
        );
      })}
    </div>
  );
}
