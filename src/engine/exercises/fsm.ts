// Счётчик повторений (E-08): конечный автомат start → down → bottom → up → start
// по одному сигналу «прогресс» p: 0 — исходное положение, 1 — полная амплитуда
// (бедро параллельно полу, руки над головой…), больше 1 — ещё глубже.
//
// Автомат общий для всех упражнений: каждое упражнение только считает свой p.
// От двойных срабатываний защищают гистерезис (вниз уходим при p ≥ downMin, а стоим снова при
// p < startMax, заметно ниже) и то, что «отскок» внизу не открывает новое повторение.

import type { Phase } from '../types';

export interface FsmThresholds {
  /** p ниже — человек в исходном положении. */
  startMax: number;
  /** p выше — движение началось (фаза down). */
  downMin: number;
  /** p выше — нижняя точка, полная амплитуда (фаза bottom). */
  bottomMin: number;
  /** Амплитуда, начиная с которой повтор засчитывается (пусть и с ошибкой «мало глубины»). */
  repMin: number;
  /** Амплитуда «попытки»: меньше repMin, но больше этого — повтор не засчитан, но подсказку дать надо. */
  attemptMin: number;
  /** На сколько p должен откатиться от максимума, чтобы считать, что человек пошёл вверх. */
  reversal: number;
  /** Повтор дольше этого — сбрасываем без засчёта (человек ушёл, сел отдохнуть). */
  maxRepMs: number;
}

/** Итог одного движения (засчитанного или нет). */
export interface RepSummary {
  /** Когда вышли из исходного положения, мс. */
  startT: number;
  /** Момент наибольшей амплитуды, мс. */
  bottomT: number;
  /** Когда вернулись в исходное положение, мс. */
  endT: number;
  /** Наибольшая амплитуда за движение. */
  pMax: number;
  durationMs: number;
}

export type FsmEvent =
  | { kind: 'phase'; phase: Phase; t: number }
  /** Засчитанный повтор. */
  | { kind: 'rep'; summary: RepSummary }
  /** Движение было, но амплитуды не хватило: повтор не засчитан. */
  | { kind: 'attempt'; summary: RepSummary }
  /** Движение затянулось дольше maxRepMs и сброшено без засчёта. */
  | { kind: 'timeout'; t: number };

export class RepCounter {
  private state: Phase = 'start';
  private startT = 0;
  private pMax = 0;
  private pMaxT = 0;
  /** Максимум текущего опускания: от него считаем разворот вверх (после «отскока» он свой). */
  private localMax = 0;
  /** Минимум p на подъёме: от него считаем повторное опускание («отскок»). */
  private pMinUp = Infinity;

  constructor(private readonly th: FsmThresholds) {}

  get phase(): Phase {
    return this.state;
  }

  /** Текущая наибольшая амплитуда движения (0 в исходном положении). */
  get amplitude(): number {
    return this.state === 'start' ? 0 : this.pMax;
  }

  update(p: number, t: number): FsmEvent[] {
    const ev: FsmEvent[] = [];
    if (!Number.isFinite(p)) return ev;
    const th = this.th;

    if (this.state !== 'start' && t - this.startT > th.maxRepMs) {
      this.go('start', t, ev);
      ev.push({ kind: 'timeout', t });
      return ev;
    }

    if (this.state !== 'start' && p > this.pMax) {
      this.pMax = p;
      this.pMaxT = t;
    }
    if (this.state === 'down' || this.state === 'bottom') this.localMax = Math.max(this.localMax, p);

    switch (this.state) {
      case 'start':
        if (p >= th.downMin) {
          this.startT = t;
          this.pMax = p;
          this.pMaxT = t;
          this.localMax = p;
          this.pMinUp = Infinity;
          this.go('down', t, ev);
          if (p >= th.bottomMin) this.go('bottom', t, ev);
        }
        break;

      case 'down':
        if (p >= th.bottomMin) {
          this.go('bottom', t, ev);
        } else if (this.localMax >= th.repMin && p <= this.localMax - th.reversal) {
          // Полной амплитуды не было, но человек развернулся: нижняя точка была в момент максимума.
          this.go('bottom', this.pMaxT, ev);
          this.go('up', t, ev);
          this.pMinUp = p;
        } else if (p < th.startMax) {
          if (this.pMax >= th.attemptMin) ev.push({ kind: 'attempt', summary: this.summary(t) });
          this.go('start', t, ev);
        }
        break;

      case 'bottom':
        if (p <= this.localMax - th.reversal) {
          this.go('up', t, ev);
          this.pMinUp = p;
        }
        break;

      case 'up':
        if (p < th.startMax) {
          ev.push({ kind: 'rep', summary: this.summary(t) });
          this.go('start', t, ev);
        } else {
          this.pMinUp = Math.min(this.pMinUp, p);
          // «Отскок»: привстал и снова опустился до полной амплитуды — это тот же повтор, а не новый.
          // Мелкие покачивания на подъёме фазу не меняют, иначе UI мигал бы up/bottom.
          if (p >= th.bottomMin && p >= this.pMinUp + th.reversal) {
            this.pMinUp = Infinity;
            this.localMax = p;
            this.go('bottom', t, ev);
          }
        }
        break;
    }
    return ev;
  }

  reset(): void {
    this.state = 'start';
    this.pMax = 0;
    this.localMax = 0;
    this.pMinUp = Infinity;
  }

  private summary(endT: number): RepSummary {
    return {
      startT: this.startT,
      bottomT: this.pMaxT,
      endT,
      pMax: this.pMax,
      durationMs: endT - this.startT,
    };
  }

  private go(phase: Phase, t: number, ev: FsmEvent[]): void {
    if (phase === this.state) return;
    this.state = phase;
    ev.push({ kind: 'phase', phase, t });
  }
}
