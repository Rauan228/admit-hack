// Бег на месте с высоким подниманием колен (E-22): колено до уровня пояса, корпус прямо.
//
// Подъём колена меряем по вертикали «таз → колено»: анфас бедро уходит на камеру, и видно только, насколько
// колено поднялось к тазу. Вертикаль делим на длину корпуса стоя — мера не зависит от расстояния до камеры.
// Эталон «стоя» — скользящий максимум вертикали за несколько секунд: каждая нога половину времени на полу,
// поэтому максимум — это нога стоя, даже если человек ни разу не остановился.
//
// Прогресс — разница подъёма левого и правого колена. При смене ног она проходит через 0, поэтому каждый
// подъём колена — отдельный повтор даже в быстром темпе, когда обе ноги ни на миг не стоят вместе.

import { ENGINE_CONFIG, type Widen } from '../config';
import { RAD_TO_DEG, clamp, isVisible, mid2, pt, torsoLength, type PoseFrame } from '../geometry';
import { LM } from '../hints';
import type { RuleDef } from '../rules';
import type { Side } from '../types';
import { SlidingQuantile } from './baseline';
import type { BaseMetrics, ExerciseDef, ExerciseMeter } from './types';

type HighKneesConfig = Widen<typeof ENGINE_CONFIG.exercises.high_knees>;

/** Эталон «стоя» — такой верхний квантиль окна. */
const REST_Q = 0.9;
/** Плечи выше таза хотя бы на такую долю корпуса: человек стоит (наклон до ~60°). */
const UPRIGHT = 0.5;

const LEGS = {
  left: { hip: LM.leftHip, knee: LM.leftKnee },
  right: { hip: LM.rightHip, knee: LM.rightKnee },
} as const;

/**
 * Подъём колен: 0 — нога стоит, 1 — колено на уровне таза. Общий для «высоких коленей» и «локтя к колену».
 * Корпус стоя — единица длины: наклон и скручивание корпус укорачивают, эталон — нет. Эталоны — верхние
 * квантили за окно, а не максимумы: один выброс модели не должен раздувать «стоя» (как у выпадов).
 */
export class KneeLift {
  private readonly gap: Record<Side, SlidingQuantile>;
  private readonly torso: SlidingQuantile;

  constructor(windowMs: number) {
    this.gap = { left: new SlidingQuantile(windowMs, REST_Q), right: new SlidingQuantile(windowMs, REST_Q) };
    this.torso = new SlidingQuantile(windowMs, REST_Q);
  }

  /**
   * Подъём каждого колена (null — не видно) и длина корпуса стоя в координатах кадра.
   * Человек не стоит (плечи не над тазом) — кадр не меряем: это не бег и не скручивание, а сбой модели или пол.
   */
  measure(frame: PoseFrame): { liftL: number | null; liftR: number | null; torso: number | null } {
    const none = { liftL: null, liftR: null, torso: null };
    const trunk = [LM.leftShoulder, LM.rightShoulder, LM.leftHip, LM.rightHip];
    if (!trunk.every((i) => isVisible(frame.image[i], 0.5, 0.05))) return none;
    const now = torsoLength(frame);
    const rise =
      mid2(pt(frame, LM.leftHip), pt(frame, LM.rightHip)).y -
      mid2(pt(frame, LM.leftShoulder), pt(frame, LM.rightShoulder)).y;
    if (!(now > 0) || rise < UPRIGHT * now) return none;
    this.torso.push(now, frame.t);
    const torso = this.torso.value;
    if (!torso) return none;
    const lift = (side: Side): number | null => {
      const { hip, knee } = LEGS[side];
      if (!isVisible(frame.image[hip], 0.5, 0.05) || !isVisible(frame.image[knee], 0.5, 0.05)) return null;
      const g = (pt(frame, knee).y - pt(frame, hip).y) / torso;
      this.gap[side].push(g, frame.t);
      const rest = this.gap[side].value;
      return rest && rest > 0 ? clamp(1 - g / rest, -0.3, 1.5) : null;
    };
    return { liftL: lift('left'), liftR: lift('right'), torso };
  }

