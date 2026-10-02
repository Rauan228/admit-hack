// Стойка бойца по точкам скелета (E-36): защита и уклон. Движок отдаёт удары (rep), а блок и уклон —
// это положение тела в момент атаки бота, его считаем здесь по кадрам frame, без движка.
//
// Защита — оба кулака у подбородка: кисти не ниже линии плеч, не выше головы (это уже «руки вверх»)
// и не дальше ширины плеч от носа. Уклон — плечи ушли в сторону или вниз от медленного «среднего»
// положения: слип, нырок, шаг в сторону. Среднее догоняет тело за ~1,5 с, так что наклон, в котором
// стоят долго, уклоном быть перестаёт.
//
// Все длины — в ширинах плеч, чтобы не зависеть от расстояния до камеры. x у точек — в долях ширины
// кадра, y — высоты: по x умножаем на аспект (как в движке).

import type { Landmark } from '../engine/types';

export interface Stance {
  /** Кулаки у подбородка. */
  guard: boolean;
  /** В этом кадре корпус ушёл от среднего положения — уклон. */
  dodge: boolean;
  /**
   * Сдвиг середины плеч от среднего положения в ширинах плеч: x — вправо по кадру камеры (для человека
   * лицом к камере это его левая сторона), y — вниз. Для вида от первого лица: камера в игре следует за телом.
   */
  shiftX: number;
  shiftY: number;
}

export const STANCE = {
  minVisibility: 0.5,
  /** Кисть ниже плеч не больше чем на столько ширин плеч. */
  guardBelowShoulders: 0.15,
  /** Кисть выше носа не больше чем на столько ширин плеч (выше — это жест «руки вверх», не защита). */
  guardAboveNose: 0.9,
  /** Кисть не дальше от носа по горизонтали, чем столько ширин плеч. */
  guardSpread: 1.1,
  /** Сдвиг середины плеч в сторону — уклон. */
  dodgeSide: 0.45,
  /** Опускание середины плеч (нырок) — уклон. */
  dodgeDuck: 0.45,
  /** Постоянная времени среднего положения, мс. */
  baselineTauMs: 1500,
} as const;

const NOSE = 0;
const LS = 11;
const RS = 12;
const LW = 15;
const RW = 16;

export class StanceTracker {
  private baseX: number | null = null;
  private baseY: number | null = null;
  private lastT = 0;

  update(lms: readonly Landmark[], t: number, aspect = 16 / 9): Stance {
    const ls = lms[LS];
    const rs = lms[RS];
    if (!seen(ls) || !seen(rs)) {
      // Тела не видно — среднее положение забываем: вернётся в другом месте кадра.
      this.reset();
      return { guard: false, dodge: false, shiftX: 0, shiftY: 0 };
    }
    const sw = Math.hypot((ls.x - rs.x) * aspect, ls.y - rs.y) || 1e-6;
    const cx = ((ls.x + rs.x) / 2) * aspect;
    const cy = (ls.y + rs.y) / 2;

    // Уклон — относительно среднего положения.
    let dodge = false;
    let shiftX = 0;
    let shiftY = 0;
    if (this.baseX === null || this.baseY === null) {
      this.baseX = cx;
      this.baseY = cy;
    } else {
      shiftX = (cx - this.baseX) / sw;
      shiftY = (cy - this.baseY) / sw;
      dodge = Math.abs(shiftX) > STANCE.dodgeSide || shiftY > STANCE.dodgeDuck;
      const dt = Math.max(0, t - this.lastT);
      const k = 1 - Math.exp(-dt / STANCE.baselineTauMs);
      this.baseX += (cx - this.baseX) * k;
      this.baseY += (cy - this.baseY) * k;
    }
    this.lastT = t;

    // Защита — оба кулака у подбородка.
    const nose = lms[NOSE];
    const lw = lms[LW];
    const rw = lms[RW];
    let guard = false;
    if (seen(nose) && seen(lw) && seen(rw)) {
      const noseX = nose.x * aspect;
      const atChin = (w: Landmark) =>
        w.y <= cy + STANCE.guardBelowShoulders * sw &&
        w.y >= nose.y - STANCE.guardAboveNose * sw &&
        Math.abs(w.x * aspect - noseX) <= STANCE.guardSpread * sw;
      guard = atChin(lw) && atChin(rw);
    }
    return { guard, dodge, shiftX, shiftY };
  }

  reset(): void {
    this.baseX = null;
    this.baseY = null;
  }
}

function seen(p: Landmark | undefined): p is Landmark {
  return !!p && p.v >= STANCE.minVisibility;
}
