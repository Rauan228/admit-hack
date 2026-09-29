// Отжимания и планка (E-22): человек боком к камере в упоре лёжа.
//
// Сбоку всё нужное лежит в плоскости кадра: угол в локте и линия тела — честные 2D-углы. Берём ближнюю
// к камере сторону (у неё выше видимость). «В упоре» — линия плечи → щиколотки близка к горизонтали:
// стоя, на коленях или сидя упражнение не считается. Таз — смещение от линии плечи → щиколотки к полу
// (провис) или вверх («домик»), в долях длины этой линии.

import { ENGINE_CONFIG, type Widen } from '../config';
import { RAD_TO_DEG, clamp, pt, type PoseFrame } from '../geometry';
import { LM } from '../hints';
import type { RuleDef } from '../rules';
import type { Side } from '../types';
import { ARM, LEG, joint2 } from './common';
import type { BaseMetrics, ExerciseDef, ExerciseMeter } from './types';

type PushUpConfig = Widen<typeof ENGINE_CONFIG.exercises.push_up>;
type PlankConfig = Widen<typeof ENGINE_CONFIG.exercises.plank>;

export interface FloorMetrics extends BaseMetrics {
  /** Ближняя к камере сторона. */
  side: Side;
  /** Линия тела в упоре (плечи → щиколотки почти горизонтальны). */
  inPlank: boolean;
  /** Угол в локте, градусы (180 — прямая рука; null — не видно). */
  elbow: number | null;
  /** Таз от линии плечи → щиколотки: + к полу (провис), − вверх; в долях длины линии. */
  hipOffset: number | null;
}

/** Поза в упоре лёжа сбоку: сторона, горизонтальность тела, локоть, таз. null — не видно плеча, таза или стопы. */
export function floorPose(frame: PoseFrame, maxBodyDeg: number): Omit<FloorMetrics, 'progress'> | null {
  const vis = (i: number) => frame.image[i]?.v ?? 0;
  const score = (side: Side) =>
    vis(ARM[side].shoulder) +
    vis(ARM[side].elbow) +
    vis(ARM[side].wrist) +
    vis(LEG[side].hip) +
    vis(LEG[side].ankle);
  const side: Side = score('left') >= score('right') ? 'left' : 'right';
  const { shoulder: sI, elbow: eI, wrist: wI } = ARM[side];
  const { hip: hI, ankle: aI } = LEG[side];
  if ([sI, hI, aI].some((i) => vis(i) < 0.4)) return null;
  const sh = pt(frame, sI);
  const hip = pt(frame, hI);
  const ankle = pt(frame, aI);
  const lx = ankle.x - sh.x;
  const ly = ankle.y - sh.y;
  const len = Math.hypot(lx, ly);
  if (!(len > 0)) return null;
  // Угол линии тела от горизонтали (голова слева или справа — неважно).
  const bodyDeg = Math.abs(Math.atan2(ly, Math.abs(lx))) * RAD_TO_DEG;
  const inPlank = bodyDeg <= maxBodyDeg;
  // Нормаль к линии тела, направленная к полу (+y).
  let nx = -ly / len;
  let ny = lx / len;
  if (ny < 0) {
    nx = -nx;
    ny = -ny;
  }
  const hipOffset = ((hip.x - sh.x) * nx + (hip.y - sh.y) * ny) / len;
  return { side, inPlank, elbow: joint2(frame, sI, eI, wI, 0.3), hipOffset };
}

class PushUpMeter implements ExerciseMeter<FloorMetrics> {
  constructor(private readonly cfg: PushUpConfig) {}

  measure(frame: PoseFrame): FloorMetrics | null {
    const pose = floorPose(frame, this.cfg.maxBodyDeg);
    if (!pose) return null;
    // Не в упоре (встал, сел) — прогресс 0, а не «потерялся»: иначе при подготовке была бы пауза.
    const progress =
      pose.inPlank && pose.elbow !== null
        ? clamp((this.cfg.straightDeg - pose.elbow) / (this.cfg.straightDeg - this.cfg.bottomDeg), -0.3, 1.5)
        : 0;
    return { progress, ...pose };
  }

  reset(): void {}
}

class PlankMeter implements ExerciseMeter<FloorMetrics> {
  constructor(private readonly cfg: PlankConfig) {}

  measure(frame: PoseFrame): FloorMetrics | null {
    const pose = floorPose(frame, this.cfg.maxBodyDeg);
    if (!pose) return null;
    return { progress: pose.inPlank ? 1 : 0, ...pose };
  }

  reset(): void {}
}

/** Таз провис или поднят «домиком» — общие правила упора лёжа. */
function hipRules(cfg: { maxSag: number; maxPike: number }): RuleDef<FloorMetrics>[] {
  return [
    {
      code: 'hips_sag',
      kind: 'frame',
      check: (m) =>
        m.inPlank && m.hipOffset !== null && m.hipOffset > cfg.maxSag ? { joints: [LEG[m.side].hip] } : null,
    },
    {
      code: 'hips_high',
      kind: 'frame',
      check: (m) =>
        m.inPlank && m.hipOffset !== null && m.hipOffset < -cfg.maxPike
          ? { joints: [LEG[m.side].hip] }
          : null,
    },
  ];
}

export function pushUpRules(cfg: PushUpConfig = ENGINE_CONFIG.exercises.push_up): RuleDef<FloorMetrics>[] {
  return [
    {
      code: 'shallow_pushup',
      kind: 'rep',
      on: ['rep', 'attempt'],
      check: (c) => (c.summary.pMax < cfg.goodProgress ? { joints: [ARM[c.atBottom.side].elbow] } : null),
    },
    ...hipRules(cfg),
  ];
}

export function plankRules(cfg: PlankConfig = ENGINE_CONFIG.exercises.plank): RuleDef<FloorMetrics>[] {
  return hipRules(cfg);
}

const FLOOR_JOINTS = [
  LM.leftShoulder,
  LM.rightShoulder,
  LM.leftHip,
  LM.rightHip,
  LM.leftAnkle,
  LM.rightAnkle,
];

export function createPushUp(cfg: PushUpConfig = ENGINE_CONFIG.exercises.push_up): ExerciseDef<FloorMetrics> {
  return {
    id: 'push_up',
    requiredJoints: FLOOR_JOINTS,
    armsOverhead: false,
    fsm: cfg.fsm,
    createMeter: () => new PushUpMeter(cfg),
    rules: pushUpRules(cfg),
  };
}

export function createPlank(cfg: PlankConfig = ENGINE_CONFIG.exercises.plank): ExerciseDef<FloorMetrics> {
  return {
    id: 'plank',
    requiredJoints: FLOOR_JOINTS,
    armsOverhead: false,
    // Пороги счётчика планке не нужны (повтор — секунда), но тип их требует.
    fsm: ENGINE_CONFIG.exercises.push_up.fsm,
    createMeter: () => new PlankMeter(cfg),
    rules: plankRules(cfg),
    hold: true,
  };
}
