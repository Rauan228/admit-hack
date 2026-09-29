// U-12: «призрак» — 3D-атлет в стиле анатомического атласа (three/athlete3d.ts, three.js грузится лениво);
// пока 3D не загрузился или WebGL недоступен — 2D-версия (lib/athlete.ts).
// Производительность: рисуем только когда холст виден на экране, не чаще 30 кадров в секунду,
// на телефоне — плотность пикселей 1 и без свечения (shadowBlur на мобильных GPU очень дорогой).

import { useEffect, useRef } from 'react';
import { isMobileDevice } from '../../engine/perf';
import type { ExerciseId } from '../../engine/types';
import { PREFERRED_YAW, athletePose, drawAthlete } from '../lib/athlete';

export interface GhostProps {
  exercise: ExerciseId;
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
