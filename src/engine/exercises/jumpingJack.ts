// Прыжки «звёздочка» (E-11): руки над головой и ноги шире плеч одновременно → исходное положение.
//
// Прогресс — среднее двух половин: руки (запястье от уровня таза до положения над головой,
// в длинах корпуса) и ноги (расстояние между щиколотками относительно ширины плеч). Обе меры
// нормированы на размер самого человека, поэтому не зависят от расстояния до камеры.
// Прыжок только руками или только ногами даёт половину амплитуды: засчитывается с ошибкой.

import { ENGINE_CONFIG, type Widen } from '../config';
import {
  RAD_TO_DEG,
  angleFromVertical,
  clamp,
  isVisible,
  mid2,
  pt,
  torsoLength,
  type PoseFrame,
} from '../geometry';
import { LM } from '../hints';
import type { RuleDef } from '../rules';
import type { Joint, Phase } from '../types';
import { SlidingMin } from './baseline';
import type { BaseMetrics, ExerciseDef, ExerciseMeter } from './types';

type JackConfig = Widen<typeof ENGINE_CONFIG.exercises.jumping_jack>;

export interface JumpingJackMetrics extends BaseMetrics {
  /** Время кадра, мс: нужно, чтобы сравнить, когда руки и когда ноги прошли середину. */
  t: number;
  /** Руки: 0 — вдоль тела, 1 — над головой (по каждой; null — запястье не видно). */
  armL: number | null;
  armR: number | null;
  /** Руки в целом (среднее видимых). */
  arms: number | null;
  /** Ноги: 0 — вместе, 1 — шире плеч. */
  legs: number | null;
  /** Расстояние между щиколотками / ширина плеч. */
  stance: number | null;
}

class JumpingJackMeter implements ExerciseMeter<JumpingJackMetrics> {
  /**
   * Стойка в покое. Ноги меряем от неё, а не от абсолютного «ноги вместе»: кто стоит на ширине плеч,
   * иначе имел бы прогресс 0,25 в покое, счётчик никогда не вернулся бы в исходное положение,
   * и ни одна «звёздочка» не засчиталась бы.
   */
  private readonly restStance: SlidingMin;

  constructor(private readonly cfg: JackConfig) {
    this.restStance = new SlidingMin(cfg.baselineWindowMs);
  }

  measure(frame: PoseFrame, phase: Phase): JumpingJackMetrics | null {
    const shoulders = [LM.leftShoulder, LM.rightShoulder];
    const hips = [LM.leftHip, LM.rightHip];
    if (![...shoulders, ...hips].every((i) => isVisible(frame.image[i], 0.5, 0.05))) return null;
    // Бёрпи, наклон к полу — это не «звёздочка»: корпус должен быть вертикальным.
    if (this.leanDeg(frame) > this.cfg.maxUprightLeanDeg) return null;

    const torso = torsoLength(frame);
    if (!(torso > 0)) return null;
    const shoulderY = mid2(pt(frame, LM.leftShoulder), pt(frame, LM.rightShoulder)).y;
    const arm = (wrist: number): number | null => {
      // Руки над головой часто выходят за верхний край кадра — даём запас по краю.
      if (!isVisible(frame.image[wrist], 0.4, 0.15)) return null;
      const lift = shoulderY + this.cfg.armsDown * torso - pt(frame, wrist).y;
      return clamp(lift / (this.cfg.armsSpan * torso), -0.3, 1.4);
    };
    const armL = arm(LM.leftWrist);
    const armR = arm(LM.rightWrist);
    const arms = armL !== null && armR !== null ? (armL + armR) / 2 : (armL ?? armR);

    let legs: number | null = null;
    let stance: number | null = null;
    const anklesSeen =
      isVisible(frame.image[LM.leftAnkle], 0.5, 0.05) && isVisible(frame.image[LM.rightAnkle], 0.5, 0.05);
    if (anklesSeen && this.facesCamera(frame)) {
      const shoulderWidth = Math.abs(pt(frame, LM.leftShoulder).x - pt(frame, LM.rightShoulder).x);
      if (shoulderWidth > 0) {
        stance = Math.abs(pt(frame, LM.leftAnkle).x - pt(frame, LM.rightAnkle).x) / shoulderWidth;
        if (phase === 'start' || this.restStance.value === null) this.restStance.push(stance, frame.t);
        else this.restStance.expire(frame.t);
        // Стойка в покое, но не шире «вместе» по конфигу: широкая стойка не должна занижать амплитуду.
        const rest = Math.max(this.cfg.stanceClosed, this.restStance.value ?? this.cfg.stanceClosed);
        const span = Math.max(this.cfg.stanceOpen - rest, this.cfg.minStanceTravel);
        legs = clamp((stance - rest) / span, -0.3, 1.4);
      }
    }
    if (arms === null && legs === null) return null;
    const progress = arms !== null && legs !== null ? (arms + legs) / 2 : ((arms ?? legs) as number);
    return { progress, t: frame.t, armL, armR, arms, legs, stance };
  }

