// Эталон «стоя» для упражнения: скользящий максимум за последние N мс.
//
// Длина бедра или корпуса стоя нужна как опора для нормализации: присед меряем как «насколько
// укоротилась вертикаль бедра», наклон — как «насколько укоротился корпус». Максимум, а не среднее:
// стоя вертикаль самая длинная, любое движение её только укорачивает. Окно по времени — чтобы эталон
// подстроился, если человек отошёл от камеры (всё стало меньше) или подошёл (больше).

export class SlidingMax {
  /** Монотонная очередь: значения убывают от головы к хвосту, в голове — максимум окна. */
  private samples: { t: number; v: number }[] = [];
  private last: number | null = null;

  constructor(private readonly windowMs: number) {}

  push(v: number, tMs: number): void {
    if (!Number.isFinite(v)) return;
    while (this.samples.length > 0 && (this.samples[this.samples.length - 1] as { v: number }).v <= v) {
      this.samples.pop();
    }
    this.samples.push({ t: tMs, v });
    this.expire(tMs);
    this.last = (this.samples[0] as { v: number }).v;
  }

  /** Максимум окна; если окно давно не пополнялось — последнее известное значение. */
  get value(): number | null {
    return this.last;
  }

  /** Выбросить устаревшие значения (последнее оставляем: лучше старый эталон, чем никакого). */
  expire(tMs: number): void {
    while (this.samples.length > 1 && (this.samples[0] as { t: number }).t < tMs - this.windowMs) {
      this.samples.shift();
    }
  }

  reset(): void {
    this.samples = [];
    this.last = null;
  }
}

/** Скользящий минимум — та же очередь на отрицаниях (например, стойка «ноги вместе» в покое). */
export class SlidingMin {
  private readonly inner: SlidingMax;

  constructor(windowMs: number) {
    this.inner = new SlidingMax(windowMs);
  }

  push(v: number, tMs: number): void {
    this.inner.push(-v, tMs);
  }

  get value(): number | null {
    const v = this.inner.value;
    return v === null ? null : -v;
  }

  expire(tMs: number): void {
    this.inner.expire(tMs);
  }

  reset(): void {
    this.inner.reset();
  }
}
