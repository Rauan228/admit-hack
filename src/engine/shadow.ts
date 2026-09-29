// Подсветка теней перед моделью (E-18): контровой свет и тени превращают человека в силуэт — модель теряет
// руки и ноги и путает левую и правую сторону. Если сам человек в кадре заметно темнее среднего, поднимаем
// тёмные тона гамма-кривой, чтобы его средняя яркость стала около target. Если освещение нормальное — кадр
// идёт в модель как есть, бесплатно. Кривая меняется плавно (без мерцания), решение — по рамке человека
// из прошлого кадра на уменьшенной копии (дёшево), сама подсветка — таблица на 256 значений.

import { ENGINE_CONFIG, type Widen } from './config';
import type { Landmark } from './types';

type ShadowConfig = Widen<typeof ENGINE_CONFIG.pose.shadowLift>;

/** Гамма, поднимающая яркость luma (0..1) до цели: 1 — не трогать, меньше 1 — поднять тени. */
export function liftGamma(luma: number, cfg: ShadowConfig = ENGINE_CONFIG.pose.shadowLift): number {
  if (!(luma > 0) || luma >= cfg.target) return 1;
  return Math.min(1, Math.max(cfg.minGamma, Math.log(cfg.target) / Math.log(luma)));
}

/**
 * Нужна ли подсветка: человек в тени против света (темнее darkPerson и заметно темнее кадра) или весь кадр тёмный.
 * body — медиана яркости в точках тела (null — точек нет), frame — средняя яркость кадра, обе 0..1.
 * Возвращает яркость, которую поднимаем до цели, или null — свет нормальный.
 */
export function darkLuma(
  body: number | null,
  frame: number,
  cfg: ShadowConfig = ENGINE_CONFIG.pose.shadowLift,
): number | null {
  if (body !== null && body < cfg.darkPerson && body < cfg.backlitRatio * frame) return body;
  if (frame < cfg.darkFrame) return body !== null ? Math.min(body, frame) : frame;
  return null;
}

/** Таблица «яркость → яркость» для гаммы: out = 255 · (in / 255)^gamma. */
export function gammaTable(gamma: number): Uint8ClampedArray {
  const t = new Uint8ClampedArray(256);
  for (let i = 0; i < 256; i++) t[i] = Math.round(255 * Math.pow(i / 255, gamma));
  return t;
}

/** Точки тела, по которым судим, в тени ли человек: плечи, локти, таз, колени, щиколотки. */
const BODY_POINTS = [11, 12, 13, 14, 23, 24, 25, 26, 27, 28];

type Canvas2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
type AnyCanvas = HTMLCanvasElement | OffscreenCanvas;

function makeCanvas(w: number, h: number): { canvas: AnyCanvas; ctx: Canvas2D } | null {
  try {
    const canvas: AnyCanvas =
      typeof document !== 'undefined' ? document.createElement('canvas') : new OffscreenCanvas(w, h);
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true }) as Canvas2D | null;
    return ctx ? { canvas, ctx } : null;
  } catch {
    return null;
  }
}

export class ShadowLift {
  private small: { canvas: AnyCanvas; ctx: Canvas2D } | null = null;
  private big: { canvas: AnyCanvas; ctx: Canvas2D } | null = null;
  private gamma = 1;
  private target = 1;
  private lastMeasureMs = -Infinity;
  private table: Uint8ClampedArray | null = null;
  private tableGamma = 1;

  constructor(private readonly cfg: ShadowConfig = ENGINE_CONFIG.pose.shadowLift) {}

  /** Текущая гамма (1 — кадр идёт как есть). */
  get current(): number {
    return this.gamma;
  }

  /** Кадр для модели: сам video, если свет нормальный, или холст с поднятыми тенями. */
  prepare(
    video: HTMLVideoElement,
    last: readonly Landmark[] | null,
    tMs: number,
  ): HTMLVideoElement | AnyCanvas {
    const w = video.videoWidth;
    const h = video.videoHeight;
    if (!(w > 0 && h > 0)) return video;
    // Свет меняется медленно — яркость человека меряем не каждый кадр (чтение пикселей не бесплатно).
    if (tMs - this.lastMeasureMs >= this.cfg.measureEveryMs) {
      this.lastMeasureMs = tMs;
      const m = this.measure(video, last);
      if (m) {
        const dark = darkLuma(m.body, m.frame, this.cfg);
        this.target = dark === null ? 1 : liftGamma(dark, this.cfg);
      }
    }
    this.gamma += (this.target - this.gamma) * this.cfg.smoothing;
    if (this.gamma > 0.97) return video;
    if (!this.big || this.big.canvas.width !== w || this.big.canvas.height !== h) this.big = makeCanvas(w, h);
    const big = this.big;
    if (!big) return video;
    // Таблицу пересчитываем, только когда гамма заметно сдвинулась.
    if (!this.table || Math.abs(this.tableGamma - this.gamma) > 0.01) {
      this.table = gammaTable(this.gamma);
      this.tableGamma = this.gamma;
    }
    const lut = this.table;
    big.ctx.drawImage(video, 0, 0, w, h);
    const img = big.ctx.getImageData(0, 0, w, h);
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      d[i] = lut[d[i] as number] as number;
      d[i + 1] = lut[d[i + 1] as number] as number;
      d[i + 2] = lut[d[i + 2] as number] as number;
    }
    big.ctx.putImageData(img, 0, 0);
    return big.canvas;
  }

  /** Яркость (0..1): медиана в точках тела (плечи, локти, таз, колени, щиколотки) и среднее по кадру, на копии 64×48. */
  private measure(
    video: HTMLVideoElement,
    last: readonly Landmark[] | null,
  ): { body: number | null; frame: number } | null {
    const W = 64;
    const H = 48;
    this.small ??= makeCanvas(W, H);
    const s = this.small;
    if (!s) return null;
    try {
      s.ctx.drawImage(video, 0, 0, W, H);
      const d = s.ctx.getImageData(0, 0, W, H).data;
      const luma = (x: number, y: number) => {
        const i = (Math.min(H - 1, Math.max(0, y)) * W + Math.min(W - 1, Math.max(0, x))) * 4;
        return (0.299 * (d[i] as number) + 0.587 * (d[i + 1] as number) + 0.114 * (d[i + 2] as number)) / 255;
      };
      let sum = 0;
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) sum += luma(x, y);
      const body = BODY_POINTS.map((i) => last?.[i])
        .filter((p): p is Landmark => !!p && p.v >= 0.3 && Number.isFinite(p.x) && Number.isFinite(p.y))
        .map((p) => luma(Math.floor(p.x * W), Math.floor(p.y * H)))
        .sort((a, b) => a - b);
      return {
        body: body.length >= 4 ? (body[Math.floor(body.length / 2)] as number) : null,
        frame: sum / (W * H),
      };
    } catch {
      return null;
    }
  }
}
