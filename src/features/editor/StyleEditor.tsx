// Dialogue « Modifier le style » : police, taille, interligne, alignement, alinéa et
// espacement d'un style, appliqués à tout le document (styles.xml réécrit, document rouvert).
import { useEffect, useState } from 'react';
import { AlignCenter, AlignJustify, AlignLeft, AlignRight } from 'lucide-react';
import type { DocEngine, ParaStyle } from './engine';
import type { StylePatch } from './ooxml';
import { FontPicker } from './FontPicker';
import { NumField, keepFocus } from './controls';
import { fmtKeys } from '../../lib/keys';

export const STYLE_LABEL: Record<ParaStyle | 'other', string> = {
  title: 'Titre',
  h1: 'Titre 1',
  h2: 'Titre 2',
  h3: 'Titre 3',
  body: 'Corps',
  quote: 'Citation',
  caption: 'Légende',
  other: 'Autre style',
};
export const STYLE_ORDER: ParaStyle[] = ['title', 'h1', 'h2', 'h3', 'body', 'quote', 'caption'];

const LINES = [1, 1.15, 1.5, 2];
const ALIGNS: { v: NonNullable<StylePatch['align']>; label: string; Icon: typeof AlignLeft }[] = [
  { v: 'left', label: 'À gauche', Icon: AlignLeft },
  { v: 'center', label: 'Centré', Icon: AlignCenter },
  { v: 'right', label: 'À droite', Icon: AlignRight },
  { v: 'both', label: 'Justifié', Icon: AlignJustify },
];
const CM = 567; // twips par cm

export function StyleEditor({
  engine,
  initial,
  onCancel,
  onApply,
}: {
  engine: DocEngine;
  initial: ParaStyle;
  onCancel: () => void;
  onApply: (style: ParaStyle, patch: StylePatch) => void;
}) {
  const [style, setStyle] = useState<ParaStyle>(initial);
  const [base, setBase] = useState<StylePatch>(() => engine.styleProps(initial));
  const [v, setV] = useState<StylePatch>(base);
  useEffect(() => {
    const b = engine.styleProps(style);
    setBase(b);
    setV(b);
  }, [engine, style]);

  const diff: StylePatch = {};
  if (v.fontFamily && v.fontFamily !== base.fontFamily) diff.fontFamily = v.fontFamily;
  if (v.fontSize && v.fontSize !== base.fontSize) diff.fontSize = v.fontSize;
  if (v.lineSpacing && v.lineSpacing !== (base.lineSpacing ?? 1)) diff.lineSpacing = v.lineSpacing;
  if (v.align && v.align !== (base.align ?? 'left')) diff.align = v.align;
  if (v.firstLine !== undefined && v.firstLine !== (base.firstLine ?? 0)) diff.firstLine = v.firstLine;
  if (v.after !== undefined && v.after !== (base.after ?? 0)) diff.after = v.after;
  const dirty = Object.keys(diff).length > 0;
  const align = v.align ?? 'left';

  return (
    <div className="ed-style-editor" data-dialog="style">
      <div className="ed-pop-title">Modifier un style</div>
      <label className="ed-field">
        <span>Style</span>
        <select className="input ed-select" value={style} onChange={(e) => setStyle(e.target.value as ParaStyle)} aria-label="Style à modifier">
          {STYLE_ORDER.map((s) => (
            <option key={s} value={s}>
              {STYLE_LABEL[s]}
            </option>
          ))}
        </select>
      </label>
      <div className="ed-field">
        <div className="ed-field-row">
          <div className="ed-num ed-font-field">
            <span className="ed-num-label">Police</span>
            <FontPicker value={v.fontFamily ?? null} onPick={(f) => setV((x) => ({ ...x, fontFamily: f }))} />
          </div>
          <NumField label="Taille" unit="pt" value={v.fontSize ?? 12} min={6} max={96} step={0.5} onCommit={(n) => setV((x) => ({ ...x, fontSize: n }))} name="style-size" />
        </div>
      </div>
      <div className="ed-field">
        <span>Interligne</span>
        <div className="segmented" role="radiogroup" aria-label="Interligne">
          {LINES.map((l) => (
            <button
              key={l}
              role="radio"
              aria-checked={Math.abs((v.lineSpacing ?? 1) - l) < 0.01}
              className={Math.abs((v.lineSpacing ?? 1) - l) < 0.01 ? 'active' : ''}
              onMouseDown={keepFocus}
              onClick={() => setV((x) => ({ ...x, lineSpacing: l }))}
              data-line={String(l)}
            >
              {String(l).replace('.', ',')}
            </button>
          ))}
        </div>
      </div>
      <div className="ed-field">
        <span>Alignement</span>
        <div className="segmented ed-seg-icons" role="radiogroup" aria-label="Alignement">
          {ALIGNS.map(({ v: a, label, Icon }) => (
            <button
              key={a}
              role="radio"
              aria-checked={align === a}
              aria-label={label}
              title={label}
              className={align === a ? 'active' : ''}
              onMouseDown={keepFocus}
              onClick={() => setV((x) => ({ ...x, align: a }))}
              data-align={a}
            >
              <Icon size={14} />
            </button>
          ))}
        </div>
      </div>
      <div className="ed-field-row ed-field-pair">
        <NumField label="Alinéa" unit="cm" value={(v.firstLine ?? 0) / CM} min={0} max={5} step={0.25} onCommit={(n) => setV((x) => ({ ...x, firstLine: Math.round(n * CM) }))} name="style-indent" />
        <NumField label="Espace après" unit="pt" value={(v.after ?? 0) / 20} min={0} max={72} step={1} onCommit={(n) => setV((x) => ({ ...x, after: Math.round(n * 20) }))} name="style-after" />
      </div>
      <p className="ed-pop-note">Tous les paragraphes « {STYLE_LABEL[style]} » du document changent. {fmtKeys('⌘Z')} annule.</p>
      <div className="ed-confirm-actions">
        <button className="btn btn-sm" onClick={onCancel}>
          Annuler
        </button>
        <button className="btn btn-sm btn-primary" disabled={!dirty} onClick={() => onApply(style, diff)} data-action="apply-style">
          Appliquer au document
        </button>
      </div>
    </div>
  );
}
