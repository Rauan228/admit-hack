// Кого из нескольких людей в кадре тренировать (E-17).
//
// На демо за спиной всегда кто-то ходит. Берём ближайшего к камере — самого крупного (длина корпуса),
// и «прилипаем» к нему: фокус переходит на другого, только если тот крупнее в switchRatio раз.
// Иначе на каждом шаге прохожего фокус бы прыгал, и повторы считались бы по чужому человеку.

import { ENGINE_CONFIG, type Widen } from './config';
import type { Landmark } from './types';

type PersonConfig = Widen<typeof ENGINE_CONFIG.person>;

interface Body {
  x: number;
  y: number;
  size: number;
}

/** Центр (середина таза или плеч) и размер (длина корпуса) человека; null — не оценить. */
export function bodyOf(points: readonly Landmark[]): Body | null {
  const [ls, rs, lh, rh] = [11, 12, 23, 24].map((i) => points[i]);
  if (!ls || !rs || !lh || !rh) return null;
  const sx = (ls.x + rs.x) / 2;
  const sy = (ls.y + rs.y) / 2;
  const hx = (lh.x + rh.x) / 2;
  const hy = (lh.y + rh.y) / 2;
  const size = Math.hypot(sx - hx, sy - hy);
  return size > 0 ? { x: hx, y: hy, size } : null;
}

export class PersonSelector {
  private tracked: Body | null = null;

  constructor(private readonly cfg: PersonConfig = ENGINE_CONFIG.person) {}

  /** Индекс человека, которого тренируем; -1 — никого. */
  pick(people: readonly (readonly Landmark[])[]): number {
    const bodies = people.map(bodyOf);
    const valid = bodies.map((b, i) => ({ b, i })).filter((x): x is { b: Body; i: number } => x.b !== null);
    if (valid.length === 0) {
      this.tracked = null;
      return people.length > 0 ? 0 : -1;
    }
    const biggest = valid.reduce((a, c) => (c.b.size > a.b.size ? c : a));
    let chosen = biggest;
    if (this.tracked) {
      const t = this.tracked;
      // Тот же человек — ближайший к прошлому центру и не сильно изменившийся в размере.
      const same = valid.reduce((a, c) =>
        Math.hypot(c.b.x - t.x, c.b.y - t.y) < Math.hypot(a.b.x - t.x, a.b.y - t.y) ? c : a,
      );
      const near = Math.hypot(same.b.x - t.x, same.b.y - t.y) <= this.cfg.sameMaxShift * t.size;
      if (near && biggest.b.size < this.cfg.switchRatio * same.b.size) chosen = same;
    }
    this.tracked = chosen.b;
    return chosen.i;
  }

  reset(): void {
    this.tracked = null;
  }
}

/**
 * Фильтр правдоподобия позы для подсчёта (E-17). Сбой модели на 1–2 кадра телепортирует скелет:
 * фаззинг случайными кадрами складывал из таких скачков «повторы». Живой человек за кадр не сдвигается
 * на полкорпуса и не меняет размер в полтора раза — такие кадры не считаем. Если «скачок» держится
 * дольше settleMs, это новое положение (или другой человек) — принимаем его.
 */
export class PoseGate {
  private last: (Body & { t: number }) | null = null;
  private rejectedSince: number | null = null;

  constructor(private readonly cfg: Widen<typeof ENGINE_CONFIG.person> = ENGINE_CONFIG.person) {}

  accept(points: readonly Landmark[], tMs: number): boolean {
    const b = bodyOf(points);
    if (!b || !Number.isFinite(b.x) || !Number.isFinite(b.y) || !Number.isFinite(b.size)) return false;
    const last = this.last;
    if (last) {
      const dt = Math.max(0, tMs - last.t) / 1000;
      const shift = Math.hypot(b.x - last.x, b.y - last.y) / last.size;
      const grow = b.size / last.size;
      const jump =
        shift > this.cfg.maxShiftPerSec * dt + this.cfg.shiftSlack ||
        grow > this.cfg.maxGrow ||
        grow < 1 / this.cfg.maxGrow;
      if (jump) {
        this.rejectedSince ??= tMs;
        if (tMs - this.rejectedSince < this.cfg.settleMs) return false;
      }
    }
    this.rejectedSince = null;
    this.last = { ...b, t: tMs };
    return true;
  }

  reset(): void {
    this.last = null;
    this.rejectedSince = null;
  }
}
