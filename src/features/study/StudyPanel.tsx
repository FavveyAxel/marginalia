// Fiche-texte : problème / thèse / enjeu, mouvements dans l'ordre du texte, plan généré.
import { useMemo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { Copy, FilePlus2, Send, TextQuote, Trash2, X } from 'lucide-react';
import { uid, useStore } from '../../lib/store';
import { CATEGORY_BY_ID } from '../../lib/categories';
import type { Anchor, CategoryId, Movement, TextStudy } from '../../lib/types';
import { createDraft } from '../editor/api';
import { AutoTextarea } from './AutoTextarea';
import { ROLE_SUGGESTIONS, compareAnchors, planLines, planText, sortMovements, studyHtml } from './studyUtils';
import { CategoryDot, Kbd } from '../../components/ui';
import './study.css';

type FieldKey = 'probleme' | 'these' | 'enjeu';

const FIELDS: { key: FieldKey; label: string; hint: string; placeholder: string; cat?: CategoryId }[] = [
  {
    key: 'probleme',
    label: 'Problème',
    hint: 'Formulez le problème sous forme de question.',
    placeholder: 'Quelle question le texte affronte-t-il ?',
    cat: 'probleme',
  },
  {
    key: 'these',
    label: 'Thèse',
    hint: 'En une phrase complète : ce que l’auteur soutient.',
    placeholder: 'L’auteur soutient que…',
    cat: 'these',
  },
  {
    key: 'enjeu',
    label: 'Enjeu',
    hint: 'Ce qui se joue, pour la pensée, dans cette réponse.',
    placeholder: 'Pourquoi cette question compte-t-elle ?',
  },
];

function useBookStudies(bookId: string) {
  return useStore(useShallow((s) => s.studies.filter((x) => x.bookId === bookId)));
}

export function StudyPanel({ bookId, onGoTo }: { bookId: string; onGoTo(anchor: Anchor): void }) {
  const studies = useBookStudies(bookId);
  const [picked, setPicked] = useState<string | null>(null);
  const insert = useStore((s) => s.insert);
  const book = useStore((s) => s.books.find((b) => b.id === bookId) ?? null);

  const ordered = useMemo(() => [...studies].sort((a, b) => b.updatedAt - a.updatedAt), [studies]);
  const study = ordered.find((x) => x.id === picked) ?? ordered[0] ?? null;

  const create = () => {
    const now = Date.now();
    const created: TextStudy = {
      id: uid(),
      bookId,
      title: ordered.length ? `Passage ${ordered.length + 1}` : 'Passage étudié',
      probleme: '',
      these: '',
      enjeu: '',
      movements: [],
      createdAt: now,
      updatedAt: now,
    };
    insert('studies', created);
    setPicked(created.id);
  };

  if (!study) {
    return (
      <div className="study-panel">
        <div className="empty study-empty anim-in">
          <h3>Pas encore de fiche</h3>
          <p>
            Pour découper le texte en mouvements, sélectionnez le début d’un mouvement puis appuyez sur <Kbd>M</Kbd>
            . La fiche se crée alors d’elle-même.
          </p>
          <button className="btn btn-sm" onClick={create}>
            <FilePlus2 size={14} /> Nouvelle fiche
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="study-panel">
      <StudyBody
        key={study.id}
        study={study}
        bookId={bookId}
        bookTitle={book?.title ?? ''}
        all={ordered}
        onPick={setPicked}
        onCreate={create}
        onGoTo={onGoTo}
      />
    </div>
  );
}

function StudyBody({
  study,
  bookId,
  bookTitle,
  all,
  onPick,
  onCreate,
  onGoTo,
}: {
  study: TextStudy;
  bookId: string;
  bookTitle: string;
  all: TextStudy[];
  onPick(id: string): void;
  onCreate(): void;
  onGoTo(anchor: Anchor): void;
}) {
  const patch = useStore((s) => s.patch);
  const remove = useStore((s) => s.remove);
  const toast = useStore((s) => s.toast);
  const navigate = useStore((s) => s.navigate);
  const [confirmDel, setConfirmDel] = useState(false);
  const [sending, setSending] = useState(false);

  const movements = useMemo(() => sortMovements(study.movements), [study.movements]);
  const lines = useMemo(() => planLines(study), [study]);

  const set = (p: Partial<TextStudy>) => patch('studies', study.id, p);
  const setMovement = (id: string, p: Partial<Movement>) =>
    set({ movements: study.movements.map((m) => (m.id === id ? { ...m, ...p } : m)) });
  const delMovement = (id: string) => set({ movements: study.movements.filter((m) => m.id !== id) });

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(planText(study));
      toast('Plan copié', 'success');
    } catch {
      toast('Impossible de copier le plan', 'error');
    }
  };

  const send = async () => {
    if (sending) return;
    setSending(true);
    try {
      const draft = await createDraft({
        title: study.title.trim() || 'Explication de texte',
        template: 'explication',
        html: studyHtml(study),
      });
      toast('Écrit créé depuis la fiche', 'success');
      navigate({ name: 'write', draftId: draft.id });
    } catch (e) {
      console.error(e);
      toast('Impossible de créer l’écrit pour le moment', 'error');
    } finally {
      setSending(false);
    }
  };

  return (
    <>
      <div className="study-head">
        {all.length > 1 ? (
          <select
            className="study-select"
            value={study.id}
            onChange={(e) => onPick(e.target.value)}
            aria-label="Choisir une fiche"
          >
            {all.map((x) => (
              <option key={x.id} value={x.id}>
                {x.title || 'Sans titre'}
              </option>
            ))}
          </select>
        ) : (
          <span className="study-kicker">Fiche-texte</span>
        )}
        <span className="spacer" />
        <button className="icon-btn sm" title="Nouvelle fiche" aria-label="Nouvelle fiche" onClick={onCreate}>
          <FilePlus2 size={14} />
        </button>
        {confirmDel ? (
          <span className="study-confirm anim-fade">
            Supprimer la fiche ?
            <button
              className="btn btn-sm btn-danger"
              onClick={() => {
                remove('studies', study.id);
              }}
            >
              Supprimer
            </button>
            <button className="btn btn-sm btn-ghost" onClick={() => setConfirmDel(false)}>
              Garder
            </button>
          </span>
        ) : (
          <button
            className="icon-btn sm"
            title="Supprimer la fiche"
            aria-label="Supprimer la fiche"
            onClick={() => setConfirmDel(true)}
          >
            <Trash2 size={14} />
          </button>
        )}
      </div>

      <input
        className="study-title"
        value={study.title}
        placeholder="Intitulé du passage"
        aria-label="Intitulé du passage"
        onChange={(e) => set({ title: e.target.value })}
      />
      {bookTitle && <div className="study-book truncate">{bookTitle}</div>}

      {FIELDS.map((f) => (
        <Field
          key={f.key}
          def={f}
          value={study[f.key]}
          bookId={bookId}
          onChange={(v) => set({ [f.key]: v } as Partial<TextStudy>)}
        />
      ))}

      <section className="study-section">
        <h4 className="study-h">
          Mouvements <span className="study-count">{movements.length}</span>
        </h4>
        {movements.length === 0 ? (
          <p className="study-note">
            Aucun mouvement. Sélectionnez le début d’un mouvement dans le texte, puis appuyez sur <Kbd>M</Kbd> (ou
            utilisez le bouton de la barre de sélection). Les mouvements se rangent dans l’ordre du texte.
          </p>
        ) : (
          <ol className="study-moves anim-stagger">
            {movements.map((m, i) => (
              <MovementCard
                key={m.id}
                m={m}
                index={i}
                onChange={(p) => setMovement(m.id, p)}
                onDelete={() => delMovement(m.id)}
                onGoTo={() => onGoTo(m.anchor)}
              />
            ))}
          </ol>
        )}
      </section>

      <section className="study-section">
        <h4 className="study-h">Plan généré</h4>
        {lines.length === 0 ? (
          <p className="study-note">Le plan apparaîtra ici, mouvement après mouvement.</p>
        ) : (
          <ul className="study-plan anim-stagger" data-testid="study-plan">
            {lines.map((l, i) => (
              <li key={i} style={{ ['--i' as string]: i }}>
                <span className="study-plan-n">{l.label}</span>
                <span>
                  <span className="study-plan-t">{l.title}</span>
                  {l.role && <span className="study-plan-r"> ({l.role})</span>}
                  {l.start && <span className="study-plan-s"> — « {l.start}… »</span>}
                </span>
              </li>
            ))}
          </ul>
        )}
        <div className="study-actions">
          <button className="btn btn-sm" onClick={copy} disabled={!lines.length}>
            <Copy size={13} /> Copier le plan
          </button>
          <button className="btn btn-sm btn-primary" onClick={send} disabled={sending}>
            <Send size={13} /> Envoyer vers l’éditeur
          </button>
        </div>
      </section>
    </>
  );
}

