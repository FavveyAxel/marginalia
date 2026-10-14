// Panneau « Mise en page » : format, orientation, marges, numéros de page, page de garde,
// présentation universitaire. Ces réglages ne passent pas par l'historique de SuperDoc :
// chaque action renvoie un instantané (⌘Z le rouvre, voir EditorScreen).
import { useEffect, useState } from 'react';
import { GraduationCap } from 'lucide-react';
import type { DocEngine, PageNumbers, PageSetup as Setup } from './engine';
import { NumField, keepFocus } from './controls';
import { fmtKeys } from '../../lib/keys';

type Op = (label: string, run: () => Promise<ArrayBuffer>) => Promise<void>;

const SIZES = [
  { id: 'a4', label: 'A4', w: 21, h: 29.7 },
  { id: 'letter', label: 'Lettre US', w: 21.59, h: 27.94 },
];
const MARGINS: { id: string; label: string; detail: string; m: Setup['margins'] }[] = [
  { id: 'normal', label: 'Normales', detail: '2,5 cm', m: { top: 2.5, right: 2.5, bottom: 2.5, left: 2.5 } },
  { id: 'narrow', label: 'Étroites', detail: '1,27 cm', m: { top: 1.27, right: 1.27, bottom: 1.27, left: 1.27 } },
  { id: 'wide', label: 'Larges', detail: '3 cm', m: { top: 3, right: 3, bottom: 3, left: 3 } },
  { id: 'univ', label: 'Consigne type', detail: 'haut 1,5 · bas 2 · côtés 2,5 cm', m: { top: 1.5, right: 2.5, bottom: 2, left: 2.5 } },
];
const NUMBERS: { v: PageNumbers; label: string }[] = [
  { v: 'none', label: 'Aucun' },
  { v: 'n', label: '3' },
  { v: 'n-of-total', label: 'Page 3 / 12' },
];
const near = (a: number, b: number) => Math.abs(a - b) < 0.06;

export function PageSetupPanel({ engine, op, onAcademic }: { engine: DocEngine; op: Op; onAcademic: () => void }) {
  const [s, setS] = useState<Setup>(() => engine.pageSetup());
  const [busy, setBusy] = useState(false);
  const refresh = () => setS(engine.pageSetup());
  useEffect(refresh, [engine]);
  const run = async (label: string, fn: () => Promise<ArrayBuffer>) => {
    setBusy(true);
    try {
      await op(label, fn);
    } finally {
      setBusy(false);
      refresh();
    }
  };
  const pw = Math.min(s.width, s.height);
  const ph = Math.max(s.width, s.height);
  const size = SIZES.find((x) => near(x.w, pw) && near(x.h, ph))?.id ?? 'other';
  const margin = MARGINS.find((x) => (['top', 'right', 'bottom', 'left'] as const).every((k) => near(x.m[k], s.margins[k])))?.id ?? 'custom';

  return (
    <div className={`ed-page-setup ${busy ? 'busy' : ''}`} aria-busy={busy} data-dialog="page">
      <div className="ed-pop-title">Mise en page</div>
      <div className="ed-field">
        <span>Format</span>
        <div className="segmented" role="radiogroup" aria-label="Format de page">
          {SIZES.map((x) => (
            <button key={x.id} role="radio" aria-checked={size === x.id} className={size === x.id ? 'active' : ''} onMouseDown={keepFocus} onClick={() => size !== x.id && run(`Format ${x.label}`, () => engine.setPageSize({ width: x.w, height: x.h }))} data-size={x.id}>
              {x.label}
            </button>
          ))}
        </div>
      </div>
      <div className="ed-field">
        <span>Orientation</span>
        <div className="segmented" role="radiogroup" aria-label="Orientation">
          {(['portrait', 'landscape'] as const).map((o) => (
            <button key={o} role="radio" aria-checked={s.orientation === o} className={s.orientation === o ? 'active' : ''} onMouseDown={keepFocus} onClick={() => s.orientation !== o && run(o === 'portrait' ? 'Orientation portrait' : 'Orientation paysage', () => engine.setOrientation(o))} data-orientation={o}>
              {o === 'portrait' ? 'Portrait' : 'Paysage'}
            </button>
          ))}
        </div>
      </div>
      <div className="ed-field">
        <span>Marges</span>
        <div className="ed-margin-presets" role="radiogroup" aria-label="Marges">
          {MARGINS.map((x) => (
            <button key={x.id} role="radio" aria-checked={margin === x.id} className={`ed-preset ${margin === x.id ? 'active' : ''}`} onMouseDown={keepFocus} onClick={() => margin !== x.id && run(`Marges ${x.label.toLowerCase()}`, () => engine.setMargins(x.m))} data-margins={x.id}>
              <strong>{x.label}</strong>
              <span>{x.detail}</span>
            </button>
          ))}
        </div>
        <div className="ed-margin-grid">
          {(
            [
              ['top', 'Haut'],
              ['bottom', 'Bas'],
              ['left', 'Gauche'],
              ['right', 'Droite'],
            ] as const
          ).map(([k, label]) => (
            <NumField key={k} label={label} unit="cm" value={s.margins[k]} min={0} max={10} step={0.1} onCommit={(n) => run('Marges modifiées', () => engine.setMargins({ ...s.margins, [k]: n }))} name={`margin-${k}`} />
          ))}
        </div>
      </div>
      <div className="ed-field">
        <span>Numéros de page</span>
        <div className="segmented" role="radiogroup" aria-label="Numéros de page">
          {NUMBERS.map((x) => (
            <button key={x.v} role="radio" aria-checked={s.pageNumbers === x.v} className={s.pageNumbers === x.v ? 'active' : ''} onMouseDown={keepFocus} onClick={() => s.pageNumbers !== x.v && run(x.v === 'none' ? 'Numéros de page retirés' : 'Numéros de page ajoutés', () => engine.setPageNumbers(x.v))} data-numbers={x.v}>
              {x.label}
            </button>
          ))}
        </div>
      </div>
      <label className="ed-check">
        <input type="checkbox" checked={s.titlePage} onChange={(e) => {
            const on = e.target.checked;
            setS((x) => ({ ...x, titlePage: on })); // reflet immédiat, confirmé après l'opération
            void run(on ? 'Page de garde sans numéro' : 'Page de garde numérotée', () => engine.setTitlePage(on));
          }} data-field="title-page" />
        <span>
          Page de garde sans numéro
          <small>La première page compte, mais son numéro n’est pas imprimé.</small>
        </span>
      </label>
      <div className="divider" />
      <button className="menu-item ed-academic" onMouseDown={keepFocus} onClick={onAcademic} data-action="academic">
        <GraduationCap size={15} />
        <span>
          Appliquer la présentation universitaire
          <small>Times 12, interligne 1,5, justifié, alinéa, notes en 10, marges 2,5 cm, pages numérotées</small>
        </span>
      </button>
      <p className="ed-pop-note">{fmtKeys('⌘Z')} annule le dernier réglage.</p>
    </div>
  );
}
