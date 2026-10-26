// Présentation de Marginalia en 20 s : le petit cerveau (la mascotte de l'app, dessin réutilisé tel quel)
// fait visiter l'app. Captures : celles du site (faites sur des exemples, aucune donnée personnelle).
import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { AbsoluteFill, Easing, Img, continueRender, delayRender, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';
import '@fontsource/instrument-serif/400.css';
import '@fontsource-variable/literata/index.css';
import '@fontsource-variable/literata/wght-italic.css';
import { Sprite, VB_H, VB_W, type Pose } from '../../src/features/mascot/Sprite';
import { extraPose } from '../../src/features/mascot/activities';

export const FPS = 30;
export const DURATION = 600; // 20 s

const C = {
  bg: '#efebe3',
  panel: '#fbf9f4',
  page: '#fffdf8',
  ink: '#1d1a15',
  ink2: '#4a443a',
  muted: '#7a7266',
  shadow: '0 40px 90px -30px rgba(30, 24, 14, 0.42), 0 0 0 1px rgba(30, 24, 14, 0.10)',
};
const DISPLAY = "'Instrument Serif', Georgia, serif";
const READ = "'Literata Variable', Georgia, serif";

const CATS = [
  { label: 'Problème', c: '#c8693a' },
  { label: 'Thèse', c: '#d9a21b' },
  { label: 'Argument', c: '#3b9a5f' },
  { label: 'Objection', c: '#d4556b' },
  { label: 'Concept', c: '#3d7be0' },
  { label: 'Exemple', c: '#8c63d9' },
];

type Feature = { from: number; dur: number; title: string; line: string; shot: string; pose: Pose; portrait?: boolean };
const INTRO = { from: 0, dur: 84 };
const FEATURES: Feature[] = [
  { from: 84, dur: 84, title: 'Lire', line: 'Surlignez en six couleurs, du problème à l’exemple.', shot: 'lire', pose: 'read' },
  { from: 168, dur: 84, title: 'Comprendre', line: 'Vos surlignages dessinent le raisonnement.', shot: 'comprendre', pose: 'think' },
  { from: 252, dur: 84, title: 'Écrire', line: 'Citez vos livres : les notes se font seules.', shot: 'ecrire', pose: 'write' },
  { from: 336, dur: 78, title: 'Ranger', line: 'Un espace par dissertation ou mémoire.', shot: 'espaces', pose: 'classify' },
  { from: 414, dur: 84, title: 'À plusieurs', line: 'Un code, et vous travaillez ensemble.', shot: 'ensemble-code', pose: 'juggle', portrait: true },
];
const OUTRO = { from: 498, dur: 102 };

const POSE_FPS: Partial<Record<Pose, number>> = { walk: 8, jump: 8, wave: 8, read: 4, think: 3, write: 4, stand: 2 };
const poseFps = (p: Pose) => POSE_FPS[p] ?? extraPose(p)?.fps ?? 4;

const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const;
const ease = Easing.bezier(0.2, 0.8, 0.2, 1);

/** Les polices sont chargées avant la première image. */
function useFonts() {
  const [handle] = useState(() => delayRender('polices'));
  useEffect(() => {
    Promise.all([
      document.fonts.load(`400 120px ${DISPLAY}`),
      document.fonts.load(`400 40px ${READ}`),
      document.fonts.load(`italic 400 40px ${READ}`),
      document.fonts.load(`600 40px ${READ}`),
    ]).finally(() => continueRender(handle));
  }, [handle]);
}

// ── La mascotte ─────────────────────────────────────────────

const SCALE = 3; // 100 × 130 → 300 × 390
function Mascot({ x, ground, pose, t, facing = 1, view = 'front' }: { x: number; ground: number; pose: Pose; t: number; facing?: 1 | -1; view?: 'front' | 'side' }) {
  const w = VB_W * SCALE;
  const h = VB_H * SCALE;
  return (
    <div style={{ position: 'absolute', left: x - w / 2, top: ground - h, width: w, height: h, color: C.ink, ['--bg-panel' as string]: C.panel }}>
      <Sprite pose={pose} frame={Math.floor((t / FPS) * poseFps(pose))} level={2} facing={facing} view={view} blink={t % 95 > 91} />
    </div>
  );
}

/** Bulle : apparaît avec un léger rebond, le texte s'écrit lettre à lettre. */
function Bubble({ text, t, x, y, width = 520, align = 'left' }: { text: string; t: number; x: number; y: number; width?: number; align?: 'left' | 'center' }) {
  const { fps } = useVideoConfig();
  const pop = spring({ frame: t, fps, config: { damping: 14, stiffness: 160 } });
  const shown = Math.floor(interpolate(t, [3, 3 + text.length * 0.45], [0, text.length], clamp));
  return (
    <div
      style={{
        position: 'absolute',
        left: x,
        top: y,
        width,
        transform: `translateY(${(1 - pop) * 14}px) scale(${0.94 + pop * 0.06})`,
        transformOrigin: align === 'center' ? '50% 100%' : '18% 100%',
        opacity: pop,
        background: C.page,
        borderRadius: 28,
        padding: '26px 32px',
        boxShadow: '0 2px 4px rgba(30,24,14,0.08), 0 18px 40px -16px rgba(30,24,14,0.28)',
        fontFamily: READ,
        fontStyle: 'italic',
        fontSize: 38,
        lineHeight: 1.35,
        color: C.ink2,
        textAlign: align,
      }}
    >
      <span>{text.slice(0, shown)}</span>
      <span style={{ visibility: 'hidden' }}>{text.slice(shown)}</span>
      <span
        style={{
          position: 'absolute',
          left: align === 'center' ? '50%' : 92,
          bottom: -11,
          width: 24,
          height: 24,
          background: C.page,
          transform: 'translateX(-50%) rotate(45deg)',
          borderRadius: 4,
        }}
      />
    </div>
  );
}

// ── Captures ────────────────────────────────────────────────

function Shot({ f, t, dur }: { f: Feature; t: number; dur: number }) {
  const inP = interpolate(t, [0, 16], [0, 1], { ...clamp, easing: ease });
  const outP = interpolate(t, [dur - 10, dur], [0, 1], clamp);
  const zoom = interpolate(t, [0, dur], [1, 1.06]);
  const style: CSSProperties = f.portrait
    ? { left: 1010, top: 120, width: 640, height: 688 }
    : { left: 690, top: 168, width: 1120, height: 700 };
  return (
    <div
      style={{
        position: 'absolute',
        ...style,
        borderRadius: 22,
        overflow: 'hidden',
        boxShadow: C.shadow,
        background: C.page,
        opacity: inP * (1 - outP),
        transform: `translateY(${(1 - inP) * 60 - outP * 20}px) scale(${0.97 + inP * 0.03})`,
      }}
    >
      <Img src={staticFile(`${f.shot}.png`)} style={{ width: '100%', height: '100%', objectFit: 'cover', transform: `scale(${zoom})`, transformOrigin: '30% 30%' }} />
    </div>
  );
}

function Title({ children, t, size = 124, style }: { children: ReactNode; t: number; size?: number; style?: CSSProperties }) {
  const p = interpolate(t, [0, 14], [0, 1], { ...clamp, easing: ease });
  return (
    <div
      style={{
        position: 'absolute',
        fontFamily: DISPLAY,
        fontSize: size,
        lineHeight: 1,
        letterSpacing: '-0.01em',
        color: C.ink,
        opacity: p,
        transform: `translateY(${(1 - p) * 24}px)`,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

/** Les six couleurs de surlignage, en pastilles (scène « Lire »). */
function Chips({ t }: { t: number }) {
  return (
    <div style={{ position: 'absolute', left: 120, top: 300, width: 520, display: 'flex', flexWrap: 'wrap', gap: 12 }}>
      {CATS.map((c, i) => {
        const p = interpolate(t, [10 + i * 3, 20 + i * 3], [0, 1], { ...clamp, easing: ease });
        return (
          <span
            key={c.label}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 10,
              padding: '8px 16px 8px 12px',
              borderRadius: 999,
              background: C.page,
              boxShadow: '0 0 0 1px rgba(40,32,20,0.11)',
              fontFamily: READ,
              fontSize: 24,
              color: C.ink2,
              opacity: p,
              transform: `translateY(${(1 - p) * 10}px)`,
            }}
          >
            <span style={{ width: 14, height: 14, borderRadius: 999, background: c.c }} />
            {c.label}
          </span>
        );
      })}
    </div>
  );
}

// ── Scènes ──────────────────────────────────────────────────

const LEFT_X = 300; // centre de la mascotte dans les scènes de fonctionnalités
const GROUND = 1000;

function Intro({ t }: { t: number }) {
  // Il entre en marchant, s'arrête et salue ; le titre apparaît à côté de lui.
  const walkEnd = 30;
  const x = interpolate(t, [0, walkEnd], [-180, 660], { ...clamp, easing: Easing.out(Easing.quad) });
  const pose: Pose = t < walkEnd ? 'walk' : 'wave';
  return (
    <>
      <Mascot x={x} ground={GROUND - 120} pose={pose} t={t} view={t < walkEnd ? 'side' : 'front'} />
      <div style={{ position: 'absolute', inset: 0, opacity: interpolate(t, [INTRO.dur - 10, INTRO.dur], [1, 0], clamp) }}>
        {t >= walkEnd + 2 && <Bubble text="Bonjour ! Je vous fais visiter." t={t - walkEnd - 2} x={480} y={250} width={560} />}
        <Title t={t - 14} size={210} style={{ left: 900, top: 420 }}>
          Marginalia
        </Title>
        <Title t={t - 24} size={46} style={{ left: 906, top: 650, fontFamily: READ, color: C.ink2 }}>
          Lire, annoter et écrire la philosophie.
        </Title>
      </div>
    </>
  );
}

function FeatureScene({ f, t, i }: { f: Feature; t: number; i: number }) {
  // Première scène : il saute de sa place d'accueil jusqu'à la colonne de gauche.
  const hop = i === 0 && t < 14;
  const x = i === 0 ? interpolate(t, [0, 14], [660, LEFT_X], { ...clamp, easing: Easing.inOut(Easing.quad) }) : LEFT_X;
  const ground = i === 0 ? interpolate(t, [0, 14], [GROUND - 120, GROUND], clamp) - Math.sin(Math.min(1, t / 14) * Math.PI) * 90 : GROUND;
  return (
    <>
      <Shot f={f} t={t} dur={f.dur} />
      <Title t={t - 4} style={{ left: 120, top: 150 }}>
        {f.title}
      </Title>
      {i === 0 && <Chips t={t} />}
      <Mascot x={x} ground={ground} pose={hop ? 'jump' : f.pose} t={t} facing={hop ? -1 : 1} view={hop ? 'side' : 'front'} />
      {t >= 8 && <Bubble text={f.line} t={t - 8} x={110} y={i === 0 ? 452 : 360} width={520} />}
    </>
  );
}

function Outro({ t }: { t: number }) {
  const { fps } = useVideoConfig();
  const jump = t < 16;
  const pop = spring({ frame: t - 6, fps, config: { damping: 16 } });
  return (
    <>
      <Mascot x={960} ground={GROUND - 420 - (jump ? Math.sin((t / 16) * Math.PI) * 70 : 0)} pose={jump ? 'jump' : 'wave'} t={t} />
      {t >= 40 && <Bubble text="À vous de lire !" t={t - 40} x={960 - 200} y={40} width={400} align="center" />}
      <div style={{ position: 'absolute', left: 0, right: 0, top: 640, textAlign: 'center', opacity: pop, transform: `translateY(${(1 - pop) * 20}px)` }}>
        <div style={{ fontFamily: DISPLAY, fontSize: 180, lineHeight: 1, color: C.ink }}>Marginalia</div>
        <div style={{ fontFamily: READ, fontSize: 40, color: C.ink2, marginTop: 26 }}>Gratuit, pour Mac et Windows. Sans compte : tout reste sur votre ordinateur.</div>
        <div style={{ fontFamily: READ, fontSize: 34, color: C.muted, marginTop: 30, opacity: interpolate(t, [24, 40], [0, 1], clamp) }}>marginalia-bice.vercel.app</div>
      </div>
    </>
  );
}

export const Presentation = () => {
  useFonts();
  const frame = useCurrentFrame();
  const fade = interpolate(frame, [DURATION - 12, DURATION], [1, 0], clamp);
  const fi = FEATURES.findIndex((f) => frame >= f.from && frame < f.from + f.dur);
  return (
    <AbsoluteFill style={{ background: C.bg, overflow: 'hidden' }}>
      <AbsoluteFill style={{ opacity: fade }}>
        {frame < INTRO.dur && <Intro t={frame - INTRO.from} />}
        {fi >= 0 && <FeatureScene key={fi} f={FEATURES[fi]} t={frame - FEATURES[fi].from} i={fi} />}
        {frame >= OUTRO.from && <Outro t={frame - OUTRO.from} />}
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
