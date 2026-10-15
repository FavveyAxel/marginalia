// Limite d'erreur par grande vue (lecteur, éditeur, carte, espaces…) : une erreur de rendu n'affiche
// plus un écran blanc mais un message, avec « Recharger la vue » et « Revenir à l'accueil ».
// L'erreur est consignée dans le journal de diagnostic local (host.diag). Les données ne sont pas
// touchées : elles sont dans le store et sur le disque.
import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle } from 'lucide-react';
import { host } from '../lib/platform';

interface Props {
  /** Nom de la vue, pour le journal (« lecteur », « éditeur »…). */
  view: string;
  children: ReactNode;
  /** Revenir à l'accueil (absent : bouton masqué). */
  onHome?: () => void;
}
interface State {
  error: Error | null;
  attempt: number;
}

const E2E = typeof location !== 'undefined' && new URLSearchParams(location.search).has('e2e');

/** Moyen de test (app lancée avec MARGINALIA_E2E=1) : window.__mgCrashView = 'lecteur' fait échouer cette vue. */
function CrashProbe({ view }: { view: string }) {
  if (E2E && (window as unknown as { __mgCrashView?: string }).__mgCrashView === view) throw new Error(`Erreur de test dans la vue « ${view} »`);
  return null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, attempt: 0 };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`Vue « ${this.props.view} » :`, error);
    void host.diag?.('erreur-vue', this.props.view, String(error?.stack || error), String(info.componentStack || '').slice(0, 4000));
  }

  private reload = () => this.setState((s) => ({ error: null, attempt: s.attempt + 1 }));

  private home = () => {
    this.setState((s) => ({ error: null, attempt: s.attempt + 1 }));
    this.props.onHome?.();
  };

  render() {
    if (this.state.error) {
      return (
        <div className="empty view-error anim-in" role="alert" style={{ flex: 1, minHeight: '60vh' }}>
          <AlertTriangle size={28} aria-hidden />
          <h3>Cette vue a rencontré un problème</h3>
          <p>Vos données ne sont pas touchées. Rechargez la vue ou revenez à l’accueil ; l’incident est noté dans le journal de diagnostic.</p>
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <button className="btn btn-primary" onClick={this.reload}>
              Recharger la vue
            </button>
            {this.props.onHome && (
              <button className="btn" onClick={this.home}>
                Revenir à l’accueil
              </button>
            )}
          </div>
        </div>
      );
    }
    // `attempt` remonte entièrement la vue au rechargement (état interne neuf).
    return (
      <ViewFrame key={this.state.attempt} view={this.props.view}>
        {this.props.children}
      </ViewFrame>
    );
  }
}

function ViewFrame({ view, children }: { view: string; children: ReactNode }) {
  return (
    <>
      <CrashProbe view={view} />
      {children}
    </>
  );
}
