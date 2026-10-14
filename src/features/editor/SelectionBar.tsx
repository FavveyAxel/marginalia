// Barre flottante au-dessus de la sélection : gras, italique, souligné, lien, couleur, surlignage.
import { useLayoutEffect, useRef, useState } from 'react';
import { Baseline, Bold, Highlighter, Italic, Link2, Underline } from 'lucide-react';
import type { DocEngine, EngineState } from './engine';
import { ColorButton, KEYS, TbButton } from './controls';

export function SelectionBar({
  engine,
  fmt,
  rect,
  refresh,
  openLink,
}: {
  engine: () => DocEngine | null;
  fmt: EngineState;
  rect: DOMRect;
  refresh: () => void;
  openLink: (anchor: HTMLElement) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    let left = rect.left + rect.width / 2 - w / 2;
    left = Math.max(8, Math.min(window.innerWidth - w - 8, left));
    let top = rect.top - h - 8;
    if (top < 60) top = rect.bottom + 8; // sous la sélection si elle touche le haut
    setPos({ left, top });
  }, [rect.left, rect.top, rect.width, rect.bottom]);
  const run = (fn: (e: DocEngine) => void) => {
    const e = engine();
    if (!e) return;
    fn(e);
    refresh();
  };
  return (
    <div
      ref={ref}
      className="floating ed-selbar anim-scale"
      role="toolbar"
      aria-label="Mise en forme de la sélection"
      style={pos ? { left: pos.left, top: pos.top } : { visibility: 'hidden', left: 0, top: 0 }}
      onMouseDown={(e) => e.preventDefault()}
    >
      <TbButton label="Gras" shortcut={KEYS.bold} active={fmt.bold} onClick={() => run((e) => e.toggleMark('bold'))} data-sb="bold">
        <Bold size={15} />
      </TbButton>
      <TbButton label="Italique" shortcut={KEYS.italic} active={fmt.italic} onClick={() => run((e) => e.toggleMark('italic'))} data-sb="italic">
        <Italic size={15} />
      </TbButton>
      <TbButton label="Souligné" shortcut={KEYS.underline} active={fmt.underline} onClick={() => run((e) => e.toggleMark('underline'))} data-sb="underline">
        <Underline size={15} />
      </TbButton>
      <span className="ed-sep" />
      <TbButton label={fmt.link ? 'Modifier le lien' : 'Lien'} shortcut={KEYS.link} active={!!fmt.link} onClick={(e) => openLink(e.currentTarget)} data-sb="link">
        <Link2 size={15} />
      </TbButton>
      <ColorButton kind="text" value={fmt.color} icon={<Baseline size={15} />} onPick={(hex) => run((e) => e.setColor(hex))} />
      <ColorButton kind="highlight" value={fmt.highlight} icon={<Highlighter size={15} />} onPick={(hex) => run((e) => e.setHighlight(hex))} />
    </div>
  );
}
