// U-14: конфетти на рекорд и конец тренировки. Одна вспышка, ~2,5 с, без библиотек.

import { useEffect, useRef } from 'react';
import { COLORS } from '../theme';

const PALETTE = [COLORS.primary, COLORS.primary2, COLORS.good, COLORS.warn, COLORS.fg];

export function Confetti({ count = 140 }: { count?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    const canvas = ref.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const W = (canvas.width = window.innerWidth);
    const H = (canvas.height = window.innerHeight);
    const parts = Array.from({ length: count }, () => ({
      x: W / 2 + (Math.random() - 0.5) * W * 0.3,
      y: H * 0.35,
      vx: (Math.random() - 0.5) * 18,
      vy: -Math.random() * 16 - 6,
      r: Math.random() * Math.PI,
      vr: (Math.random() - 0.5) * 0.4,
      s: 6 + Math.random() * 8,
      c: PALETTE[Math.floor(Math.random() * PALETTE.length)] ?? COLORS.primary,
    }));
    const start = performance.now();
    let raf = 0;
    const step = () => {
      const age = performance.now() - start;
      ctx.clearRect(0, 0, W, H);
      if (age > 2600) return;
      raf = requestAnimationFrame(step);
      ctx.globalAlpha = Math.min(1, (2600 - age) / 600);
      for (const p of parts) {
        p.vy += 0.45;
        p.vx *= 0.99;
        p.x += p.vx;
        p.y += p.vy;
        p.r += p.vr;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.r);
        ctx.fillStyle = p.c;
        ctx.fillRect(-p.s / 2, -p.s / 4, p.s, p.s / 2);
        ctx.restore();
      }
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [count]);

  return <canvas ref={ref} className="confetti" aria-hidden="true" />;
}
