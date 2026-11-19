// Champ de saisie d'un secret (mot de passe, clé de secours) dont la valeur n'est JAMAIS dans le champ du
// DOM. Chromium recopie la valeur du champ actif dans le processus principal de l'app (gestion de la
// saisie et des méthodes d'entrée) ; une chaîne n'y s'efface pas, et ce processus vit aussi longtemps que
// l'app. Le champ ne contient donc que des puces, autant que de caractères saisis ; chaque frappe est
// interceptée (beforeinput) et appliquée au secret, tenu par React dans le rendu seulement (processus
// remplacé par un neuf au verrouillage). Méthode d'entrée (accents composés) : seul le caractère en
// cours de composition passe un instant dans le champ.
import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState, type CSSProperties, type InputHTMLAttributes } from 'react';

const MASK = '•';
const isHigh = (c: number) => c >= 0xd800 && c <= 0xdbff;
const isLow = (c: number) => c >= 0xdc00 && c <= 0xdfff;

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'defaultValue' | 'onChange' | 'type'> & {
  value: string;
  onValueChange: (v: string) => void;
  /** Affichage en clair (clé de secours) : le texte rendu remplace les puces ; saisie en fin de champ seulement. */
  reveal?: (v: string) => string;
};

export const SecretInput = forwardRef<HTMLInputElement, Props>(function SecretInput({ value, onValueChange, reveal, style, ...rest }, ref) {
  const el = useRef<HTMLInputElement>(null);
  useImperativeHandle(ref, () => el.current as HTMLInputElement, []);
  const valueRef = useRef(value);
  valueRef.current = value;
  const changeRef = useRef(onValueChange);
  changeRef.current = onValueChange;
  const revealMode = !!reveal;
  const caret = useRef<number | null>(null);
  const [overlay, setOverlay] = useState<CSSProperties | null>(null);
  const mask = MASK.repeat(value.length);

  // Le champ ne montre que des puces (même longueur que le secret).
  useLayoutEffect(() => {
    const e = el.current;
    if (!e) return;
    if (e.value !== mask) e.value = mask;
    if (document.activeElement === e) {
      const p = revealMode ? mask.length : Math.min(caret.current ?? mask.length, mask.length);
      try {
        e.setSelectionRange(p, p);
      } catch {
        /* champ non sélectionnable */
      }
    }
    caret.current = null;
  }, [mask, revealMode]);

  // Texte en clair superposé (clé de secours) : même police et mêmes marges que le champ.
  useLayoutEffect(() => {
    if (!revealMode || !el.current) return setOverlay(null);
    const cs = getComputedStyle(el.current);
    setOverlay({
      font: cs.font,
      letterSpacing: cs.letterSpacing,
      textAlign: cs.textAlign as CSSProperties['textAlign'],
      paddingLeft: `calc(${cs.paddingLeft} + ${cs.borderLeftWidth})`,
      paddingRight: `calc(${cs.paddingRight} + ${cs.borderRightWidth})`,
      color: cs.color,
    });
  }, [revealMode]);

  useEffect(() => {
    const e = el.current;
    if (!e) return;
    let compStart: [number, number] | null = null;
    const sel = (): [number, number] => {
      const v = valueRef.current;
      let s = e.selectionStart ?? v.length;
      let en = e.selectionEnd ?? v.length;
      // Clé de secours : on ne modifie qu'à la fin (ou tout, si tout est sélectionné).
      if (revealMode && !(s === 0 && en === v.length)) s = en = v.length;
      return [Math.min(s, v.length), Math.min(en, v.length)];
    };
    const commit = (next: string, pos: number) => {
      caret.current = pos;
      if (next !== valueRef.current) changeRef.current(next);
      else {
        e.value = MASK.repeat(next.length);
        try {
          e.setSelectionRange(pos, pos);
        } catch {
          /* rien */
        }
      }
    };
    const onBefore = (ev: InputEvent) => {
      if (ev.inputType === 'insertCompositionText') return; // repris à la fin de la composition
      ev.preventDefault();
      const v = valueRef.current;
      const [s, en] = sel();
      const t = ev.inputType;
      if (t.startsWith('insert')) {
        if (t === 'insertLineBreak' || t === 'insertParagraph') return;
        const data = (ev.data ?? ev.dataTransfer?.getData('text/plain') ?? '').replace(/[\r\n]+/g, '');
        return commit(v.slice(0, s) + data + v.slice(en), s + data.length);
      }
      if (!t.startsWith('delete')) return; // annuler, mise en forme… : sans effet
      if (s !== en) return commit(v.slice(0, s) + v.slice(en), s);
      if (t === 'deleteContentBackward') {
        if (!s) return;
        const k = s >= 2 && isLow(v.charCodeAt(s - 1)) && isHigh(v.charCodeAt(s - 2)) ? 2 : 1;
        return commit(v.slice(0, s - k) + v.slice(s), s - k);
      }
      if (t === 'deleteContentForward') {
        if (s >= v.length) return;
        const k = isHigh(v.charCodeAt(s)) && isLow(v.charCodeAt(s + 1)) ? 2 : 1;
        return commit(v.slice(0, s) + v.slice(s + k), s);
      }
      if (t.includes('Backward')) return commit(v.slice(s), 0); // mot, ligne : jusqu'au début
      if (t.includes('Forward')) return commit(v.slice(0, s), s);
    };
    const onCompStart = () => {
      compStart = sel();
    };
    const onCompEnd = (ev: CompositionEvent) => {
      const v = valueRef.current;
      const [s, en] = compStart ?? sel();
      compStart = null;
      const data = (ev.data ?? '').replace(/[\r\n]+/g, '');
      e.value = MASK.repeat(v.length); // le caractère composé quitte le champ aussitôt
      commit(v.slice(0, s) + data + v.slice(en), s + data.length);
    };
    e.addEventListener('beforeinput', onBefore);
    e.addEventListener('compositionstart', onCompStart);
    e.addEventListener('compositionend', onCompEnd);
    return () => {
      e.removeEventListener('beforeinput', onBefore);
      e.removeEventListener('compositionstart', onCompStart);
      e.removeEventListener('compositionend', onCompEnd);
    };
  }, [revealMode]);

  const input = (
    <input
      {...rest}
      ref={el}
      type={revealMode ? 'text' : 'password'}
      autoCorrect="off"
      autoCapitalize="off"
      spellCheck={false}
      style={revealMode ? { ...style, color: 'transparent', caretColor: 'transparent' } : style}
      data-secret-input=""
    />
  );
  if (!revealMode) return input;
  return (
    <span className="secret-input-wrap" style={{ position: 'relative', display: 'block' }}>
      {input}
      <span
        aria-hidden="true"
        style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: overlay?.textAlign === 'center' ? 'center' : 'flex-start',
          pointerEvents: 'none',
          whiteSpace: 'pre',
          overflow: 'hidden',
          ...overlay,
        }}
      >
        {reveal(value)}
      </span>
    </span>
  );
});
