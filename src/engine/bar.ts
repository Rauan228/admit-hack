// Турник в кадре: точки тела MediaPipe перекладину не видят, поэтому смотрим на сами пиксели.
// Вокруг кистей вырезается полоса кадра (barRegion), уменьшается до BAR_W × BAR_H в оттенках серого,
// и в ней ищется длинная тонкая линия — светлее или темнее фона сверху и снизу (analyzeBar).
// Чтобы было устойчиво к наклону камеры, перебираем несколько наклонов линии.
//
// Анфас и спиной перекладина — горизонтальная линия через обе кисти. Сбоку она смотрит в камеру торцом
// и в кадре это точка: там линию не ищем (barApplies), а «на турнике ли» решает движение тела.

import type { Landmark } from './types';

export const BAR_W = 192;
export const BAR_H = 48;

/** Прямоугольник кадра в долях (0…1), который вырезаем для поиска перекладины. */
export interface BarRegion {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface BarSeen {
  /** Высота линии в кадре (доля высоты). */
  y: number;
  /** Насколько уверенно найдена: доля ширины полосы, покрытая длинными отрезками линии (0…1). */
  score: number;
}

const L_WRIST = 15;
const R_WRIST = 16;
const L_INDEX = 19;
const R_INDEX = 20;

const vis = (p: Landmark | undefined, min = 0.3): p is Landmark => !!p && p.v >= min;

/** Хват в кадре: середина и ширина между кистями в единицах высоты кадра (x умножаем на aspect). */
function grip(image: Landmark[], aspect: number) {
  const l = image[L_WRIST];
  const r = image[R_WRIST];
  if (!vis(l) || !vis(r)) return null;
  const li = image[L_INDEX];
  const ri = image[R_INDEX];
  // Кисть над перекладиной выше запястья: берём выше из запястья и пальцев.
  const top = Math.min(l.y, r.y, vis(li, 0.2) ? li.y : 1, vis(ri, 0.2) ? ri.y : 1);
  const y = (l.y + r.y) / 2;
  return { cx: ((l.x + r.x) / 2) * aspect, y, top, span: Math.abs(l.x - r.x) * aspect };
}

/**
 * Ищем ли линию: кисти разведены в кадре (анфас или спиной). Сбоку кисти почти друг за другом —
 * перекладина смотрит в камеру торцом, линии не будет.
 */
export function barApplies(image: Landmark[], aspect: number, torso: number): boolean {
  const g = grip(image, aspect);
  return !!g && torso > 0 && g.span >= 0.55 * torso;
}

/** Полоса для поиска: шире хвата в 2,2 раза, от чуть ниже запястий до заметно выше кистей. */
export function barRegion(image: Landmark[], aspect: number): BarRegion | null {
  const g = grip(image, aspect);
  if (!g) return null;
  const span = Math.max(g.span, 0.12);
  const w = 2.2 * span;
  const h = (w * BAR_H) / BAR_W;
  const top = Math.min(g.top, g.y) - 0.6 * h;
  const r = {
    x0: (g.cx - w / 2) / aspect,
    x1: (g.cx + w / 2) / aspect,
    y0: top,
    y1: top + h,
  };
  return r.x1 - r.x0 > 0.02 && r.y1 > 0 && r.y0 < 1 ? r : null;
}

/**
 * Перекладина в вырезке gray (BAR_W × BAR_H, яркость 0…255): тонкая линия, отличная по яркости
 * в одну сторону и от того, что над ней, и от того, что под ней. null — линии нет.
 */
export function analyzeBar(gray: ArrayLike<number>, region: BarRegion): BarSeen | null {
  const W = BAR_W;
  const H = BAR_H;
  const at = (x: number, y: number) => gray[y * W + x]!;
  let best: BarSeen | null = null;
  const slopes = [-0.24, -0.2, -0.16, -0.12, -0.08, -0.04, 0, 0.04, 0.08, 0.12, 0.16, 0.2, 0.24];
  for (const d of [1, 2, 3, 5]) {
    for (const s of slopes) {
      for (let r = d + 1; r < H - d - 1; r++) {
        let covered = 0;
        let run = 0;
        let gap = 0;
        for (let x = 0; x < W; x++) {
          const y = Math.round(r + s * (x - W / 2) * (H / W) * 4);
          let on = false;
          if (y - d - 1 >= 0 && y + d + 1 < H) {
            const a = at(x, y);
            const up = at(x, y - d - 1);
            const dn = at(x, y + d + 1);
            const du = a - up;
            const dd = a - dn;
            on = du * dd > 0 && Math.min(Math.abs(du), Math.abs(dd)) >= 14;
          }
          if (on) {
            run += 1 + gap;
            gap = 0;
          } else if (run > 0 && gap < 3) {
            gap += 1;
          } else {
            // Засчитываем только длинные отрезки: шум и края одежды дают короткие.
            if (run >= W * 0.08) covered += run;
            run = 0;
            gap = 0;
          }
        }
        if (run >= W * 0.08) covered += run;
        const score = covered / W;
        if (!best || score > best.score) {
          const yMid = r / H;
          best = { y: region.y0 + yMid * (region.y1 - region.y0), score };
        }
      }
    }
  }
  return best && best.score > 0 ? best : null;
}

/** Серая вырезка полосы из кадра (видео или холст) — для analyzeBar. В браузере. */
export function sampleBar(
  source: CanvasImageSource,
  width: number,
  height: number,
  region: BarRegion,
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
): Uint8Array {
  const sx = region.x0 * width;
  const sy = region.y0 * height;
  const sw = (region.x1 - region.x0) * width;
  const sh = (region.y1 - region.y0) * height;
  ctx.fillStyle = '#808080';
  ctx.fillRect(0, 0, BAR_W, BAR_H);
  ctx.drawImage(source, sx, sy, sw, sh, 0, 0, BAR_W, BAR_H);
  const px = ctx.getImageData(0, 0, BAR_W, BAR_H).data;
  const gray = new Uint8Array(BAR_W * BAR_H);
  for (let i = 0; i < gray.length; i++)
    gray[i] = Math.round(0.299 * px[i * 4]! + 0.587 * px[i * 4 + 1]! + 0.114 * px[i * 4 + 2]!);
  return gray;
}
