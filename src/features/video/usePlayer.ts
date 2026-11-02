// Commande du lecteur intégré, par messages (postMessage) avec son cadre : minute en cours, durée,
// lecture, saut à un moment. Aucun script de la plateforme n'est chargé dans l'app : on parle au
// lecteur avec le protocole qu'il expose lui-même (YouTube : « widget » ; Vimeo : player.js).
// Seuls les messages qui viennent du cadre du lecteur sont lus.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { VideoProvider } from '../../lib/types';

export interface PlayerState {
  /** Le lecteur répond (on connaît la minute en cours). */
  ready: boolean;
  time: number;
  duration: number;
  playing: boolean;
}

export interface Player extends PlayerState {
  frameRef: React.RefObject<HTMLIFrameElement>;
  /** À appeler au chargement du cadre. */
  onLoad(): void;
  seek(sec: number, play?: boolean): void;
  play(): void;
  pause(): void;
  /** Vitesse de lecture (0,5 à 2). */
  setRate(rate: number): void;
}

const INIT: PlayerState = { ready: false, time: 0, duration: 0, playing: false };

export function usePlayer(provider: VideoProvider): Player {
  const frameRef = useRef<HTMLIFrameElement>(null) as React.RefObject<HTMLIFrameElement>;
  const [st, setSt] = useState<PlayerState>(INIT);
  const hello = useRef<number | null>(null);
  const live = useRef(INIT);

  const post = useCallback(
    (msg: unknown) => {
      const w = frameRef.current?.contentWindow;
      if (!w) return;
      // Cible « * » : le cadre est celui de la plateforme (adresse fixée par l'app) ; aucune donnée n'y part.
      w.postMessage(typeof msg === 'string' ? msg : JSON.stringify(msg), '*');
    },
    [],
  );

  const update = useCallback((p: Partial<PlayerState>) => {
    const next = { ...live.current, ...p };
    if (next.time === live.current.time && next.duration === live.current.duration && next.playing === live.current.playing && next.ready === live.current.ready) return;
    live.current = next;
    setSt(next);
  }, []);

  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      if (!frameRef.current || e.source !== frameRef.current.contentWindow) return;
      let d: unknown = e.data;
      if (typeof d === 'string') {
        try {
          d = JSON.parse(d);
        } catch {
          return;
        }
      }
      if (!d || typeof d !== 'object') return;
      const m = d as Record<string, unknown>;
      if (provider === 'youtube') {
        if (m.event === 'onReady') update({ ready: true });
        if (m.event === 'infoDelivery' && m.info && typeof m.info === 'object') {
          const info = m.info as Record<string, unknown>;
          const p: Partial<PlayerState> = { ready: true };
          if (typeof info.currentTime === 'number') p.time = info.currentTime;
          if (typeof info.duration === 'number' && info.duration > 0) p.duration = info.duration;
          if (typeof info.playerState === 'number') p.playing = info.playerState === 1;
          update(p);
        }
        if (m.event === 'onStateChange' && typeof m.info === 'number') update({ playing: m.info === 1 });
      } else if (provider === 'vimeo') {
        if (m.event === 'ready') {
          for (const ev of ['timeupdate', 'play', 'pause', 'ended']) post({ method: 'addEventListener', value: ev });
          post({ method: 'getDuration' });
          update({ ready: true });
        }
        const data = (m.data && typeof m.data === 'object' ? m.data : {}) as Record<string, unknown>;
        if (m.event === 'timeupdate') update({ ready: true, time: Number(data.seconds) || 0, ...(Number(data.duration) > 0 ? { duration: Number(data.duration) } : {}) });
        if (m.event === 'play') update({ playing: true });
        if (m.event === 'pause' || m.event === 'ended') update({ playing: false });
        if (m.method === 'getDuration' && Number(m.value) > 0) update({ duration: Number(m.value) });
      }
    };
    window.addEventListener('message', onMsg);
    return () => {
      window.removeEventListener('message', onMsg);
      if (hello.current) window.clearInterval(hello.current);
    };
  }, [provider, post, update]);

  const onLoad = useCallback(() => {
    live.current = INIT;
    setSt(INIT);
    if (hello.current) window.clearInterval(hello.current);
    if (provider === 'youtube') {
      // Le lecteur YouTube n'envoie ses nouvelles qu'après « listening » ; on le redit tant qu'il ne répond pas.
      let n = 0;
      const say = () => {
        post({ event: 'listening', id: 1, channel: 'widget' });
        if (live.current.ready || ++n > 40) {
          if (hello.current) window.clearInterval(hello.current);
          hello.current = null;
        }
      };
      say();
      hello.current = window.setInterval(say, 400);
    } else if (provider === 'vimeo') {
      for (const ev of ['timeupdate', 'play', 'pause', 'ended']) post({ method: 'addEventListener', value: ev });
    }
  }, [provider, post]);

  const seek = useCallback(
    (sec: number, play = true) => {
      const t = Math.max(0, sec);
      if (provider === 'youtube') {
        post({ event: 'command', func: 'seekTo', args: [t, true], id: 1, channel: 'widget' });
        if (play) post({ event: 'command', func: 'playVideo', args: [], id: 1, channel: 'widget' });
      } else if (provider === 'vimeo') {
        post({ method: 'setCurrentTime', value: t });
        if (play) post({ method: 'play' });
      }
      update({ time: t });
    },
    [provider, post, update],
  );
  const play = useCallback(() => (provider === 'youtube' ? post({ event: 'command', func: 'playVideo', args: [], id: 1, channel: 'widget' }) : post({ method: 'play' })), [provider, post]);
  const pause = useCallback(() => (provider === 'youtube' ? post({ event: 'command', func: 'pauseVideo', args: [], id: 1, channel: 'widget' }) : post({ method: 'pause' })), [provider, post]);

  const setRate = useCallback(
    (rate: number) => {
      const r = Math.min(2, Math.max(0.25, rate));
      if (provider === 'youtube') post({ event: 'command', func: 'setPlaybackRate', args: [r], id: 1, channel: 'widget' });
      else if (provider === 'vimeo') post({ method: 'setPlaybackRate', value: r });
    },
    [provider, post],
  );

  return { ...st, frameRef, onLoad, seek, play, pause, setRate };
}
