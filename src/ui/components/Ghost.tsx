// U-12: «призрак» — эталонное движение (engine/ghostPoses.ts), нарисованное тем же кодом, что и скелет.

import { useEffect, useRef } from 'react';
import { GHOST_KEYFRAMES, ghostPoseAt } from '../../engine/ghostPoses';
import type { ExerciseId } from '../../engine/types';
import { drawBody } from '../lib/body';
import { BONES, type View } from '../lib/skeleton';
import { COLORS } from '../theme';

export function Ghost({
  exercise,
  className,
  color = COLORS.primary,
}: {
  exercise: ExerciseId;
  className?: string;
  color?: string;
}) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const start = performance.now();
    const box = bounds(exercise);
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
      // При reduced motion показываем нижнюю точку движения статично — самую информативную позу.
      const t = reduced ? 1400 : performance.now() - start;
      const lms = ghostPoseAt(exercise, t);
      drawBody(ctx, fitView(W, H, box), lms, {
        fill: color,
        line: '#fdba74',
        glow: 'rgba(249, 115, 22, 0.7)',
        outline: Math.max(2, H * 0.006),
      });
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [exercise, color]);

  return <canvas ref={ref} className={className} aria-hidden="true" />;
}

/** Только точки, которые рисуются: служебные точки лица и кистей не должны растягивать рамку. */
const DRAWN = [...new Set([0, ...BONES.flat()])];

/** Габариты движения по всем ключевым кадрам: фигура вписывается в холст целиком и не «прыгает». */
function bounds(exercise: ExerciseId) {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const frame of GHOST_KEYFRAMES[exercise]) {
    for (const i of DRAWN) {
      const p = frame[i];
      if (!p) continue;
      x0 = Math.min(x0, p.x);
      x1 = Math.max(x1, p.x);
      y0 = Math.min(y0, p.y);
      y1 = Math.max(y1, p.y);
    }
  }
  // Запас сверху — под круг головы, который рисуется вокруг носа.
  return { x0, x1, y0: y0 - (y1 - y0) * 0.08, y1 };
}

function fitView(W: number, H: number, b: ReturnType<typeof bounds>): View {
  const s = Math.min((W * 0.88) / (b.x1 - b.x0), (H * 0.88) / (b.y1 - b.y0));
  const cx = (b.x0 + b.x1) / 2;
  const cy = (b.y0 + b.y1) / 2;
  // toScreen: x = W - (ox + p.x * dw) при зеркале — центр движения попадает в центр холста.
  return { W, H, dw: s, dh: s, ox: W / 2 - cx * s, oy: H / 2 - cy * s, mirror: true };
}
