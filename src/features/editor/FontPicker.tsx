// Sélecteur de police : toutes les polices du Mac (queryLocalFonts), aperçu de chaque nom
// dans sa police, recherche, favoris (en tête et à leur place) et récentes ; repli sur une liste de base.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, Search, Star } from 'lucide-react';
import { Popover, usePop } from './Popover';
import {
  ACADEMIC_FONTS,
  APP_FONT,
  favoriteFonts,
  fontStack,
  isFavoriteFont,
  isInstalled,
  listSystemFonts,
  pushRecentFont,
  recentFonts,
  toggleFavoriteFont,
  type FontList,
} from './fonts';
import { OS_TEXT } from '../../lib/keys';

interface Row {
  family: string;
  group: string;
}

export function FontPicker({ value, disabled, onPick }: { value: string | null; disabled?: boolean; onPick: (family: string) => void }) {
  const pop = usePop();
  const [list, setList] = useState<FontList | null>(null);
  const [q, setQ] = useState('');
  const [favs, setFavs] = useState<string[]>(() => favoriteFonts());
  const [recent, setRecent] = useState<string[]>(() => recentFonts());
  const [cursor, setCursor] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  // liste chargée au premier survol / ouverture, puis gardée pour la session
  const load = () => {
    if (!list) void listSystemFonts().then(setList);
  };
  useEffect(() => {
    if (pop.isOpen) {
      load();
      setQ('');
      setCursor(0);
      setFavs(favoriteFonts());
      setRecent(recentFonts());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pop.isOpen]);

  const rows = useMemo<Row[]>(() => {
    const all = list?.families ?? [];
    const has = new Set(all);
    const needle = q.trim().toLocaleLowerCase('fr');
    if (needle) {
      const pool = [APP_FONT, ...all];
      return pool.filter((f) => f.toLocaleLowerCase('fr').includes(needle)).map((family) => ({ family, group: 'Résultats' }));
    }
    const out: Row[] = [];
    // Favoris : en tête, ET toujours à leur place habituelle (récentes, usuelles, toutes les polices) :
    // une police mise en favori ne disparaît jamais de la liste. Un favori absent de cet ordinateur
    // reste affiché (on peut le retirer des favoris).
    for (const f of favs) out.push({ family: f, group: 'Favoris' });
    const seen = new Set<string>();
    const add = (fs: string[], group: string) => {
      for (const f of fs) {
        if (seen.has(f)) continue;
        seen.add(f);
        out.push({ family: f, group });
      }
    };
    add(recent, 'Récentes');
    add([...ACADEMIC_FONTS.filter((f) => has.has(f) || list?.source !== 'system'), APP_FONT], 'Usuelles');
    out.push(...all.map((family) => ({ family, group: 'Toutes les polices' })));
    return out;
  }, [list, q, favs, recent]);

  const pick = (f: string) => {
    pop.close();
    setRecent(pushRecentFont(f));
    onPick(f);
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setCursor((c) => Math.min(rows.length - 1, c + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setCursor((c) => Math.max(0, c - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const r = rows[cursor];
      if (r) pick(r.family);
      else if (q.trim()) pick(q.trim());
    }
  };
  const anchor = useRef<{ key: string; top: number } | null>(null);
  useLayoutEffect(() => {
    const a = anchor.current;
    const box = listRef.current;
    anchor.current = null;
    if (!a || !box) return;
    const row = [...box.querySelectorAll<HTMLElement>('.ed-font-row')].find((x) => x.dataset.key === a.key);
    if (row) box.scrollTop += row.getBoundingClientRect().top - box.getBoundingClientRect().top - a.top;
  }, [favs]);
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-i="${cursor}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [cursor]);

  const missing = value && value !== APP_FONT && !isInstalled(value);
  const label = value ?? 'Police';
  return (
    <>
      <button
        className="ed-tb-select ed-font-btn"
        disabled={disabled}
        onMouseDown={(e) => e.preventDefault()}
        onMouseEnter={load}
        onClick={(e) => pop.toggle(e.currentTarget)}
        aria-haspopup="listbox"
        aria-expanded={pop.isOpen}
        aria-label={`Police : ${label}`}
        title={missing ? `${label} n’est pas installée sur ${OS_TEXT.thisComputer} : elle est remplacée à l’écran` : 'Police'}
        data-tb="font"
      >
        <span className={`ed-font-name ${missing ? 'missing' : ''}`} style={{ fontFamily: value ? fontStack(value) : undefined }}>
          {label}
        </span>
        <ChevronDown size={13} />
      </button>
      <Popover pop={pop} label="Police" className="ed-menu ed-font-menu">
        <div className="ed-font-search">
          <Search size={14} />
          <input
            autoFocus
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setCursor(0);
            }}
            onKeyDown={onKey}
            placeholder="Rechercher une police"
            aria-label="Rechercher une police"
            spellCheck={false}
          />
        </div>
        <div className="ed-font-list" role="listbox" aria-label="Polices" ref={listRef}>
          {!list && (
            <div className="ed-font-loading" aria-busy="true">
              {[70, 54, 82, 61, 75, 48].map((w, i) => (
                <div key={i} className="skeleton" style={{ width: `${w}%` }} />
              ))}
            </div>
          )}
          {list &&
            rows.map((r, i) => {
              const head = i === 0 || rows[i - 1].group !== r.group;
              const fav = isFavoriteFont(favs, r.family);
              return (
                <div key={`${r.group}-${r.family}`} className="ed-font-rowwrap">
                  {head && (
                    <div className="ed-font-group">
                      {r.group}
                      {r.group === 'Toutes les polices' ? ` (${list.families.length})` : ''}
                    </div>
                  )}
                  <div
                    role="option"
                    aria-selected={value === r.family}
                    data-i={i}
                    data-font={r.family}
                    data-key={`${r.group}-${r.family}`}
                    className={`ed-font-row ${i === cursor ? 'focused' : ''} ${value === r.family ? 'current' : ''}`}
                    onMouseDown={(e) => e.preventDefault()}
                    onMouseMove={() => setCursor(i)}
                    onClick={() => pick(r.family)}
                  >
                    <span className="ed-font-check">{value === r.family && <Check size={13} />}</span>
                    <span className="ed-font-preview" style={{ fontFamily: fontStack(r.family) }}>
                      {r.family}
                    </span>
                    {r.family === APP_FONT && <span className="ed-font-tag">Marginalia</span>}
                    <button
                      className={`ed-font-star ${fav ? 'on' : ''}`}
                      aria-label={fav ? `Retirer ${r.family} des favoris` : `Ajouter ${r.family} aux favoris`}
                      aria-pressed={fav}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={(e) => {
                        e.stopPropagation();
                        // la ligne cliquée reste sous la souris (le groupe « Favoris » s'agrandit au-dessus)
                        const row = e.currentTarget.closest<HTMLElement>('.ed-font-row');
                        const box = listRef.current;
                        if (row && box) anchor.current = { key: `${r.group}-${r.family}`, top: row.getBoundingClientRect().top - box.getBoundingClientRect().top };
                        setFavs(toggleFavoriteFont(r.family));
                      }}
                    >
                      <Star size={13} />
                    </button>
                  </div>
                </div>
              );
            })}
          {list && q.trim() && rows.length === 0 && (
            <div className="ed-font-empty">
              Aucune police « {q.trim()} » sur {OS_TEXT.thisComputer}.
              <button className="btn btn-sm" onMouseDown={(e) => e.preventDefault()} onClick={() => pick(q.trim())}>
                Utiliser ce nom quand même
              </button>
            </div>
          )}
        </div>
        <p className="ed-font-foot">
          {list?.source === 'base'
            ? `Liste de base : les polices de ${OS_TEXT.thisComputer} n’ont pas pu être lues.`
            : value === APP_FONT
              ? 'Literata est fournie avec Marginalia : Word la remplacera si elle n’est pas installée.'
              : 'Une police absente de l’ordinateur du lecteur y sera remplacée.'}
        </p>
      </Popover>
    </>
  );
}
