// Удары для боя от первого лица: событие «левая/правая ударила» в начале удара, а не после возврата руки
// (движок бокса засчитывает повтор, когда рука вернулась, — ~0,3 с позже, и путает руку).
//
// Подобрано на размеченных записях боя с тенью (tests/fixtures/fpv, разметка по раскадровке 0,1 с: 34 удара
// в трёх записях) и проверено на записях движка (tests/fixtures/boxing-*): на размеченных — 76 % ударов
// найдено, 81 % срабатываний — настоящие удары, рука верная; задержка от начала удара ~0,1 с.
//
// Признак удара по каждой руке — больший из двух:
// - вынос кисти от её места в стойке (в ширинах плеч, относительно середины плеч — нырок корпусом не удар);
//   место в стойке догоняет кисть, только пока она почти не движется;
// - подъём локтя к линии плеч от его уровня в стойке (прямой и боковой в камеру).
// Удар — признак дошёл до порога, кисть движется быстро и сильнее второй руки (при ударе одной рукой
// вторая тоже сдвигается — разворот корпуса). После удара рука снова «взводится», когда признак упал.
//
// Удар или мах (U-27): срабатывание — в начале движения (перчатка на экране летит сразу), а урон страница
// засчитывает к касанию, спросив confirm(). Мах руками тоже выносит кисть быстро — но иначе: кисть уходит
// выше головы или ниже пояса, вторая рука отлетает вбок (машут обеими), рука стартует опущенной. Пороги —
// по записям: размеченные удары находятся как раньше (≥ 70 %, точность ≥ 75 %), а на кругах руками,
// «звёздочке», выпадах, наклонах, жиме, подтягиваниях и бёрпи «ударов» 31 вместо 267 (круги руками — 4 из 21).

import type { Landmark } from '../engine/types';
import type { GloveSide } from './gloves';

export const PUNCH = {
  minVisibility: 0.3,
  /** Вынос кисти от места в стойке до удара, ширин плеч. */
  fullDisp: 1.0,
  /** Подъём локтя для удара (доля пути от стойки до линии плеч). */
  fullLift: 0.9,
  /** Скорость кисти (ширин плеч в секунду) не меньше — медленное движение не удар. */
  minSpeed: 1.5,
  speedTauMs: 100,
  /** Кисть «стоит» медленнее этого — место в стойке догоняет её. */
  stillSpeed: 1.5,
  anchorTauMs: 600,
  /** Локоть: уровень стойки вниз догоняет за, вверх — за (мс), пределы и уровень удара. */
  elbowDownTauMs: 300,
  elbowUpTauMs: 4000,
  elbowGuardMin: 0.6,
  elbowGuardMax: 1.5,
  elbowPunch: 0.2,
  /** Удар этой руки, только если её признак сильнее второй руки во столько раз. */
  dominance: 1.3,
  /** После удара одной рукой вторая не бьёт столько мс (её сдвиг — разворот корпуса). */
  otherHandMs: 300,
  /** Снова взвести руку: признак ниже доли порога и прошло столько мс. */
  rearm: 0.6,
  minGapMs: 250,
  /** Кисть ниже плеч больше чем на / выше чем на (ширин плеч) — не удар. */
  maxDrop: 1.0,
  maxRise: 1.4,
  /** Проверка «удар, а не мах» — по кадрам до стольких мс после начала (касание — через 110). */
  confirmMs: 130,
  /** За это время кисть не выше линии плеч больше чем на / не ниже чем на (ширин плеч). */
  swingMaxRise: 0.8,
  swingMaxDrop: 1.3,
  /** Вторая рука не дальше от середины плеч (ширин плеч) — иначе машут обеими. */
  otherMaxOut: 1.8,
  /** До удара (0,2–0,5 с) кисть не ниже линии плеч больше чем на — удар идёт от стойки, а не от бедра. */
  startMaxDrop: 2.4,
} as const;

export interface PunchEvent {
  side: GloveSide;
  t: number;
  /** Кисть ниже линии плеч в момент удара — удар в корпус. */
  low: boolean;
  /** Кисть шла больше вбок, чем вверх-вниз, и локоть поднят — боковой. */
  hook: boolean;
}

/** Удар после срабатывания: что делали руки до касания (для confirm). */
interface Pending {
  t: number;
  minY: number;
  maxY: number;
  otherOut: number;
  startY: number;
}

interface Arm {
  /** Последние полсекунды кисти (для старта удара). */
  trail: { t: number; y: number }[];
  /** Последние срабатывания и их проверка «удар или мах». */
  pending: Pending[];
  prev: { x: number; y: number } | null;
  anchor: { x: number; y: number } | null;
  speed: number;
  elbow0: number | null;
  armed: boolean;
  since: number;
  score: number;
  lastT: number | null;
}

const ARM = {
  left: { shoulder: 11, elbow: 13, wrist: 15 },
  right: { shoulder: 12, elbow: 14, wrist: 16 },
} as const;

const fresh = (): Arm => ({
  trail: [],
  pending: [],
  prev: null,
  anchor: null,
  speed: 0,
  elbow0: null,
  armed: true,
  since: -Infinity,
  score: 0,
  lastT: null,
});

export class PunchDetector {
  private readonly arms: Record<GloveSide, Arm> = { left: fresh(), right: fresh() };

