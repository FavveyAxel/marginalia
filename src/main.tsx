import React from 'react';
import ReactDOM from 'react-dom/client';
import './styles/tokens.css';
import './styles/app.css';
import { App } from './App';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

// Accès de test (dev uniquement)
if (import.meta.env.DEV) {
  import('./lib/store').then((m) => ((window as any).__store = m.useStore));
}
