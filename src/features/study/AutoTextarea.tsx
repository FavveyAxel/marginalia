import { useLayoutEffect, useRef, type TextareaHTMLAttributes } from 'react';

interface Props extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'onChange' | 'value'> {
  value: string;
  onChange(value: string): void;
}

/** Textarea qui s'adapte à son contenu (pas de barre de défilement interne). */
export function AutoTextarea({ value, onChange, className, rows = 1, ...rest }: Props) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const fit = () => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  };
  useLayoutEffect(fit, [value]);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    let w = el.clientWidth;
    const ro = new ResizeObserver(() => {
      if (el.clientWidth !== w) {
        w = el.clientWidth;
        fit();
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return (
    <textarea
      {...rest}
      ref={ref}
      rows={rows}
      className={className}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}
