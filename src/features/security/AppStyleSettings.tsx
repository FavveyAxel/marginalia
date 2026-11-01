// Réglage « Style de l'app » : Normal (plat) ou Skeuomorphisme (matières suggérées, relief doux ;
// la Bibliothèque devient une étagère). Deux cartes avec un aperçu dessiné en CSS.
import { Layers } from 'lucide-react';
import { useStore } from '../../lib/store';
import './app-style.css';

type AppStyle = 'normal' | 'skeuo';

const STYLES: { id: AppStyle; title: string; text: string; done: string }[] = [
  {
    id: 'normal',
    title: 'Normal',
    text: 'Net, plat, efficace. Le bois, c’est pour les meubles.',
    done: 'Retour au plat. Vos livres respirent.',
  },
  {
    id: 'skeuo',
    title: 'Skeuomorphisme',
    text: 'Du verre, du papier, du relief, et vos livres rangés sur une étagère. Le bois est faux, les livres sont vrais.',
    done: 'Bienvenue dans la matière. Mettez des chaussons.',
  },
];

/** Aperçu miniature : une fenêtre avec sa barre, un panneau et quelques livres. */
function Preview({ id }: { id: AppStyle }) {
  return (
    <span className={`as-prev as-prev-${id}`} aria-hidden="true">
      <span className="as-prev-bar">
        <i />
        <i />
        <i />
      </span>
      <span className="as-prev-side" />
      <span className="as-prev-main">
        {id === 'normal' ? (
          <span className="as-prev-grid">
            {['#6f7d6a', '#8a5a4a', '#4f6377', '#7b6a4c', '#6b4f5f', '#3f5a54'].map((c) => (
              <i key={c} style={{ background: c }} />
            ))}
          </span>
        ) : (
          <span className="as-prev-shelf">
            {['#7a3a32', '#3f5a54', '#4f6377', '#efe8d8', '#2f2b28', '#6b4f5f', '#7b6a4c', '#5a5f78', '#8a5a4a'].map((c, i) => (
              <i key={i} style={{ background: c, height: `${[78, 66, 84, 70, 88, 62, 80, 72, 76][i]}%`, width: `${[9, 7, 11, 8, 12, 7, 10, 8, 9][i]}px` }} />
            ))}
          </span>
        )}
      </span>
    </span>
  );
}

export function AppStyleSettings() {
  const current = useStore((s) => s.settings.appStyle ?? 'normal');
  const choose = (st: (typeof STYLES)[number]) => {
    if (st.id === current) return;
    const s = useStore.getState();
    s.updateSettings({ appStyle: st.id });
    s.toast(st.done, 'success');
  };
  return (
    <section className="set-section" aria-labelledby="set-appstyle">
      <h2 className="set-section-title" id="set-appstyle">
        <Layers size={18} strokeWidth={1.8} /> Style de l’app
      </h2>
      <div className="as-cards" role="radiogroup" aria-label="Style de l’app">
        {STYLES.map((st) => (
          <button
            key={st.id}
            type="button"
            role="radio"
            aria-checked={current === st.id}
            className={`as-card ${current === st.id ? 'active' : ''}`}
            onClick={() => choose(st)}
            data-style-choice={st.id}
          >
            <Preview id={st.id} />
            <span className="as-card-head">
              <span className="as-radio" aria-hidden="true" />
              <span className="as-card-title">{st.title}</span>
            </span>
            <span className="as-card-text">{st.text}</span>
          </button>
        ))}
      </div>
    </section>
  );
}
