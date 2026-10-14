import React from 'react';
import ReactDOM from 'react-dom/client';
import './styles/tokens.css';
import './styles/app.css';
import { App } from './App';
import { applyPlatformClass } from './lib/keys';

// Classe platform-mac / platform-win sur <html> avant le premier rendu (barre de titre, raccourcis).
applyPlatformClass();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

// Accès de test (dev, ou app lancée par un test de bout en bout avec MARGINALIA_E2E=1)
if (import.meta.env.DEV || new URLSearchParams(location.search).has('e2e')) {
  import('./lib/store').then((m) => ((window as any).__store = m.useStore));
}
