// Счётчик FPS по скользящему окну: сколько кадров обработано за последнюю секунду.
// Чистый класс без DOM, время передаём снаружи — так его легко тестировать.

import { ENGINE_CONFIG } from './config';

export class FpsCounter {
  private readonly stamps: number[] = [];

  constructor(private readonly windowMs: number = ENGINE_CONFIG.fpsWindowMs) {}

  /** Отмечает обработанный кадр и возвращает текущий FPS (округлённый до целого). */
  tick(nowMs: number): number {
    this.stamps.push(nowMs);
    const from = nowMs - this.windowMs;
    while (this.stamps.length > 0 && (this.stamps[0] as number) <= from) this.stamps.shift();
    const first = this.stamps[0] as number;
    const span = nowMs - first;
    // Пока окно не набралось, считаем по реальному промежутку, чтобы первые кадры не показывали 1 FPS.
    if (this.stamps.length < 2 || span <= 0) return 0;
    return Math.round(((this.stamps.length - 1) * 1000) / span);
  }

  reset(): void {
    this.stamps.length = 0;
  }
}
