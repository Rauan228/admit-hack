// Выпады (E-12): переднее колено ~90°, заднее опускается к полу. Измеритель видит каждый выпад любой ногой;
// повтор засчитывает сессия — парой: правая нога вперёд + левая нога вперёд (sideOf, событие half_rep).
//
// Глубину меряем по заднему колену: насколько оно опустилось к уровню щиколотки.
// Отношение «вертикаль голени / вертикаль бедра» для каждой ноги, делённое на то же отношение стоя:
// 1 — стоя, 0 — колено на уровне щиколотки. У задней ноги оно падает к нулю и ниже, у передней —
// растёт (бедро горизонтально, знаменатель → 0), поэтому задняя нога — та, у которой оно меньше.
// В приседе у обеих ног бедро горизонтально — выпадом это не считается; наклон за предметом сгибает
// обе ноги одинаково — тоже (множитель «ноги врозь»).

import { ENGINE_CONFIG, type Widen } from '../config';
import { RAD_TO_DEG, clamp, isVisible, pt, type PoseFrame, type Vec3 } from '../geometry';
import { LM } from '../hints';
import type { RuleDef } from '../rules';
import type { Phase } from '../types';
import { SlidingQuantile } from './baseline';
import type { BaseMetrics, ExerciseDef, ExerciseMeter } from './types';

type LungeConfig = Widen<typeof ENGINE_CONFIG.exercises.lunge>;
type Side = 'left' | 'right';

const LEG = {
  left: { hip: LM.leftHip, knee: LM.leftKnee, ankle: LM.leftAnkle, heel: 29, toe: LM.leftFootIndex },
  right: { hip: LM.rightHip, knee: LM.rightKnee, ankle: LM.rightAnkle, heel: 30, toe: LM.rightFootIndex },
} as const;

export interface LungeMetrics extends BaseMetrics {
  /** Высота колена над щиколоткой относительно стоя: 1 — стоя, 0 — колено у пола (по каждой ноге). */
  kneeL: number | null;
  kneeR: number | null;
  /** Задняя нога — та, чьё колено ниже. */
  back: Side | null;
  /** Насколько колено передней ноги впереди носка, метры (3D); null — не измерить. */
  kneeAheadOfToe: number | null;
  /** Наклон корпуса от вертикали, градусы. */
  lean: number | null;
}

/** Бедро короче этой доли кадра по вертикали — горизонтально, отношение не определено. */
const MIN_THIGH = 0.01;

class LungeMeter implements ExerciseMeter<LungeMetrics> {
  private readonly base: Record<Side, SlidingQuantile>;
  /** Последний замер внизу выпада — держим его, пока передняя нога внизу, а задняя не видна. */
  private lastLow: LungeMetrics | null = null;

  constructor(private readonly cfg: LungeConfig) {
    // Медиана, а не максимум: в силуэте против света отношение стоя скачет 0,9…1,4, и максимум завышал эталон.
    this.base = {
      left: new SlidingQuantile(cfg.baselineWindowMs, 0.5),
      right: new SlidingQuantile(cfg.baselineWindowMs, 0.5),
    };
  }

  measure(frame: PoseFrame, phase: Phase): LungeMetrics | null {
    const knee = (side: Side): number | null => {
      const { hip, knee: k, ankle } = LEG[side];
      if (![hip, k, ankle].every((i) => isVisible(frame.image[i], 0.5, 0.05))) return null;
      const thighV = pt(frame, k).y - pt(frame, hip).y;
      // Бедро горизонтально (передняя нога внизу выпада) — колено точно не у пола.
      if (thighV < MIN_THIGH) return Infinity;
      const ratio = (pt(frame, ankle).y - pt(frame, k).y) / thighV;
      const base = this.base[side];
      // Эталон «стоя» — только когда бедро почти вертикально (по 3D-точкам). Иначе выброс при наклоне
      // (рывок гири: бедро почти горизонтально, отношение 3–10) попадал в эталон, обычная стойка
      // выглядела полувыпадом, и счётчик застревал на десятки секунд (реальная запись).
      const upright = this.thighUpright(frame, side);
      if ((phase === 'start' && upright !== false) || base.value === null) base.push(ratio, frame.t);
      else base.expire(frame.t);
      const standing = base.value;
      return standing && standing > 0 ? ratio / standing : null;
    };
    const kneeL = knee('left');
    const kneeR = knee('right');
    if (kneeL === null && kneeR === null) return null;
    if (kneeL === Infinity && kneeR === Infinity) {
      // Обе ноги с горизонтальным бедром — это присед, а не выпад: прогресс 0.
      return {
        progress: 0,
        kneeL: null,
        kneeR: null,
        back: null,
        kneeAheadOfToe: null,
        lean: this.lean(frame),
      };
    }
    // Одна нога не видна (заднее колено у пола в силуэте то видно, то нет). По оставшейся считаем,
    // только если она сама — явно заднее колено у пола. Иначе это «не знаю», а не «встал»: раньше
    // прогресс считался по одной передней ноге, выходил «встал», и выпад рвался на куски.
    if (kneeL === null || kneeR === null) {
      const seen = (kneeL ?? kneeR) as number;
      // Передняя нога внизу выпада (бедро горизонтально), задняя в тени или за передней: человек держит
      // низ выпада (реальная запись: удержание 11 и 13 с с гирей над головой, задняя щиколотка видна на 0,2–0,4).
      // Держим прошлый замер внизу — иначе «не видно ног» 10 с, пауза «встань целиком» и сброс выпада.
      if (seen === Infinity && phase !== 'start' && this.lastLow)
        return { ...this.lastLow, lean: this.lean(frame) };
      if (!(seen <= this.cfg.oneLegMaxRatio)) return null;
    }
    const l = kneeL ?? Infinity;
    const r = kneeR ?? Infinity;
    const lowest = Math.min(l, r);
    const other = Math.max(l, r);
    // Выпад — это ноги врозь: заднее колено у пола, у передней ноги бедро почти горизонтально.
    // Наклон за гирей или полуприсед сгибают обе ноги одинаково — такое движение выпадом не считаем.
    const split = clamp((other - lowest) / this.cfg.splitSpan, 0, 1);
    const back: Side = l <= r ? 'left' : 'right';
    const m: LungeMetrics = {
      progress: clamp(((1 - lowest) / (1 - this.cfg.kneeDownRatio)) * split, -0.5, 2),
      kneeL: finite(kneeL),
      kneeR: finite(kneeR),
      back,
      kneeAheadOfToe: this.kneeAhead(frame, back === 'left' ? 'right' : 'left'),
      lean: this.lean(frame),
    };
    this.lastLow =
      phase !== 'start' && m.progress >= this.cfg.fsm.downMin ? m : phase === 'start' ? null : this.lastLow;
    return m;
  }

