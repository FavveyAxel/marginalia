// Barre d'outils de l'éditeur : groupes compacts, menus déroulants, états actifs,
// infobulles avec raccourcis. Toutes les actions passent par le DocEngine.
import { Fragment, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import {
  AlignCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
  AlignVerticalSpaceAround,
  Baseline,
  Bold,
  ChevronDown,
  Highlighter,
  ImagePlus,
  IndentDecrease,
  IndentIncrease,
  Italic,
  Link2,
  List,
  ListOrdered,
  ListTree,
  MoreHorizontal,
  Omega,
  Paintbrush,
  Pilcrow,
  Plus,
  Redo2,
  RemoveFormatting,
  SeparatorHorizontal,
  Strikethrough,
  Subscript,
  Superscript,
  Table,
  TableOfContents,
  Trash2,
  Underline,
  Undo2,
  ALargeSmall,
} from 'lucide-react';
import type { Align, DocEngine, EngineState, ParaStyle, TableOp } from './engine';
import type { StylePatch } from './ooxml';
import { Popover, usePop } from './Popover';
import { FontPicker } from './FontPicker';
import { ColorButton, KEYS, MenuRow, NumField, SizeControl, TbButton, keepFocus, tip } from './controls';
import { STYLE_LABEL, STYLE_ORDER, StyleEditor } from './StyleEditor';
import { PrivateNoteTools } from './privateNotesUi';
import { useTypography } from './FindReplace';
import type { PainterMode } from './painter';

export type StructuralOp = (label: string, run: () => Promise<ArrayBuffer>) => Promise<void>;

export interface ToolbarProps {
  engine: () => DocEngine | null;
  fmt: EngineState;
  editable: boolean;
  /** Relit l'état de mise en forme après une action. */
  refresh: () => void;
  /** Opération non annulable par SuperDoc (instantané pour ⌘Z). */
  structural: StructuralOp;
  openLink: (anchor: HTMLElement) => void;
  insertFootnote: () => void;
  undo: () => void;
  redo: () => void;
  /** Reproduire la mise en forme (painter.tsx). */
  painter?: { mode: PainterMode; onButton: (detail: number) => void };
  /** Marques de mise en forme (¶) affichées (marks.tsx). */
  marks?: boolean;
  toggleMarks?: () => void;
  notify: (message: string, tone?: 'info' | 'error' | 'success') => void;
}

const ALIGN_ICON: Record<Align, typeof AlignLeft> = { left: AlignLeft, center: AlignCenter, right: AlignRight, justify: AlignJustify };
const ALIGN_LABEL: Record<Align, string> = { left: 'Aligner à gauche', center: 'Centrer', right: 'Aligner à droite', justify: 'Justifier' };
const ALIGN_KEY: Record<Align, string> = { left: KEYS.left, center: KEYS.center, right: KEYS.right, justify: KEYS.justify };
const LINES = [1, 1.15, 1.5, 2];
const CM = 567;
const fr = (n: number) => String(Math.round(n * 100) / 100).replace('.', ',');

/** Caractères spéciaux du français (U+00A0 espace insécable, U+202F espace fine insécable). */
export const SPECIAL_CHARS: { ch: string; label: string; show?: string }[] = [
  { ch: '«\u00a0', label: 'Guillemet ouvrant et espace insécable', show: '«' },
  { ch: '\u00a0»', label: 'Espace insécable et guillemet fermant', show: '»' },
  { ch: '—', label: 'Tiret cadratin' },
  { ch: '–', label: 'Tiret demi-cadratin' },
  { ch: '…', label: 'Points de suspension' },
  { ch: '\u00a0', label: 'Espace insécable', show: '⍽' },
  { ch: '\u202f', label: 'Espace fine insécable (avant ; ! ?)', show: 'fine' },
  { ch: '’', label: 'Apostrophe typographique' },
  { ch: 'œ', label: 'e dans l’o' },
  { ch: 'Œ', label: 'E dans l’O majuscule' },
  { ch: 'É', label: 'E accent aigu majuscule' },
  { ch: 'À', label: 'A accent grave majuscule' },
  { ch: 'Ç', label: 'C cédille majuscule' },
  { ch: '§', label: 'Paragraphe' },
  { ch: '°', label: 'Degré (n°)' },
  { ch: '×', label: 'Multiplication' },
];

/** Groupes de la barre, dans l'ordre d'affichage. */
type GroupId = 'history' | 'style' | 'font' | 'chars' | 'paragraph' | 'insert';
const GROUP_IDS: GroupId[] = ['history', 'style', 'font', 'chars', 'paragraph', 'insert'];
const GROUP_LABEL: Record<GroupId, string> = { history: 'Historique', style: 'Style', font: 'Police', chars: 'Caractères', paragraph: 'Paragraphe', insert: 'Insertion' };
/** Fenêtre étroite : groupes rangés sous « … » plutôt que de passer la barre sur deux lignes, le moins
 *  utilisé d'abord (Annuler / Rétablir ont ⌘Z / ⌘⇧Z). Style et police restent toujours visibles. */
const COLLAPSE_ORDER: GroupId[] = ['history', 'insert', 'paragraph', 'chars'];
/** Largeur du groupe « … » (bouton 28 px + marges du groupe), avant sa première mesure. */
const MORE_W = 39;

function Group({ children, label, id }: { children: ReactNode; label: string; id: string }) {
  return (
    <div className="ed-tb-group" role="group" aria-label={label} data-group={id}>
      {children}
    </div>
  );
}

export function MenuButton({
  label,
  shortcut,
  icon,
  text,
  active,
  disabled,
  children,
  className = '',
  menuClass = '',
  tb,
  width,
}: {
  label: string;
  shortcut?: string;
  icon?: ReactNode;
  text?: ReactNode;
  active?: boolean;
  disabled?: boolean;
  children: (close: () => void) => ReactNode;
  className?: string;
  menuClass?: string;
  tb: string;
  width?: number;
}) {
  const pop = usePop();
  return (
    <>
      <button
        className={`ed-tb-menu ${text ? 'with-text' : ''} ${active || pop.isOpen ? 'active' : ''} ${className}`}
        disabled={disabled}
        onMouseDown={keepFocus}
        onClick={(e) => pop.toggle(e.currentTarget)}
        title={tip(label, shortcut)}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={pop.isOpen}
        data-tb={tb}
        style={width ? { minWidth: width } : undefined}
      >
        {icon}
        {text && <span className="ed-tb-menu-text">{text}</span>}
        <ChevronDown size={11} className="ed-tb-chev" />
      </button>
      <Popover pop={pop} label={label} className={`ed-menu ${menuClass}`}>
        <div role="menu" aria-label={label}>
          {children(pop.close)}
        </div>
      </Popover>
    </>
  );
}

export function Toolbar(p: ToolbarProps) {
  const { fmt, editable } = p;
  const [styleEdit, setStyleEdit] = useState<ParaStyle | null>(null);
  const styleEditPop = usePop();
  const [grid, setGrid] = useState<[number, number]>([0, 0]);
  const fileRef = useRef<HTMLInputElement>(null);
  const morePop = usePop();
  const barRef = useRef<HTMLDivElement>(null);
  /** Largeurs mesurées des groupes (gardées quand un groupe est rangé sous « … »). */
  const widths = useRef<Partial<Record<GroupId | 'more', number>>>({});
  const [collapsed, setCollapsed] = useState<GroupId[]>([]);
  const [, setFitTick] = useState(0);

  // Une seule ligne : mesure les groupes affichés puis range sous « … » ce qui ne tient pas.
  useLayoutEffect(() => {
    const bar = barRef.current;
    const row = bar?.parentElement;
    if (!bar || !row) return;
    for (const g of bar.querySelectorAll<HTMLElement>(':scope > [data-group]')) widths.current[g.dataset.group as GroupId] = g.getBoundingClientRect().width;
    const cs = getComputedStyle(row);
    const avail = row.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    if (avail <= 0) return;
    const bcs = getComputedStyle(bar);
    let total = parseFloat(bcs.paddingLeft) + parseFloat(bcs.paddingRight) + GROUP_IDS.reduce((n, id) => n + (widths.current[id] ?? 0), 0);
    const next: GroupId[] = [];
    for (const id of COLLAPSE_ORDER) {
      if (total <= avail + 0.5) break;
      if (!next.length) total += widths.current.more ?? MORE_W;
      total -= widths.current[id] ?? 0;
      next.push(id);
    }
    if (next.join() !== collapsed.join()) setCollapsed(next);
  });
  useEffect(() => {
    const row = barRef.current?.parentElement;
    if (!row) return;
    const ro = new ResizeObserver(() => setFitTick((t) => t + 1));
    ro.observe(row);
    return () => ro.disconnect();
  }, []);
  useEffect(() => {
    if (!collapsed.length) morePop.close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collapsed.length]);

  const run = (fn: (e: DocEngine) => void) => {
    const e = p.engine();
    if (!e || !editable) return;
    fn(e);
    p.refresh();
  };
  const curStyle: ParaStyle = fmt.style === 'other' ? 'body' : fmt.style;
  const AlignIcon = ALIGN_ICON[fmt.align];
  const tocN = p.engine()?.tocCount() ?? 0;

  const pickImage = async (file: File) => {
    if (file.size > 15 * 1024 * 1024) {
      p.notify('Image trop lourde (15 Mo au plus). Réduisez-la avant de l’insérer.', 'error');
      return;
    }
    const src = await new Promise<string>((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(String(r.result));
      r.onerror = () => rej(r.error);
      r.readAsDataURL(file);
    });
    const dim = await new Promise<{ w: number; h: number }>((res) => {
      const img = new Image();
      img.onload = () => res({ w: img.naturalWidth || 400, h: img.naturalHeight || 300 });
      img.onerror = () => res({ w: 400, h: 300 });
      img.src = src;
    });
    const alt = file.name.replace(/\.[^.]+$/, '');
    const e = p.engine();
    if (!e) return;
    if (!e.insertImage(src, dim.w, dim.h, alt)) p.notify('Impossible d’insérer cette image. Essayez un fichier PNG ou JPEG.', 'error');
    p.refresh();
  };

  const tableOp = (op: TableOp, label: string) =>
    run((e) => {
      if (!e.tableOp(op)) p.notify(op === 'merge' ? 'Sélectionnez d’abord plusieurs cellules voisines à fusionner.' : `${label} : action impossible ici.`, 'info');
    });

  const groups: Record<GroupId, ReactNode> = {
    history: (
      <Group id="history" label="Historique">
        <TbButton label="Annuler" shortcut={KEYS.undo} disabled={!editable} onClick={p.undo} data-tb="undo">
          <Undo2 size={15} />
        </TbButton>
        <TbButton label="Rétablir" shortcut={KEYS.redo} disabled={!editable} onClick={p.redo} data-tb="redo">
          <Redo2 size={15} />
        </TbButton>
        {p.painter && (
          <TbButton
            label={
              p.painter.mode === 'sticky'
                ? 'Reproduire la mise en forme : pinceau maintenu (Échap ou clic pour arrêter)'
                : p.painter.mode
                  ? 'Reproduire la mise en forme : sélectionnez le texte à mettre en forme (Échap pour annuler)'
                  : 'Reproduire la mise en forme (double-clic : sur plusieurs passages)'
            }
            shortcut={`${KEYS.copyFormat} copier, ${KEYS.pasteFormat} coller`}
            active={!!p.painter.mode}
            className={p.painter.mode === 'sticky' ? 'sticky' : ''}
            disabled={!editable}
            onClick={(e) => p.painter?.onButton(e.detail)}
            data-tb="painter"
          >
            <Paintbrush size={15} />
          </TbButton>
        )}
      </Group>
    ),

    style: (
      <Group id="style" label="Style">
        <MenuButton label="Style de paragraphe" tb="style" text={STYLE_LABEL[fmt.style]} disabled={!editable} className="ed-tb-style" menuClass="ed-style-menu" width={104}>
          {(close) => (
            <>
              {STYLE_ORDER.map((s) => (
                <MenuRow
                  key={s}
                  className={`ed-style-${s}`}
                  label={STYLE_LABEL[s]}
                  checked={fmt.style === s}
                  shortcut={s === 'h1' ? KEYS.h1 : s === 'h2' ? KEYS.h2 : s === 'h3' ? KEYS.h3 : s === 'body' ? KEYS.body : undefined}
                  onClick={() => {
                    close();
                    const e = p.engine();
                    if (e) void e.setParagraphStyle(s).then(p.refresh);
                  }}
                  data-style={s}
                />
              ))}
              <div className="divider" />
              <MenuRow
                label={`Modifier le style « ${STYLE_LABEL[curStyle]} »…`}
                onClick={() => {
                  close();
                  setStyleEdit(curStyle);
                  const b = document.querySelector<HTMLElement>('.ed-toolbar [data-tb="style"]');
                  if (b) styleEditPop.open(b);
                }}
                data-action="modify-style"
              />
            </>
          )}
        </MenuButton>
      </Group>
    ),

    font: (
      <Group id="font" label="Police">
        <FontPicker value={fmt.fontFamily} disabled={!editable} onPick={(f) => run((e) => e.setFontFamily(f))} />
        <SizeControl value={fmt.fontSize} disabled={!editable} onPick={(pt) => run((e) => e.setFontSize(pt))} />
      </Group>
    ),

    chars: (
      <Group id="chars" label="Caractères">
        <TbButton label="Gras" shortcut={KEYS.bold} active={fmt.bold} disabled={!editable} onClick={() => run((e) => e.toggleMark('bold'))} data-tb="bold">
          <Bold size={15} />
        </TbButton>
        <TbButton label="Italique" shortcut={KEYS.italic} active={fmt.italic} disabled={!editable} onClick={() => run((e) => e.toggleMark('italic'))} data-tb="italic">
          <Italic size={15} />
        </TbButton>
        <TbButton label="Souligné" shortcut={KEYS.underline} active={fmt.underline} disabled={!editable} onClick={() => run((e) => e.toggleMark('underline'))} data-tb="underline">
          <Underline size={15} />
        </TbButton>
        <MenuButton label="Autres effets de caractère" tb="chars" icon={<ALargeSmall size={16} />} active={fmt.strike || fmt.superscript || fmt.subscript || fmt.smallCaps} disabled={!editable} menuClass="ed-chars-menu">
          {(close) => (
            <>
              <MenuRow icon={<Strikethrough size={14} />} label="Barré" shortcut={KEYS.strike} checked={fmt.strike} onClick={() => (close(), run((e) => e.toggleMark('strike')))} data-mark="strike" />
              <MenuRow icon={<Superscript size={14} />} label="Exposant" shortcut={KEYS.superscript} checked={fmt.superscript} disabled={fmt.empty} onClick={() => (close(), run((e) => e.toggleMark('superscript')))} data-mark="superscript" />
              <MenuRow icon={<Subscript size={14} />} label="Indice" shortcut={KEYS.subscript} checked={fmt.subscript} disabled={fmt.empty} onClick={() => (close(), run((e) => e.toggleMark('subscript')))} data-mark="subscript" />
              <MenuRow icon={<span className="ed-sc-icon">Pc</span>} label="Petites capitales" checked={fmt.smallCaps} disabled={fmt.empty} onClick={() => (close(), run((e) => e.toggleMark('smallCaps')))} data-mark="smallCaps" />
              <div className="divider" />
              <MenuRow icon={<RemoveFormatting size={14} />} label="Effacer la mise en forme" shortcut={KEYS.clear} onClick={() => (close(), run((e) => e.clearInlineFormatting()))} data-action="clear" />
              {fmt.empty && <p className="ed-pop-note">Sélectionnez du texte pour l’exposant, l’indice et les petites capitales.</p>}
            </>
          )}
        </MenuButton>
        <ColorButton kind="text" value={fmt.color} disabled={!editable} icon={<Baseline size={15} />} onPick={(hex) => run((e) => e.setColor(hex))} />
        <ColorButton kind="highlight" value={fmt.highlight} disabled={!editable} icon={<Highlighter size={15} />} onPick={(hex) => run((e) => e.setHighlight(hex))} />
      </Group>
    ),

    paragraph: (
      <Group id="paragraph" label="Paragraphe">
        <MenuButton label="Alignement" tb="align" icon={<AlignIcon size={15} />} disabled={!editable} menuClass="ed-align-menu">
          {(close) =>
            (['left', 'center', 'right', 'justify'] as Align[]).map((a) => {
              const I = ALIGN_ICON[a];
              return <MenuRow key={a} icon={<I size={14} />} label={ALIGN_LABEL[a]} shortcut={ALIGN_KEY[a]} checked={fmt.align === a} onClick={() => (close(), run((e) => e.setAlign(a)))} data-align={a} />;
            })
          }
        </MenuButton>
        <MenuButton label="Interligne et espacement" tb="spacing" icon={<AlignVerticalSpaceAround size={15} />} disabled={!editable} menuClass="ed-spacing-menu">
          {(close) => (
            <>
              <div className="ed-pop-title">Interligne</div>
              {LINES.map((l) => (
                <MenuRow key={l} label={fr(l)} checked={fmt.lineHeight !== null && Math.abs(fmt.lineHeight - l) < 0.01} onClick={() => (close(), run((e) => e.setLineHeight(l)))} data-line={String(l)} />
              ))}
              <div className="ed-menu-fields">
                <NumField label="Personnalisé" unit="×" value={fmt.lineHeight ?? 1} min={0.5} max={5} step={0.05} onCommit={(n) => run((e) => e.setLineHeight(n))} name="line-custom" />
              </div>
              <div className="divider" />
              <div className="ed-pop-title">Espacement</div>
              <div className="ed-menu-fields two">
                <NumField label="Avant" unit="pt" value={fmt.spaceBefore / 20} min={0} max={200} step={1} onCommit={(n) => run((e) => e.setParagraphSpacing({ before: Math.round(n * 20) }))} name="space-before" />
                <NumField label="Après" unit="pt" value={fmt.spaceAfter / 20} min={0} max={200} step={1} onCommit={(n) => run((e) => e.setParagraphSpacing({ after: Math.round(n * 20) }))} name="space-after" />
              </div>
              <div className="divider" />
              <div className="ed-pop-title">Retraits</div>
              <div className="ed-menu-fields two">
                <NumField label="Gauche" unit="cm" value={fmt.indentLeft / CM} min={0} max={15} step={0.25} onCommit={(n) => run((e) => e.setIndent({ left: Math.round(n * CM) }))} name="indent-left" />
                <NumField label="Alinéa" unit="cm" value={fmt.firstLine / CM} min={-5} max={5} step={0.25} onCommit={(n) => run((e) => e.setIndent({ firstLine: Math.round(n * CM) }))} name="indent-first" />
              </div>
              <MenuRow label="Alinéa de 1,25 cm" checked={Math.abs(fmt.firstLine - 709) < 5} onClick={() => (close(), run((e) => e.setIndent({ firstLine: Math.abs(fmt.firstLine - 709) < 5 ? 0 : 709 })))} data-action="alinea" />
              <MenuRow icon={<IndentIncrease size={14} />} label="Augmenter le retrait" onClick={() => run((e) => e.changeIndent(1))} data-action="indent+" />
              <MenuRow icon={<IndentDecrease size={14} />} label="Diminuer le retrait" onClick={() => run((e) => e.changeIndent(-1))} data-action="indent-" />
            </>
          )}
        </MenuButton>
        <MenuButton
          label="Listes"
          tb="lists"
          icon={fmt.list === 'ordered' ? <ListOrdered size={15} /> : <List size={15} />}
          active={!!fmt.list}
          disabled={!editable}
          menuClass="ed-lists-menu"
        >
          {(close) => (
            <>
              <MenuRow icon={<List size={14} />} label="Liste à puces" shortcut={KEYS.bullet} checked={fmt.list === 'bullet'} onClick={() => (close(), run((e) => e.toggleList('bullet')))} data-list="bullet" />
              <MenuRow icon={<ListOrdered size={14} />} label="Liste numérotée" shortcut={KEYS.ordered} checked={fmt.list === 'ordered'} onClick={() => (close(), run((e) => e.toggleList('ordered')))} data-list="ordered" />
              <MenuRow icon={<ListTree size={14} />} label="Numérotation 1. / 1.1. / 1.1.1." onClick={() => (close(), run((e) => e.outlineList()))} data-list="outline" />
              <div className="divider" />
              <MenuRow icon={<IndentIncrease size={14} />} label="Descendre d’un niveau" shortcut="⇥" disabled={!fmt.list} onClick={() => run((e) => e.listLevel(1))} data-list="level+" />
              <MenuRow icon={<IndentDecrease size={14} />} label="Remonter d’un niveau" shortcut="⇧⇥" disabled={!fmt.list || fmt.listLevel === 0} onClick={() => run((e) => e.listLevel(-1))} data-list="level-" />
            </>
          )}
        </MenuButton>
        {p.toggleMarks && (
          <TbButton
            label={p.marks ? 'Masquer les marques de mise en forme' : 'Afficher les marques de mise en forme (¶, espaces, police et style des paragraphes)'}
            shortcut={KEYS.marks}
            active={!!p.marks}
            onClick={p.toggleMarks}
            data-tb="marks"
          >
            <Pilcrow size={15} />
          </TbButton>
        )}
      </Group>
    ),

    insert: (
      <Group id="insert" label="Insertion">
        <button className="ed-tb-text" disabled={!editable} onMouseDown={keepFocus} onClick={p.insertFootnote} title={tip('Note de bas de page', KEYS.footnote)} aria-label="Note de bas de page" data-tb="footnote">
          <span className="ed-note-glyph" aria-hidden>
            1
          </span>
          Note
        </button>
        <PrivateNoteTools engine={p.engine} fmt={fmt} editable={editable} refresh={p.refresh} notify={p.notify} />
        <TypoToggle />
        <MenuButton label="Insérer" tb="insert" icon={<Plus size={15} />} disabled={!editable} menuClass="ed-insert-menu">
          {(close) => (
            <>
              <MenuRow
                icon={<Link2 size={14} />}
                label={fmt.link ? 'Modifier le lien…' : 'Lien…'}
                shortcut={KEYS.link}
                onClick={() => {
                  close();
                  const b = document.querySelector<HTMLElement>('[data-tb="insert"]');
                  if (b) p.openLink(b);
                }}
                data-insert="link"
              />
              <MenuRow icon={<ImagePlus size={14} />} label="Image…" onClick={() => (close(), fileRef.current?.click())} data-insert="image" />
              <MenuRow icon={<SeparatorHorizontal size={14} />} label="Saut de page" shortcut={KEYS.pageBreak} onClick={() => (close(), run((e) => e.insertPageBreak()))} data-insert="pagebreak" />
              <MenuRow
                icon={<TableOfContents size={14} />}
                label={tocN ? 'Mettre à jour la table des matières' : 'Table des matières'}
                onClick={() => {
                  close();
                  const e = p.engine();
                  if (!e) return;
                  void (tocN ? e.updateToc() : e.insertToc()).then((r) => {
                    p.refresh();
                    if (!r) p.notify('Ajoutez d’abord des titres (Titre 1 à 3) pour construire la table des matières.', 'info');
                    else p.notify(tocN ? 'Table des matières mise à jour' : 'Table des matières insérée', 'success');
                  });
                }}
                data-insert="toc"
              />
              <div className="divider" />
              <div className="ed-pop-title">
                <Table size={12} /> Tableau {grid[0] ? `${grid[1]} × ${grid[0]}` : ''}
              </div>
              <div className="ed-grid-pick" role="grid" aria-label="Taille du tableau (colonnes × lignes)" onMouseLeave={() => setGrid([0, 0])}>
                {Array.from({ length: 8 * 8 }, (_, i) => {
                  const r = Math.floor(i / 8) + 1;
                  const c = (i % 8) + 1;
                  return (
                    <button
                      key={i}
                      className={`ed-grid-cell ${r <= grid[0] && c <= grid[1] ? 'on' : ''}`}
                      aria-label={`${c} colonnes, ${r} lignes`}
                      onMouseDown={keepFocus}
                      onMouseEnter={() => setGrid([r, c])}
                      onFocus={() => setGrid([r, c])}
                      onClick={() => (close(), run((e) => e.insertTable(r, c)))}
                      data-grid={`${r}x${c}`}
                    />
                  );
                })}
              </div>
              <div className="divider" />
              <div className="ed-pop-title">
                <Omega size={12} /> Caractères spéciaux
              </div>
              <div className="ed-chars-grid">
                {SPECIAL_CHARS.map((c) => (
                  <button key={c.label} className="ed-char" title={c.label} aria-label={c.label} onMouseDown={keepFocus} onClick={() => run((e) => e.insertText(c.ch))} data-char={c.label}>
                    {c.show ?? c.ch}
                  </button>
                ))}
              </div>
            </>
          )}
        </MenuButton>
        {/* Le tableau s'insère depuis « + » ; ses commandes n'apparaissent que le curseur dans un tableau. */}
        {fmt.inTable && (
          <MenuButton label="Tableau" tb="table" icon={<Table size={15} />} active disabled={!editable} menuClass="ed-table-menu">
            {(close) => (
              <>
                <MenuRow label="Insérer une ligne au-dessus" onClick={() => (close(), tableOp('rowBefore', 'Ligne'))} data-table="rowBefore" />
                <MenuRow label="Insérer une ligne en dessous" onClick={() => (close(), tableOp('rowAfter', 'Ligne'))} data-table="rowAfter" />
                <MenuRow label="Insérer une colonne à gauche" onClick={() => (close(), tableOp('colBefore', 'Colonne'))} data-table="colBefore" />
                <MenuRow label="Insérer une colonne à droite" onClick={() => (close(), tableOp('colAfter', 'Colonne'))} data-table="colAfter" />
                <div className="divider" />
                <MenuRow label="Fusionner les cellules" onClick={() => (close(), tableOp('merge', 'Fusion'))} data-table="merge" />
                <MenuRow label="Scinder la cellule" onClick={() => (close(), tableOp('split', 'Scission'))} data-table="split" />
                <MenuRow label="Ligne d’en-tête" onClick={() => (close(), tableOp('headerRow', 'En-tête'))} data-table="headerRow" />
                <div className="divider" />
                <MenuRow label="Supprimer la ligne" onClick={() => (close(), tableOp('deleteRow', 'Suppression'))} data-table="deleteRow" />
                <MenuRow label="Supprimer la colonne" onClick={() => (close(), tableOp('deleteCol', 'Suppression'))} data-table="deleteCol" />
                <MenuRow icon={<Trash2 size={14} />} className="ed-danger" label="Supprimer le tableau" onClick={() => (close(), tableOp('deleteTable', 'Suppression'))} data-table="deleteTable" />
              </>
            )}
          </MenuButton>
        )}
      </Group>
    ),
  };

  const shown = GROUP_IDS.filter((id) => !collapsed.includes(id));
  const hidden = GROUP_IDS.filter((id) => collapsed.includes(id));

  return (
    <div ref={barRef} className="ed-toolbar" role="toolbar" aria-label="Mise en forme" data-editable={editable ? '1' : '0'} data-collapsed={hidden.join(' ') || undefined}>
      {shown.map((id) => (
        <Fragment key={id}>{groups[id]}</Fragment>
      ))}
      {hidden.length > 0 && (
        <div className="ed-tb-group" role="group" aria-label="Autres outils" data-group="more">
          <button
            className={`icon-btn sm ed-tb-btn ${morePop.isOpen ? 'active' : ''}`}
            onMouseDown={keepFocus}
            onClick={(e) => morePop.toggle(e.currentTarget)}
            title={`Autres outils : ${hidden.map((id) => GROUP_LABEL[id].toLowerCase()).join(', ')}`}
            aria-label="Autres outils"
            aria-haspopup="dialog"
            aria-expanded={morePop.isOpen}
            data-tb="more"
          >
            <MoreHorizontal size={16} />
          </button>
        </div>
      )}
      <Popover pop={morePop} label="Autres outils" className="ed-menu ed-tb-overflow-pop">
        <div className="ed-tb-overflow" role="toolbar" aria-label="Autres outils de mise en forme">
          {hidden.map((id) => (
            <Fragment key={id}>{groups[id]}</Fragment>
          ))}
        </div>
      </Popover>
      <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/gif,image/webp"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (f) void pickImage(f);
          }}
          data-input="image"
        />
      <Popover pop={styleEditPop} label="Modifier un style" className="ed-menu ed-style-dialog">
        {p.engine() && styleEdit && (
          <StyleEditor
            engine={p.engine()!}
            initial={styleEdit}
            onCancel={styleEditPop.close}
            onApply={(s: ParaStyle, patch: StylePatch) => {
              styleEditPop.close();
              const e = p.engine();
              if (e) void p.structural(`Style « ${STYLE_LABEL[s]} » modifié dans tout le document`, () => e.modifyStyle(s, patch));
            }}
          />
        )}
      </Popover>
    </div>
  );
}

/** Interrupteur « Typographie française » (espaces insécables, guillemets, apostrophe…). */
function TypoToggle() {
  const [on, setOn] = useTypography();
  return (
    <button
      className={`ed-tb-text ${on ? 'ed-typo-on' : ''}`}
      onMouseDown={keepFocus}
      onClick={() => setOn(!on)}
      title={`Typographie française : ${on ? 'activée' : 'désactivée'} (espaces insécables, « », ’, …, –)`}
      aria-label="Typographie française"
      aria-pressed={on}
      data-tb="typo"
    >
      FR
    </button>
  );
}
