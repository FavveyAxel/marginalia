// Banc de test du panneau Fiche-texte hors lecteur (panneau 320 px).
import React from 'react';
import ReactDOM from 'react-dom/client';
import '../src/styles/tokens.css';
import '../src/styles/app.css';
import '../src/features/reader/reader.css';
import { useStore } from '../src/lib/store';
import { StudyPanel } from '../src/features/study/StudyPanel';

const w = window as any;
w.__store = useStore;
w.__goto = [] as unknown[];
const qs = new URLSearchParams(location.search);
document.documentElement.dataset.theme = qs.get('theme') ?? 'light';

function Root() {
  const bookId = useStore((s) => s.books[0]?.id ?? '');
  return (
    <div style={{ height: '100vh', background: 'var(--bg-app)', padding: 8, display: 'flex', justifyContent: 'center', gap: 8 }}>
      <aside className="panel" style={{ width: 320, height: '100%', display: 'flex', flexDirection: 'column' }}>
        <StudyPanel bookId={bookId} onGoTo={(a) => w.__goto.push(a)} />
      </aside>
    </div>
  );
}
ReactDOM.createRoot(document.getElementById('root')!).render(<Root />);