  reset(): void {
    this.base.left.reset();
    this.base.right.reset();
    this.lastLow = null;
  }

  /** Бедро почти вертикально (по 3D-точкам): true/false, null — 3D-точек нет. */
  private thighUpright(frame: PoseFrame, side: Side): boolean | null {
    const h = frame.world?.[LEG[side].hip];
    const k = frame.world?.[LEG[side].knee];
    if (!h || !k) return null;
    const v = { x: k.x - h.x, y: k.y - h.y, z: k.z - h.z };
    const n = Math.hypot(v.x, v.y, v.z);
    // Мировая ось y смотрит вниз: у вертикального бедра колено прямо под тазом.
    return n > 0 && Math.acos(clamp(v.y / n, -1, 1)) * RAD_TO_DEG < this.cfg.uprightThighDeg;
  }

  /**
   * Колено передней ноги относительно носка вдоль направления стопы (пятка → носок), в метрах, по 3D-точкам.
   * Так мера одна и та же анфас (стопа смотрит на камеру) и сбоку.
   */
  private kneeAhead(frame: PoseFrame, front: Side): number | null {
    const w = frame.world;
    const { knee, heel, toe } = LEG[front];
    const k = w?.[knee];
    const h = w?.[heel];
    const t = w?.[toe];
    if (!k || !h || !t) return null;
    const fx = t.x - h.x;
    const fz = t.z - h.z;
    const n = Math.hypot(fx, fz);
    if (n < 0.05) return null; // стопа почти вертикальна в проекции — направление не определить
    return ((k.x - t.x) * fx + (k.z - t.z) * fz) / n;
  }

  private lean(frame: PoseFrame): number | null {
    const w = frame.world;
    const pts = [LM.leftShoulder, LM.rightShoulder, LM.leftHip, LM.rightHip].map((i) => w?.[i]);
    if (!pts.every(Boolean)) return null;
    const [sl, sr, hl, hr] = pts as [Vec3, Vec3, Vec3, Vec3];
    const up = { x: sl.x + sr.x - hl.x - hr.x, y: sl.y + sr.y - hl.y - hr.y, z: sl.z + sr.z - hl.z - hr.z };
    const n = Math.hypot(up.x, up.y, up.z);
    return n > 0 ? Math.acos(clamp(-up.y / n, -1, 1)) * RAD_TO_DEG : null;
  }
}

const finite = (v: number | null): number | null => (v !== null && Number.isFinite(v) ? v : null);

export function lungeRules(cfg: LungeConfig = ENGINE_CONFIG.exercises.lunge): RuleDef<LungeMetrics>[] {
  return [
    {
      code: 'knee_past_toe',
      kind: 'rep',
      // По самой глубокой точке повтора (atBottom), проверка — когда повтор закончен.
      on: ['rep'],
      check: (c) => {
        const m = c.atBottom;
        if (m.kneeAheadOfToe === null || m.kneeAheadOfToe <= cfg.kneePastToeM || !m.back) return null;
        const front = m.back === 'left' ? LEG.right : LEG.left;
        return { joints: [front.knee, front.toe] };
      },
    },
    {
      code: 'back_knee_high',
      kind: 'rep',
      // По итогу повтора: неглубокая «примерка» в начале не должна записывать ошибку в выпад до пола.
      on: ['rep', 'attempt'],
      check: (c) => {
        if (c.summary.pMax >= cfg.goodDepthProgress) return null;
        const back = c.atBottom.back;
        return back ? { joints: [LEG[back].knee] } : {};
      },
    },
    {
      code: 'torso_lean',
      kind: 'frame',
      check: (m) => (m.lean !== null && m.lean > cfg.maxLeanDeg ? {} : null),
    },
  ];
}

export function createLunge(cfg: LungeConfig = ENGINE_CONFIG.exercises.lunge): ExerciseDef<LungeMetrics> {
  return {
    id: 'lunge',
    requiredJoints: [LM.leftHip, LM.rightHip, LM.leftKnee, LM.rightKnee, LM.leftAnkle, LM.rightAnkle],
    armsOverhead: false,
    fsm: cfg.fsm,
    createMeter: () => new LungeMeter(cfg),
    rules: lungeRules(cfg),
    // Выпад «правой ногой» — правая нога впереди, то есть сзади левая.
    sideOf: (m) => (m.back ? (m.back === 'left' ? 'right' : 'left') : null),
  };
}