  reset(): void {
    this.gap.left.reset();
    this.gap.right.reset();
    this.torso.reset();
  }
}

export interface HighKneesMetrics extends BaseMetrics {
  /** Подъём колена: 0 — нога стоит, 1 — колено на уровне таза (null — не видно). */
  liftL: number | null;
  liftR: number | null;
  /** Какое колено сейчас выше. */
  side: Side | null;
  /** Отклонение корпуса назад, градусы (по 3D-точкам; минус — наклон вперёд); null — не измерить. */
  leanBack: number | null;
}

/** Наклон корпуса в плоскости «вперёд-назад» по мировым 3D-точкам: + назад, − вперёд. */
export function leanBackDeg(frame: PoseFrame): number | null {
  const w = frame.world;
  const [sl, sr, hl, hr] = [LM.leftShoulder, LM.rightShoulder, LM.leftHip, LM.rightHip].map((i) => w?.[i]);
  if (!sl || !sr || !hl || !hr) return null;
  // Мировая ось y у MediaPipe смотрит вниз, z — от камеры: отклонился назад — плечи дальше таза.
  const up = { y: (sl.y + sr.y - hl.y - hr.y) / 2, z: (sl.z + sr.z - hl.z - hr.z) / 2 };
  if (!(Math.hypot(up.y, up.z) > 0)) return null;
  return Math.atan2(up.z, -up.y) * RAD_TO_DEG;
}

class HighKneesMeter implements ExerciseMeter<HighKneesMetrics> {
  private readonly knees: KneeLift;

  constructor(cfg: HighKneesConfig) {
    this.knees = new KneeLift(cfg.baselineWindowMs);
  }

  measure(frame: PoseFrame): HighKneesMetrics | null {
    const { liftL, liftR } = this.knees.measure(frame);
    if (liftL === null && liftR === null) return null;
    // Видно одно колено — вторая нога считается стоящей (прогресс — подъём видимого).
    const progress =
      liftL !== null && liftR !== null ? Math.abs(liftL - liftR) : Math.max(0, (liftL ?? liftR) as number);
    const side: Side =
      liftL !== null && liftR !== null
        ? liftL >= liftR
          ? 'left'
          : 'right'
        : liftL !== null
          ? 'left'
          : 'right';
    return { progress, liftL, liftR, side, leanBack: leanBackDeg(frame) };
  }

  reset(): void {
    this.knees.reset();
  }
}

/** Наибольший подъём колена side за движение. */
export function maxLift(
  frames: readonly { liftL: number | null; liftR: number | null }[],
  side: Side,
): number {
  return Math.max(-Infinity, ...frames.map((m) => (side === 'left' ? m.liftL : m.liftR) ?? -Infinity));
}

export function highKneesRules(
  cfg: HighKneesConfig = ENGINE_CONFIG.exercises.high_knees,
): RuleDef<HighKneesMetrics>[] {
  return [
    {
      code: 'knees_low',
      kind: 'rep',
      // И на засчитанном повторе, и на «пробежке» с низкими коленями, которая повтором не стала.
      on: ['rep', 'attempt'],
      check: (c) => {
        const side = c.atBottom.side;
        if (!side || maxLift(c.frames, side) >= cfg.goodLift) return null;
        return { joints: [LEGS[side].knee] };
      },
    },
    {
      code: 'lean_back',
      kind: 'frame',
      // Короткий отклон на толчке ногой — не ошибка; держится 0,3 с — уже манера бега.
      holdMs: 300,
      check: (m) => (m.leanBack !== null && m.leanBack > cfg.maxLeanBackDeg ? {} : null),
    },
  ];
}

export function createHighKnees(
  cfg: HighKneesConfig = ENGINE_CONFIG.exercises.high_knees,
): ExerciseDef<HighKneesMetrics> {
  return {
    id: 'high_knees',
    requiredJoints: [LM.leftHip, LM.rightHip, LM.leftKnee, LM.rightKnee],
    armsOverhead: false,
    fsm: cfg.fsm,
    createMeter: () => new HighKneesMeter(cfg),
    rules: highKneesRules(cfg),
  };
}
