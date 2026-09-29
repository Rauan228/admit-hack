// U-12: «призрак» — эталонное движение настоящего человека (lib/athlete.ts), 3D-атлет.

import { useEffect, useRef } from 'react';
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
    const draw = () => {
      raf = requestAnimationFrame(draw);
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const W = canvas.clientWidth;
      const H = canvas.clientHeight;
      if (!W || !H) return;
      if (canvas.width !== Math.round(W * dpr)) canvas.width = Math.round(W * dpr);
      if (canvas.height !== Math.round(H * dpr)) canvas.height = Math.round(H * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      const now = performance.now();
      // При reduced motion — статичная середина движения (самая информативная поза).
      const t = reduced ? 1300 : (clk.current?.() ?? now - start);
      const y = sway && !reduced ? yaw + Math.sin(now / 2400) * 0.35 : yaw;
      drawAthlete(ctx, W, H, exercise, athletePose(exercise, t), {
        yaw: y,
        glow: 'rgba(249, 115, 22, 0.45)',
        highlight: hl.current,
      });
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [exercise, yaw, sway]);

  return <canvas ref={ref} className={className} aria-hidden="true" />;
}
