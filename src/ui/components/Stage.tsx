// U-03: сцена — зеркальное видео камеры и скелет поверх, на всех экранах одна и та же.
// Рисуем сами на canvas (а не <video> + CSS), чтобы видео и скелет прошли одно преобразование cover.

import { useEffect, useRef } from 'react';
import { live } from '../engine/bus';
import { ERROR_TTL_MS, overlay } from '../engine/overlay';
import { coverView, drawHintArrows, drawSkeleton } from '../lib/skeleton';
import { COLORS } from '../theme';
import './Stage.css';

/** Размер кадра мок-движка и камеры по умолчанию (ENGINE_CONFIG.camera). */
const DEFAULT_SRC = { w: 640, h: 480 };
const FLASH_MS = 520;
/** Если кадров нет дольше — скелет не рисуем (человек ушёл или движок стоит). */
const STALE_MS = 700;

export function Stage({ video }: { video: HTMLVideoElement | null }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    let raf = 0;

    const draw = () => {
      raf = requestAnimationFrame(draw);
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const W = canvas.clientWidth;
      const H = canvas.clientHeight;
      if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) {
        canvas.width = Math.round(W * dpr);
        canvas.height = Math.round(H * dpr);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      const hasVideo = !!video && video.readyState >= 2 && video.videoWidth > 0;
      const srcW = hasVideo ? video.videoWidth : DEFAULT_SRC.w;
      const srcH = hasVideo ? video.videoHeight : DEFAULT_SRC.h;
      const view = coverView(W, H, srcW, srcH, true);
      const now = performance.now();

      // Фон: видео или (в моке) тёмный градиент со «студийным» светом.
      if (hasVideo) {
        ctx.save();
        ctx.translate(W, 0);
        ctx.scale(-1, 1);
        ctx.drawImage(video, view.ox, view.oy, view.dw, view.dh);
        ctx.restore();
      } else {
        const g = ctx.createRadialGradient(W / 2, H * 0.35, 0, W / 2, H * 0.4, Math.max(W, H) * 0.8);
        g.addColorStop(0, '#1b2640');
        g.addColorStop(1, COLORS.bgDeep);
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, W, H);
      }
      if (overlay.dim > 0) {
        ctx.fillStyle = `rgba(7, 11, 22, ${overlay.dim})`;
        ctx.fillRect(0, 0, W, H);
      }

      const lms = live.landmarks;
      if (!lms || now - live.lastFrameAt > STALE_MS || overlay.skeleton <= 0) return;

      const errorAge = now - overlay.errorAt;
      const errorActive = overlay.errorAt > 0 && errorAge < ERROR_TTL_MS;
      const flashAge = now - overlay.flashAt;
      const flashing = overlay.flashAt > 0 && flashAge < FLASH_MS;
      const flashColor = overlay.flashClean ? COLORS.good : COLORS.warn;
      const errorColor = overlay.errorSeverity === 'warn' ? COLORS.warn : COLORS.bad;

      drawSkeleton(ctx, view, lms, {
        color: flashing ? flashColor : COLORS.primary,
        glow: flashing ? flashColor : 'rgba(249, 115, 22, 0.55)',
        alpha: overlay.skeleton,
        errorJoints: errorActive ? overlay.errorJoints : undefined,
        errorColor,
        pulse: 0.5 + 0.5 * Math.sin(now / 130),
        width: flashing ? Math.max(6, view.dh * 0.012) : undefined,
      });

      if (errorActive && overlay.errorArrow) {
        ctx.globalAlpha = Math.min(1, (ERROR_TTL_MS - errorAge) / 400);
        drawHintArrows(ctx, view, lms, overlay.errorJoints, overlay.errorArrow, errorColor, now);
        ctx.globalAlpha = 1;
      }
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [video]);

  return <canvas ref={canvasRef} className="stage" aria-hidden="true" />;
}
