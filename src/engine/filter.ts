// One Euro filter (Casiez et al., CHI 2012) для точек позы.
//
// Идея: частота среза фильтра растёт со скоростью сигнала. Точка стоит — срез низкий,
// дрожание модели гасится. Точка движется быстро — срез высокий, задержки почти нет.
// Скорость делим на масштаб тела (длину корпуса): иначе человек у камеры и у дальней стены
// сглаживался бы по-разному.

import { ENGINE_CONFIG } from './config';
import type { Vec3 } from './geometry';
import type { Landmark } from './types';

export interface OneEuroParams {
  /** Срез в покое, Гц: меньше — глаже, но больше задержка при старте движения. */
  minCutoff: number;
  /** Насколько срез растёт со скоростью: больше — меньше задержка на быстрых движениях. */
  beta: number;
  /** Срез для оценки скорости, Гц. */
  dCutoff: number;
}

function smoothingFactor(cutoffHz: number, dtSec: number): number {
  const tau = 1 / (2 * Math.PI * cutoffHz);
  return 1 / (1 + tau / dtSec);
}

export class OneEuroFilter {
  private x: number | null = null;
  private dx = 0;
  private lastT = 0;

  constructor(
    private readonly params: OneEuroParams,
    /** Разрыв во времени, после которого история сбрасывается (человек пропал и вернулся). */
    private readonly resetAfterMs: number = ENGINE_CONFIG.filter.resetAfterMs,
  ) {}

  /** value в момент tMs; scale — масштаб, на который делится скорость (1 — без нормализации). */
  filter(value: number, tMs: number, scale = 1): number {
    if (!Number.isFinite(value)) return value;
    const dtMs = tMs - this.lastT;
    if (this.x === null || dtMs > this.resetAfterMs || !Number.isFinite(this.x)) {
      this.x = value;
      this.dx = 0;
      this.lastT = tMs;
      return value;
    }
    // Тот же или более ранний кадр: фильтр не может шагнуть назад, отдаём прошлое значение.
    if (dtMs <= 0) return this.x;

    const dt = dtMs / 1000;
    const rawDx = (value - this.x) / dt;
    this.dx += smoothingFactor(this.params.dCutoff, dt) * (rawDx - this.dx);
    const speed = Math.abs(this.dx) / (scale > 0 ? scale : 1);
    const cutoff = this.params.minCutoff + this.params.beta * speed;
    this.x += smoothingFactor(cutoff, dt) * (value - this.x);
    this.lastT = tMs;
    return this.x;
  }

  reset(): void {
    this.x = null;
    this.dx = 0;
  }
}

/** Банк фильтров для 33 точек: x, y, z у каждой. Видимость не сглаживаем — её решает калибровка. */
export class LandmarkSmoother {
  private readonly image: OneEuroFilter[] = [];
  private readonly world: OneEuroFilter[] = [];

  constructor(
    private readonly imageParams: OneEuroParams = ENGINE_CONFIG.filter.image,
    private readonly worldParams: OneEuroParams = ENGINE_CONFIG.filter.world,
  ) {}

  /** Сглаживает нормализованные точки; scale — масштаб тела в тех же единицах (например, длина корпуса). */
  smoothImage(points: readonly Landmark[], tMs: number, scale: number): Landmark[] {
    return points.map((p, i) => {
      const base = i * 3;
      return {
        x: this.bank(this.image, base, this.imageParams).filter(p.x, tMs, scale),
        y: this.bank(this.image, base + 1, this.imageParams).filter(p.y, tMs, scale),
        z: this.bank(this.image, base + 2, this.imageParams).filter(p.z, tMs, scale),
        v: p.v,
      };
    });
  }

  /** Сглаживает мировые точки (метры): скорость уже в м/с, нормализация не нужна. */
  smoothWorld(points: readonly Vec3[], tMs: number): Vec3[] {
    return points.map((p, i) => {
      const base = i * 3;
      return {
        x: this.bank(this.world, base, this.worldParams).filter(p.x, tMs),
        y: this.bank(this.world, base + 1, this.worldParams).filter(p.y, tMs),
        z: this.bank(this.world, base + 2, this.worldParams).filter(p.z, tMs),
      };
    });
  }

  reset(): void {
    for (const f of this.image) f.reset();
    for (const f of this.world) f.reset();
  }

  private bank(list: OneEuroFilter[], i: number, params: OneEuroParams): OneEuroFilter {
    let f = list[i];
    if (!f) {
      f = new OneEuroFilter(params);
      list[i] = f;
    }
    return f;
  }
}