function Field({
  def,
  value,
  bookId,
  onChange,
}: {
  def: (typeof FIELDS)[number];
  value: string;
  bookId: string;
  onChange(v: string): void;
}) {
  const [open, setOpen] = useState(false);
  const cat = def.cat;
  const hls = useStore(
    useShallow((s) => (cat ? s.highlights.filter((h) => h.bookId === bookId && h.category === cat) : [])),
  );
  const sorted = useMemo(() => [...hls].sort((a, b) => compareAnchors(a.anchor, b.anchor)), [hls]);

  const take = (text: string) => {
    const t = text.replace(/\s+/g, ' ').trim();
    onChange(value.trim() ? `${value.trimEnd()} ${t}` : t);
    setOpen(false);
  };

  return (
    <section className="study-field" data-field={def.key}>
      <div className="study-field-top">
        <label className="study-h" htmlFor={`study-${def.key}`}>
          {def.label}
        </label>
        {cat && (
          <button
            className={`study-fill${open ? ' active' : ''}`}
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
          >
            <TextQuote size={12} /> Choisir un extrait
          </button>
        )}
      </div>
      {open && cat && (
        <div className="study-pick anim-in" data-testid={`pick-${def.key}`}>
          {sorted.length === 0 ? (
            <p className="study-note">
              Aucun extrait classé « {CATEGORY_BY_ID[cat].label} » dans ce livre. Surlignez un passage puis appuyez
              sur <Kbd>{CATEGORY_BY_ID[cat].key}</Kbd>.
            </p>
          ) : (
            <>
              <div className="study-pick-label">
                <CategoryDot id={cat} size={8} /> Choisissez un extrait à reprendre
              </div>
              {sorted.map((h) => (
                <button key={h.id} className="study-pick-item" onClick={() => take(h.text)}>
                  <span className="study-pick-text">{h.text}</span>
                  <span className="study-pick-loc">{h.locationLabel}</span>
                </button>
              ))}
            </>
          )}
        </div>
      )}
      <AutoTextarea
        id={`study-${def.key}`}
        className="textarea study-ta"
        value={value}
        placeholder={def.placeholder}
        rows={2}
        onChange={onChange}
      />
      <div className="study-help">{def.hint}</div>
    </section>
  );
}

