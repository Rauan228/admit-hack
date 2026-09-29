// U-03: сцена — зеркальное видео камеры и объёмная фигура поверх, на всех экранах одна и та же.
// Рисуем сами на canvas (а не <video> + CSS), чтобы видео и скелет прошли одно преобразование cover.
// Скелет — тонкий трекинг (lib/trace.ts). Под скелетом — тот кадр камеры, на котором движок посчитал точки
// (frame.image, E-23), а не живое видео: иначе видео успевает уйти на кадр вперёд и скелет отстаёт от руки.
// Сглаживание точек для экрана — в движке (RenderSmoother), второй фильтр здесь добавлял бы задержку.
// На чистом повторе — вспышка фигуры, ударная волна и частицы из центра тела.

import { useEffect, useRef } from 'react';
import { isMobileDevice } from '../../engine/perf';
import { live } from '../engine/bus';
import { ERROR_TTL_MS, overlay } from '../engine/overlay';
import { bodyCenter } from '../lib/body';
import { coverView, drawHintArrows } from '../lib/skeleton';
import { drawTrace } from '../lib/trace';
import { COLORS } from '../theme';
import './Stage.css';

/** Размер кадра мок-движка и камеры по умолчанию (ENGINE_CONFIG.camera). */
const DEFAULT_SRC = { w: 640, h: 480 };
const FLASH_MS = 520;
const WAVE_MS = 700;
/** Если кадров нет дольше — фигуру не рисуем (человек ушёл или движок стоит). */
const STALE_MS = 700;
/** Телефон: без свечения (shadowBlur) и с меньшей плотностью пикселей — иначе падает FPS. */
const MOBILE = isMobileDevice();

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  size: number;
  color: string;
}

export function Stage({ video }: { video: HTMLVideoElement | null }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    let raf = 0;
    let lastFlash = 0;
    let wave: { x: number; y: number; at: number; color: string } | null = null;
    const particles: Particle[] = [];

    const burst = (x: number, y: number, clean: boolean) => {
      if (reduced) return;
      const palette = clean ? [COLORS.good, COLORS.primary, COLORS.fg] : [COLORS.warn, COLORS.primary];
      for (let i = 0; i < (MOBILE ? (clean ? 20 : 8) : clean ? 46 : 16); i += 1) {
        const a = Math.random() * Math.PI * 2;
        const speed = 3 + Math.random() * (clean ? 9 : 5);
        particles.push({
          x,
          y,
          vx: Math.cos(a) * speed,
          vy: Math.sin(a) * speed - 2,
          life: 1,
          size: 3 + Math.random() * 5,
          color: palette[i % palette.length] ?? COLORS.primary,
        });
      }
    };

    const draw = () => {
      raf = requestAnimationFrame(draw);
      const dpr = Math.min(window.devicePixelRatio || 1, MOBILE ? 1.25 : 2);
      const W = canvas.clientWidth;
      const H = canvas.clientHeight;
      if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) {
        canvas.width = Math.round(W * dpr);
        canvas.height = Math.round(H * dpr);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      const now = performance.now();
      // Кадр движка, пока он свежий; движок встал — живое видео, чтобы картинка не замерла.
      const frameImage =
        live.image && live.image.width > 0 && now - live.lastFrameAt <= STALE_MS ? live.image : null;
      const hasVideo = !!video && video.readyState >= 2 && video.videoWidth > 0;
      const srcW = frameImage ? frameImage.width : hasVideo ? video.videoWidth : DEFAULT_SRC.w;
      const srcH = frameImage ? frameImage.height : hasVideo ? video.videoHeight : DEFAULT_SRC.h;
      const view = coverView(W, H, srcW, srcH, true);

      // Фон: кадр движка (или видео) либо (в моке) тёмный градиент со «студийным» светом.
      if (frameImage || hasVideo) {
        ctx.save();
        ctx.translate(W, 0);
        ctx.scale(-1, 1);
        ctx.drawImage(frameImage ?? video!, view.ox, view.oy, view.dw, view.dh);
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
      const fresh = !!lms && now - live.lastFrameAt <= STALE_MS && overlay.skeleton > 0;

      const errorAge = now - overlay.errorAt;
      const errorActive = overlay.errorAt > 0 && errorAge < ERROR_TTL_MS;
      const flashAge = now - overlay.flashAt;
      const flashing = overlay.flashAt > 0 && flashAge < FLASH_MS;
      const flashColor = overlay.flashClean ? COLORS.good : COLORS.warn;
      const errorColor = overlay.errorSeverity === 'warn' ? COLORS.warn : COLORS.bad;

      // Новый повтор: волна и частицы из центра тела.
      if (overlay.flashAt !== lastFlash) {
        lastFlash = overlay.flashAt;
        const c = fresh && lms ? bodyCenter(view, lms) : null;
        if (c && overlay.flashAt > 0) {
          wave = { ...c, at: now, color: flashColor };
          burst(c.x, c.y, overlay.flashClean);
        }
      }

      if (fresh && lms) {
        drawTrace(ctx, view, lms, {
          color: flashing ? flashColor : COLORS.primary2,
          glow: MOBILE ? null : flashing ? flashColor : 'rgba(249, 115, 22, 0.7)',
          alpha: overlay.skeleton * (flashing ? 1 : 0.92),
          errorJoints: errorActive ? overlay.errorJoints : undefined,
          errorColor,
          pulse: 0.5 + 0.5 * Math.sin(now / 130),
        });

        if (errorActive && overlay.errorArrow) {
          ctx.globalAlpha = Math.min(1, (ERROR_TTL_MS - errorAge) / 400);
          drawHintArrows(ctx, view, lms, overlay.errorJoints, overlay.errorArrow, errorColor, now);
          ctx.globalAlpha = 1;
        }
      }

      // Ударная волна.
      if (wave) {
        const t = (now - wave.at) / WAVE_MS;
        if (t >= 1) wave = null;
        else {
          ctx.save();
          ctx.strokeStyle = wave.color;
          ctx.globalAlpha = (1 - t) * 0.8;
          ctx.lineWidth = 10 * (1 - t) + 2;
          ctx.beginPath();
          ctx.arc(wave.x, wave.y, 30 + t * Math.min(W, H) * 0.35, 0, Math.PI * 2);
          ctx.stroke();
          ctx.restore();
        }
      }

      // Частицы.
      for (let i = particles.length - 1; i >= 0; i -= 1) {
        const p = particles[i]!;
        p.vy += 0.28;
        p.vx *= 0.97;
        p.x += p.vx;
        p.y += p.vy;
        p.life -= 0.022;
        if (p.life <= 0) {
          particles.splice(i, 1);
          continue;
        }
        ctx.globalAlpha = p.life;
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * p.life, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [video]);

  return <canvas ref={canvasRef} className="stage" aria-hidden="true" />;
}