  /** Кадр позы → удары, начавшиеся в этом кадре (обычно ни одного). */
  update(lms: readonly Landmark[], t: number, aspect = 16 / 9): PunchEvent[] {
    const ls = lms[11];
    const rs = lms[12];
    if (!seen(ls) || !seen(rs)) return [];
    const sw = Math.hypot((ls.x - rs.x) * aspect, ls.y - rs.y);
    if (!(sw > 0)) return [];
    const mx = ((ls.x + rs.x) / 2) * aspect;
    const my = (ls.y + rs.y) / 2;
    const out: PunchEvent[] = [];
    for (const side of ['left', 'right'] as const) {
      const ev = this.arm(side, lms, t, aspect, sw, mx, my);
      if (ev) out.push(ev);
    }
    return out;
  }

  reset(): void {
    this.arms.left = fresh();
    this.arms.right = fresh();
  }

  /**
   * Удар, начатый в t (событие update), — настоящий, а не мах руками. Спрашивать к касанию: решение — по кадрам
   * до t + confirmMs. Неизвестное срабатывание — false.
   */
  confirm(side: GloveSide, t: number): boolean {
    const p = this.arms[side].pending.find((q) => q.t === t);
    if (!p) return false;
    return (
      p.minY >= -PUNCH.swingMaxRise &&
      p.maxY <= PUNCH.swingMaxDrop &&
      p.otherOut <= PUNCH.otherMaxOut &&
      p.startY <= PUNCH.startMaxDrop
    );
  }

  private arm(
    side: GloveSide,
    lms: readonly Landmark[],
    t: number,
    aspect: number,
    sw: number,
    mx: number,
    my: number,
  ): PunchEvent | null {
    const a = this.arms[side];
    const other = this.arms[side === 'left' ? 'right' : 'left'];
    const { shoulder, elbow, wrist } = ARM[side];
    const w = lms[wrist];
    const s = lms[shoulder];
    const e = lms[elbow];
    if (!w || !s || !e) return null;
    const dt = a.lastT === null ? 0 : Math.max(0, t - a.lastT);
    a.lastT = t;
    const x = (w.x * aspect - mx) / sw;
    const y = (w.y - my) / sw;
    const drop = (e.y - s.y) / sw;
    // Удар или мах: копим, что делали руки до касания.
    const ow = lms[ARM[side === 'left' ? 'right' : 'left'].wrist];
    const oOut = ow ? Math.abs(ow.x * aspect - mx) / sw : 0;
    for (const p of a.pending) {
      if (t > p.t + PUNCH.confirmMs) continue;
      p.minY = Math.min(p.minY, y);
      p.maxY = Math.max(p.maxY, y);
      p.otherOut = Math.max(p.otherOut, oOut);
    }
    a.trail.push({ t, y });
    while (a.trail.length > 0 && a.trail[0]!.t < t - 500) a.trail.shift();
    if (!a.prev || !a.anchor || a.elbow0 === null) {
      a.prev = { x, y };
      a.anchor = { x, y };
      a.elbow0 = drop;
      return null;
    }
    const v = dt > 0 ? (Math.hypot(x - a.prev.x, y - a.prev.y) / dt) * 1000 : 0;
    a.speed += (v - a.speed) * ease(dt, PUNCH.speedTauMs);
    a.prev = { x, y };
    const disp = Math.hypot(x - a.anchor.x, y - a.anchor.y);
    a.elbow0 += (drop - a.elbow0) * ease(dt, drop > a.elbow0 ? PUNCH.elbowDownTauMs : PUNCH.elbowUpTauMs);
    const base = clamp(a.elbow0, PUNCH.elbowGuardMin, PUNCH.elbowGuardMax);
    const lift = (base - drop) / Math.max(0.4, base - PUNCH.elbowPunch);
    const atShoulders = y <= PUNCH.maxDrop && y >= -PUNCH.maxRise;
    const score = atShoulders ? Math.max(disp / PUNCH.fullDisp, lift / PUNCH.fullLift) : 0;
    a.score = score;
    // Место в стойке — за кистью, пока она почти не движется.
    if (a.speed < PUNCH.stillSpeed) {
      const k = ease(dt, PUNCH.anchorTauMs);
      a.anchor = { x: a.anchor.x + (x - a.anchor.x) * k, y: a.anchor.y + (y - a.anchor.y) * k };
    }
    const dominant = score >= PUNCH.dominance * other.score && t - other.since > PUNCH.otherHandMs;
    if (a.armed && score >= 1 && a.speed >= PUNCH.minSpeed && w.v >= PUNCH.minVisibility && dominant) {
      a.armed = false;
      a.since = t;
      const dx = Math.abs(x - a.anchor.x);
      const dy = Math.abs(y - a.anchor.y);
      // Откуда пошла рука: самая низкая кисть за 0,2–0,5 с до удара.
      const before = a.trail.filter((q) => q.t <= t - 200).map((q) => q.y);
      a.pending.push({
        t,
        minY: y,
        maxY: y,
        otherOut: oOut,
        startY: before.length ? Math.max(...before) : y,
      });
      if (a.pending.length > 64) a.pending.shift();
      return { side, t, low: y > 0.35, hook: dx > 1.4 * dy && lift > 0.6 };
    }
    if (!a.armed && score < PUNCH.rearm && t - a.since > PUNCH.minGapMs) a.armed = true;
    return null;
  }
}

function seen(p: Landmark | undefined): p is Landmark {
  return !!p && p.v >= 0.5;
}

const ease = (dt: number, tau: number) => (dt <= 0 ? 1 : 1 - Math.exp(-dt / tau));
const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