function MovementCard({
  m,
  index,
  onChange,
  onDelete,
  onGoTo,
}: {
  m: Movement;
  index: number;
  onChange(p: Partial<Movement>): void;
  onDelete(): void;
  onGoTo(): void;
}) {
  const [focus, setFocus] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const q = m.role.trim().toLowerCase();
  const sugg = ROLE_SUGGESTIONS.filter((r) => r !== m.role && (!q || r.toLowerCase().includes(q)));
  return (
    <li className="study-move" style={{ ['--i' as string]: index }} data-mid={m.id}>
      <div className="study-move-row">
        <span className="study-move-n">{index + 1}</span>
        <input
          className="study-move-title"
          value={m.title}
          aria-label={`Titre du mouvement ${index + 1}`}
          placeholder={`Mouvement ${index + 1}`}
          onChange={(e) => onChange({ title: e.target.value })}
        />
        {confirm ? (
          <span className="study-confirm anim-fade">
            <button className="btn btn-sm btn-danger" onClick={onDelete}>
              Supprimer
            </button>
            <button className="icon-btn sm" aria-label="Annuler" onClick={() => setConfirm(false)}>
              <X size={13} />
            </button>
          </span>
        ) : (
          <button
            className="icon-btn sm study-move-del"
            title="Supprimer le mouvement"
            aria-label="Supprimer le mouvement"
            onClick={() => setConfirm(true)}
          >
            <Trash2 size={13} />
          </button>
        )}
      </div>
      <div className="study-role">
        <input
          className="study-role-input"
          value={m.role}
          placeholder="Rôle : pose le problème, argumente…"
          aria-label={`Rôle du mouvement ${index + 1}`}
          onFocus={() => setFocus(true)}
          onBlur={() => setFocus(false)}
          onChange={(e) => onChange({ role: e.target.value })}
        />
        {focus && sugg.length > 0 && (
          <div className="study-suggest anim-scale" role="listbox">
            {sugg.map((r) => (
              <button
                key={r}
                className="menu-item"
                role="option"
                onMouseDown={(e) => {
                  e.preventDefault();
                  onChange({ role: r });
                  setFocus(false);
                }}
              >
                {r}
              </button>
            ))}
          </div>
        )}
      </div>
      <button className="study-move-start" onClick={onGoTo} title="Aller au début du mouvement">
        « {m.startText.replace(/\s+/g, ' ').trim()}… »
      </button>
    </li>
  );
}
