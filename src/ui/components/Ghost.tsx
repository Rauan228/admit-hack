// U-12: «призрак» — 3D-атлет в стиле анатомического атласа (three/athlete3d.ts, three.js грузится лениво);
// пока 3D не загрузился или WebGL недоступен — 2D-версия (lib/athlete.ts).
// Производительность: рисуем только когда холст виден на экране, не чаще 30 кадров в секунду,
// на телефоне — плотность пикселей 1 и без свечения (shadowBlur на мобильных GPU очень дорогой).

import { useEffect, useRef } from 'react';
import { isMobileDevice } from '../../engine/perf';
import { GHOST_DURATION_MS, ghostPoseAt } from '../../engine/ghostPoses';
import type { ExerciseId, Landmark } from '../../engine/types';
import { PREFERRED_YAW, athletePose, drawAthlete, hasRecordedMotion, type GhostId } from '../lib/athlete';
import { drawTrace } from '../lib/trace';

export interface GhostProps {
  exercise: GhostId;
  className?: string;
  /** Поворот вокруг вертикали, рад. */
  yaw?: number;
  /** Плавно покачивать поворот — видно объём. */
  sway?: boolean;
  highlight?: ReadonlySet<number>;
  /** Отсчёт времени снаружи (синхронизация с HUD на лендинге), иначе — с момента монтирования. */
  clock?: () => number;
}

const MOBILE = isMobileDevice();
/** three.js — отдельный чанк: грузим один раз и только там, где есть атлет. */
let load3d: Promise<typeof import('../three')> | null = null;
const FRAME_MS = 1000 / 30;

export function Ghost({ exercise, className, yaw: yawProp, sway = false, highlight, clock }: GhostProps) {
  const yaw = yawProp ?? PREFERRED_YAW[exercise];
  const ref = useRef<HTMLCanvasElement>(null);
  const hl = useRef(highlight);
  const clk = useRef(clock);
  useEffect(() => {
    hl.current = highlight;
    clk.current = clock;
  });

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const start = performance.now();
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    let raf = 0;
    let visible = true;
    let last = 0;
    let view: import('../three').AthleteView | null = null;
    let zview: import('../three').ZAthleteView | null = null;
    let cancelled = false;
    // Упражнения без эталона — стикмен по призраку движка, 3D не грузим.
    const stick = !hasRecordedMotion(exercise);
    if (!stick) {
      load3d ??= import('../three');
      load3d
        .then((m) => {
          if (cancelled) return;
          view = new m.AthleteView(exercise);
          zview = new m.ZAthleteView(exercise);
        })
        .catch(() => {
          /* без 3D — остаётся 2D */
        });
    }

    const draw = (now: number) => {
      raf = 0;
      if (!visible || document.hidden) return;
      raf = requestAnimationFrame(draw);
      if (now - last < FRAME_MS) return;
      last = now;
      const dpr = Math.min(window.devicePixelRatio || 1, MOBILE ? 1 : 1.5);
      const W = canvas.clientWidth;
      const H = canvas.clientHeight;
      if (!W || !H) return;
      if (canvas.width !== Math.round(W * dpr)) canvas.width = Math.round(W * dpr);
      if (canvas.height !== Math.round(H * dpr)) canvas.height = Math.round(H * dpr);
      // При reduced motion — статичная середина движения (самая информативная поза).
      const t = reduced ? 1300 : (clk.current?.() ?? now - start);
      const y = sway && !reduced ? yaw + Math.sin(now / 2400) * 0.3 : yaw;
      if (stick) {
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, W, H);
        drawStick(ctx, W, H, exercise as ExerciseId, t, hl.current);
        if (reduced) {
          cancelAnimationFrame(raf);
          raf = 0;
        }
        return;
      }
      const pose = athletePose(exercise, t);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      const o3d = { yaw: y, mobile: MOBILE, highlight: hl.current };
      // Анатомическая модель; пока грузится — процедурный 3D; без WebGL — 2D.
      const drawn3d =
        (!!zview && zview.render(ctx, canvas.width, canvas.height, pose, o3d)) ||
        (!!view && view.render(ctx, canvas.width, canvas.height, pose, o3d));
      if (!drawn3d) {
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, W, H);
        drawAthlete(ctx, W, H, exercise, pose, { yaw: y, glow: !MOBILE, highlight: hl.current });
      }
      if (reduced) {
        cancelAnimationFrame(raf);
        raf = 0;
      }
    };
    const kick = () => {
      if (!raf && visible && !document.hidden) raf = requestAnimationFrame(draw);
    };

    const io =
      'IntersectionObserver' in window
        ? new IntersectionObserver(
            ([entry]) => {
              visible = !!entry?.isIntersecting;
              kick();
            },
            { rootMargin: '120px' },
          )
        : null;
    io?.observe(canvas);
    document.addEventListener('visibilitychange', kick);
    kick();
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      io?.disconnect();
      document.removeEventListener('visibilitychange', kick);
    };
  }, [exercise, yaw, sway]);

  return <canvas ref={ref} className={className} aria-hidden="true" />;
}

// ——— Стикмен-эталон (пока у упражнения нет своей анимации атлета) ———

/** Точки, которые рисует стикмен (голова, руки, ноги) — по ним и вписываем фигуру. */
const STICK_JOINTS = [0, 7, 8, 11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28, 31, 32];
const stickBox = new Map<ExerciseId, { x0: number; x1: number; y0: number; y1: number }>();

/** Габариты призрака за весь цикл: фигура вписана в карточку и не «прыгает». */
function boxOf(ex: ExerciseId) {
  const hit = stickBox.get(ex);
  if (hit) return hit;
  const b = { x0: Infinity, x1: -Infinity, y0: Infinity, y1: -Infinity };
  for (let i = 0; i < 40; i += 1) {
    const pose = ghostPoseAt(ex, (i / 40) * GHOST_DURATION_MS[ex]);
    for (const j of STICK_JOINTS) {
      const p = pose[j];
      if (!p || !(p.v >= 0.5)) continue;
      b.x0 = Math.min(b.x0, p.x);
      b.x1 = Math.max(b.x1, p.x);
      b.y0 = Math.min(b.y0, p.y);
      b.y1 = Math.max(b.y1, p.y);
    }
  }
  stickBox.set(ex, b);
  return b;
}

function drawStick(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  ex: ExerciseId,
  t: number,
  highlight?: ReadonlySet<number>,
) {
  const b = boxOf(ex);
  const s = Math.min((W * 0.8) / Math.max(0.05, b.x1 - b.x0), (H * 0.84) / Math.max(0.05, b.y1 - b.y0));
  const view = {
    W,
    H,
    ox: W / 2 - (s * (b.x0 + b.x1)) / 2,
    oy: H * 0.93 - s * b.y1,
    dw: s,
    dh: s,
    mirror: false,
  };
  // Тень под ногами.
  const g = ctx.createRadialGradient(W / 2, H * 0.935, 0, W / 2, H * 0.935, W * 0.22);
  g.addColorStop(0, 'rgba(0, 0, 0, 0.45)');
  g.addColorStop(1, 'rgba(0, 0, 0, 0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, H * 0.88, W, H * 0.12);
  const pose = ghostPoseAt(ex, t) as Landmark[];
  drawTrace(ctx, view, pose, {
    color: '#cbd5e1',
    glow: MOBILE ? null : 'rgba(249, 115, 22, 0.45)',
    alpha: 1,
    errorJoints: highlight,
    errorColor: '#ef4444',
    pulse: 0.5 + 0.5 * Math.sin(t / 130),
  });
}