  reset(): void {
    this.restStance.reset();
  }

  /** Наклон корпуса: по 3D-точкам, если есть, иначе 2D-угол таз → плечи. */
  private leanDeg(frame: PoseFrame): number {
    const w = frame.world;
    const [sl, sr, hl, hr] = [LM.leftShoulder, LM.rightShoulder, LM.leftHip, LM.rightHip].map((i) => w?.[i]);
    if (sl && sr && hl && hr) {
      const up = { x: sl.x + sr.x - hl.x - hr.x, y: sl.y + sr.y - hl.y - hr.y, z: sl.z + sr.z - hl.z - hr.z };
      const n = Math.hypot(up.x, up.y, up.z);
      if (n > 0) return Math.acos(clamp(-up.y / n, -1, 1)) * RAD_TO_DEG;
    }
    const a = angleFromVertical(
      mid2(pt(frame, LM.leftHip), pt(frame, LM.rightHip)),
      mid2(pt(frame, LM.leftShoulder), pt(frame, LM.rightShoulder)),
    );
    return Number.isFinite(a) ? a : 0;
  }

  /** Анфас: боком расстояние между стопами в кадре не видно. */
  private facesCamera(frame: PoseFrame): boolean {
    const hl = frame.world?.[LM.leftHip];
    const hr = frame.world?.[LM.rightHip];
    if (!hl || !hr) return true;
    return Math.atan2(Math.abs(hl.z - hr.z), Math.abs(hl.x - hr.x)) * RAD_TO_DEG <= this.cfg.frontalMaxYawDeg;
  }
}

/** Когда сигнал впервые (или в последний раз) пересёк уровень level; null — не пересёк. */
function crossing(
  frames: JumpingJackMetrics[],
  pick: (m: JumpingJackMetrics) => number | null,
  level: number,
  last: boolean,
): number | null {
  const list = last ? [...frames].reverse() : frames;
  for (const m of list) {
    const v = pick(m);
    if (v !== null && v >= level) return m.t;
  }
  return null;
}

export function jumpingJackRules(
  cfg: JackConfig = ENGINE_CONFIG.exercises.jumping_jack,
): RuleDef<JumpingJackMetrics>[] {
  return [
    {
      code: 'arms_low',
      kind: 'rep',
      on: ['bottom', 'attempt'],
      check: (c) => {
        // Смотрим на нижнюю руку: одна рука над головой, другая у плеча — тоже ошибка.
        const best = (pick: (m: JumpingJackMetrics) => number | null) =>
          Math.max(-Infinity, ...c.frames.map((m) => pick(m) ?? -Infinity));
        const left = best((m) => m.armL);
        const right = best((m) => m.armR);
        if (!Number.isFinite(left) && !Number.isFinite(right)) return null;
        const lowL = Number.isFinite(left) && left < cfg.armsUpMin;
        const lowR = Number.isFinite(right) && right < cfg.armsUpMin;
        if (!lowL && !lowR) return null;
        const joints: Joint[] =
          lowL && !lowR ? [LM.leftWrist] : lowR && !lowL ? [LM.rightWrist] : [LM.leftWrist, LM.rightWrist];
        return { joints };
      },
    },
    {
      code: 'feet_narrow',
      kind: 'rep',
      on: ['bottom', 'attempt'],
      check: (c) => {
        const widest = Math.max(-Infinity, ...c.frames.map((m) => m.stance ?? -Infinity));
        return Number.isFinite(widest) && widest < cfg.feetMinRatio ? {} : null;
      },
    },
    {
      code: 'not_synced',
      kind: 'rep',
      on: ['rep'],
      check: (c) => {
        // Синхронность имеет смысл, только если обе части стартовали из исходного положения:
        // встал из бёрпи с уже расставленными ногами — это не «ноги отстали».
        const first = c.frames[0];
        if (!first || (first.arms ?? 0) > 0.3 || (first.legs ?? 0) > 0.3) return null;
        // Сравниваем, когда руки и ноги проходят середину амплитуды — на выходе и на возврате.
        const lags: number[] = [];
        for (const last of [false, true]) {
          const a = crossing(c.frames, (m) => m.arms, 0.5, last);
          const l = crossing(c.frames, (m) => m.legs, 0.5, last);
          if (a !== null && l !== null) lags.push(Math.abs(a - l));
        }
        return lags.some((lag) => lag > cfg.syncLagMs) ? {} : null;
      },
    },
  ];
}

export function createJumpingJack(
  cfg: JackConfig = ENGINE_CONFIG.exercises.jumping_jack,
): ExerciseDef<JumpingJackMetrics> {
  return {
    id: 'jumping_jack',
    requiredJoints: [LM.leftShoulder, LM.rightShoulder, LM.leftHip, LM.rightHip, LM.leftAnkle, LM.rightAnkle],
    // Руки над головой — само упражнение: жест «обе руки вверх» на подходе отключён.
    armsOverhead: true,
    fsm: cfg.fsm,
    createMeter: () => new JumpingJackMeter(cfg),
    rules: jumpingJackRules(cfg),
  };
}
