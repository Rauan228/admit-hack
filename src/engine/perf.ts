// Производительность на слабых устройствах (E-18).
//
// Три ступени, по нарастающей:
// 1. телефон — сразу лёгкая модель (lite) и камера 480×360;
// 2. детекция в среднем дольше budgetMs — один раз переключаемся на lite без остановки камеры;
// 3. всё равно дольше slowMs — обрабатываем не чаще throttleFps: главный поток нужен интерфейсу
//    (анимации, голос), иначе UI дёргается, пока модель думает.

import { ENGINE_CONFIG, type Widen } from './config';

type PerfConfig = Widen<typeof ENGINE_CONFIG.perf>;

/** Телефон или планшет: по userAgentData, иначе по строке userAgent. */
export function isMobileDevice(nav: Navigator | undefined = globalThis.navigator): boolean {
  if (!nav) return false;
  const data = (nav as Navigator & { userAgentData?: { mobile?: boolean } }).userAgentData;
  if (typeof data?.mobile === 'boolean') return data.mobile;
  return /Android|iPhone|iPad|iPod|Mobile/i.test(nav.userAgent ?? '');
}

export class AdaptivePerf {
  /** Скользящее среднее времени детекции, мс. */
  private avg = 0;
  private samples = 0;
  private lastProcessed = -Infinity;
  private downgradeAsked = false;
  private slowSince: number | null = null;
  private throttling = false;

  constructor(private readonly cfg: PerfConfig = ENGINE_CONFIG.perf) {}

  /** Среднее время детекции, мс. */
  get detectMs(): number {
    return this.avg;
  }

  get isThrottling(): boolean {
    return this.throttling;
  }

  /** Обрабатывать ли кадр сейчас (при троттлинге — не чаще throttleFps). */
  shouldProcess(tMs: number): boolean {
    if (!this.throttling) return true;
    return tMs - this.lastProcessed >= 1000 / this.cfg.throttleFps - 1;
  }

  /**
   * Учесть длительность детекции. Возвращает 'downgrade', если пора один раз перейти на lite.
   * Решения — по устойчивому среднему за warmupSamples кадров, а не по одному медленному кадру
   * (первые кадры на GPU всегда медленные — компиляция шейдеров).
   */
  record(tMs: number, durationMs: number): 'downgrade' | null {
    this.lastProcessed = tMs;
    this.samples += 1;
    const k = 1 / Math.min(this.samples, this.cfg.warmupSamples);
    this.avg += k * (durationMs - this.avg);
    if (this.samples < this.cfg.warmupSamples) return null;

    const slow = this.avg > this.cfg.budgetMs;
    if (slow) this.slowSince ??= tMs;
    else this.slowSince = null;
    this.throttling = this.avg > this.cfg.slowMs;
    if (slow && !this.downgradeAsked && tMs - (this.slowSince ?? tMs) >= this.cfg.sustainMs) {
      this.downgradeAsked = true;
      return 'downgrade';
    }
    return null;
  }

  /** Модель сменилась — начинаем мерить заново (но на full второй раз не вернёмся). */
  resetMeasurements(): void {
    this.avg = 0;
    this.samples = 0;
    this.slowSince = null;
    this.throttling = false;
  }
}

/** Общий WebGL-буфер атлетов (ui/three/renderer.ts) не больше этого по стороне — холст не крупнее. */
export const RENDER_MAX_SIDE = 2048;

/**
 * Во сколько раз рисовать холст относительно его CSS-размера: по плотности экрана (телефон 3×, увеличение
 * страницы в браузере тоже поднимает её), но не больше бюджета пикселей на холст — слабым телефонам не
 * тяжело, — и не больше общего буфера по стороне.
 */
export function canvasScale(cssW: number, cssH: number, mobile: boolean, maxSide = RENDER_MAX_SIDE): number {
  const dpr = globalThis.devicePixelRatio || 1;
  const budget = mobile ? 2_200_000 : 4_500_000;
  let s = Math.min(dpr, mobile ? 2.5 : 3);
  s = Math.min(s, Math.sqrt(budget / Math.max(1, cssW * cssH)));
  s = Math.min(s, maxSide / Math.max(1, cssW, cssH));
  return Math.max(0.5, s);
}

/**
 * Облегчённая модель атлета (в ~3 раза меньше треугольников) — только слабым устройствам: мало памяти
 * или ядер. Современный телефон получает полную — вблизи облегчённая видна гранями.
 */
export function wantsLiteModel(nav: Navigator | undefined = globalThis.navigator): boolean {
  if (!nav) return false;
  const memory = (nav as Navigator & { deviceMemory?: number }).deviceMemory;
  const cores = nav.hardwareConcurrency;
  return (typeof memory === 'number' && memory < 4) || (typeof cores === 'number' && cores > 0 && cores < 4);
}
