// ─────────────────────────────────────────────────────────────
// Yjs du moteur d'édition. SuperDoc 1.47.2 est chargé en build autonome (superdoc.min.js, voir
// engine.ts) qui EMBARQUE sa copie de yjs 13.6.30, de y-protocols et de y-websocket 3.0.0, sans les
// exposer. Une seconde copie de yjs ne doit pas coexister (vérifications d'instance cassées : « Yjs was
// already imported »). On ne charge donc AUCUN yjs ici : on récupère les classes de la copie embarquée
// (Doc, Awareness, WebsocketProvider) sur une instance de sonde, créée avec un « fournisseur interne »
// dont la connexion est un faux WebSocket inerte (rien n'est ouvert), puis détruite aussitôt.
// Le fournisseur y-websocket sert ensuite tel quel, avec un WebSocket de remplacement qui passe par
// notre canal chiffré (rooms.ts) : tout le protocole Yjs (synchronisation, présence) reste celui d'origine.
// ─────────────────────────────────────────────────────────────
type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any

export interface YKit {
  Doc: new (opts?: { gc?: boolean }) => Any;
  Awareness: new (doc: Any) => Any;
  Provider: new (url: string, room: string, doc: Any, opts: Record<string, unknown>) => Any;
}

let kit: Promise<YKit> | null = null;

class InertSocket {
  readyState = 0;
  OPEN = 1;
  CONNECTING = 0;
  binaryType = 'arraybuffer';
  onopen: unknown = null;
  onmessage: unknown = null;
  onclose: unknown = null;
  onerror: unknown = null;
  send() {}
  close() {}
}

export function yjsKit(): Promise<YKit> {
  kit ??= (async () => {
    const { loadSuperDoc } = await import('../editor/engine');
    const SuperDoc = await loadSuperDoc();
    const host = document.createElement('div');
    host.style.cssText = 'position:fixed;left:-10000px;top:0;width:1px;height:1px;overflow:hidden';
    host.setAttribute('aria-hidden', 'true');
    document.body.appendChild(host);
    const w = window as Any;
    const realWS = w.WebSocket;
    const warn = console.warn;
    let sd: Any = null;
    try {
      w.WebSocket = InertSocket;
      console.warn = () => {};
      sd = new SuperDoc({
        selector: host,
        documents: [{ id: 'sonde', type: 'docx', name: 'sonde.docx' }],
        modules: { comments: false, collaboration: { providerType: 'superdoc', url: 'ws://sonde.invalid' } },
        telemetry: { enabled: false },
        proofing: { enabled: false },
      });
    } finally {
      w.WebSocket = realWS;
      console.warn = warn;
    }
    const provider = sd?.provider;
    const out: YKit = { Doc: sd?.ydoc?.constructor, Awareness: provider?.awareness?.constructor, Provider: provider?.constructor };
    try {
      provider?.destroy();
    } catch {
      /* sonde */
    }
    try {
      sd?.destroy();
    } catch {
      /* sonde */
    }
    host.remove();
    if (typeof out.Doc !== 'function' || typeof out.Awareness !== 'function' || typeof out.Provider !== 'function') throw new Error('Moteur de travail à plusieurs indisponible');
    return out;
  })();
  kit.catch(() => (kit = null));
  return kit;
}
