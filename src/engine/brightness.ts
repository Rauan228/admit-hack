// Яркость кадра для статуса «темно» (E-06).
// Кадр уменьшается до 32×24 и усредняется по яркости (Rec. 601). Это ~0,1 мс,
// но всё равно не каждый кадр: чтение пикселей из видео тормозит конвейер на слабых телефонах.

import { ENGINE_CONFIG } from './config';

/** Средняя яркость RGBA-буфера, 0..255. */
export function meanLuma(rgba: ArrayLike<number>): number {
  let sum = 0;
  let n = 0;
  for (let i = 0; i + 2 < rgba.length; i += 4) {
    sum += 0.299 * (rgba[i] as number) + 0.587 * (rgba[i + 1] as number) + 0.114 * (rgba[i + 2] as number);
    n++;
  }
  return n ? sum / n : 0;
}

export interface BrightnessMeter {
  /** Яркость 0..255; между замерами возвращает последнее значение, null — если мерить не получается. */
  measure(video: HTMLVideoElement, tMs: number): number | null;
}

type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export function createBrightnessMeter(
  intervalMs: number = ENGINE_CONFIG.calibration.brightnessIntervalMs,
  width = 32,
  height = 24,
): BrightnessMeter {
  let ctx: Ctx2D | null | undefined;
  let last: number | null = null;
  let lastAt = -Infinity;

  const context = (): Ctx2D | null => {
    if (ctx !== undefined) return ctx;
    try {
      if (typeof OffscreenCanvas !== 'undefined') {
        ctx = new OffscreenCanvas(width, height).getContext('2d', { willReadFrequently: true });
      } else if (typeof document !== 'undefined') {
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        ctx = canvas.getContext('2d', { willReadFrequently: true });
      } else {
        ctx = null;
      }
    } catch {
      ctx = null;
    }
    return ctx ?? null;
  };

  return {
    measure(video, tMs) {
      if (tMs - lastAt < intervalMs) return last;
      lastAt = tMs;
      const c = context();
      if (!c || video.readyState < 2) return last;
      try {
        c.drawImage(video, 0, 0, width, height);
        last = meanLuma(c.getImageData(0, 0, width, height).data);
      } catch {
        // Чтение пикселей может быть запрещено (чужой источник) — тогда «темно» не определяем.
        last = null;
      }
      return last;
    },
  };
}
