// Отжимания и планка (E-31): человек лицом к камере, телефон или ноутбук лежит на полу перед ним —
// как в дуэлях на отжиманиях (референс — запись RepChamp «Push Up Battle»).
//
// Спереди модель уверенно видит плечи, локти, кисти и таз; колени и стопы — далеко за телом, их почти
// не видно (видимость 0,1–0,4 на записи), поэтому они не нужны. Отжимание — два сигнала:
// - угол в локтях на картинке: вверху 160–180°, внизу 105–125° (локти уходят в стороны и назад);
// - насколько плечи опустились от своей верхней точки, в ширинах плеч. Камера на полу: и путь плеч,
//   и ширина плеч уменьшаются с расстоянием одинаково — доля не зависит от того, где лежит телефон.
// Прогресс — среднее двух сигналов; если они сильно расходятся (локоть смазан в движении) — по плечам.
// «В упоре»: кисти ниже плеч, корпус сжат перспективой, ног далеко внизу нет — стоя не считаем.

import { ENGINE_CONFIG, type Widen } from '../config';
import { clamp, pt, type PoseFrame } from '../geometry';
import { CALIBRATION_DETAIL_HINTS, LM } from '../hints';
import type { RuleDef } from '../rules';
import type { Side } from '../types';
import { SlidingQuantile } from './baseline';
import { ARM, LEG, OUTWARD, joint2 } from './common';
import type { BaseMetrics, ExerciseDef, ExerciseMeter } from './types';

type FloorConfig = Widen<typeof ENGINE_CONFIG.exercises.push_up>;

export interface FloorMetrics extends BaseMetrics {
  /** В упоре лёжа лицом к камере. */
  inPlank: boolean;
  /** Средний угол в локтях на картинке, градусы (180 — прямые руки; null — рук не видно). */
  elbow: number | null;
  /** Плечи ниже своей верхней точки, в ширинах плеч (null — не в упоре). */
  drop: number | null;
  /** Перекос: одно плечо ниже другого, в ширинах плеч. */
  tilt: number;
  /** Локти наружу от плеч, в ширинах плеч (больший из двух; null — локтей не видно). */
  elbowOut: number | null;
  /** Планка: в упоре, но лёг — руки согнуты, а кисти не вынесены вперёд, как на предплечьях (отдых на полу). */
  lowArms: boolean;
}

/** Что видно спереди в кадре: плечи, руки, признаки «стоит, а не в упоре». null — плеч не видно. */
export interface FrontPose {
  /** Середина плеч, x с поправкой на аспект. */
  shoulderX: number;
  /** Середина плеч, y (доли высоты кадра). */
  shoulderY: number;
  /** Ширина плеч с поправкой на аспект (доли высоты кадра). */
  shoulderWidth: number;
  /** Средний угол в локтях по видимым рукам. */
  elbow: number | null;
  /** Кисти ниже плеч на столько ширин плеч (минимум по видимым рукам; null — кистей не видно). */
  wristDrop: number | null;
  /** Стопы видны ниже самой нижней кисти на столько ширин плеч (null — стоп или кистей не видно). */
  feet: number | null;
  /** Одно плечо ниже другого, в ширинах плеч. */
  tilt: number;
  /** Локти наружу от плеч, в ширинах плеч (больший из двух; null — локтей не видно). */
  elbowOut: number | null;
}

const SIDES: Side[] = ['left', 'right'];

export function frontPose(frame: PoseFrame, minV = 0.5): FrontPose | null {
  const vis = (i: number) => frame.image[i]?.v ?? 0;
  if (vis(LM.leftShoulder) < minV || vis(LM.rightShoulder) < minV) return null;
  const ls = pt(frame, LM.leftShoulder);
  const rs = pt(frame, LM.rightShoulder);
  const shoulderWidth = Math.hypot(ls.x - rs.x, ls.y - rs.y);
  if (!(shoulderWidth > 0.01)) return null;
  const shoulderY = (ls.y + rs.y) / 2;
  const below = (i: number) => (pt(frame, i).y - shoulderY) / shoulderWidth;
  const arms = SIDES.filter((s) => vis(ARM[s].elbow) >= 0.3 && vis(ARM[s].wrist) >= 0.3);
  const angles = arms
    .map((s) => joint2(frame, ARM[s].shoulder, ARM[s].elbow, ARM[s].wrist, 0.3))
    .filter((a): a is number => a !== null);
  // Лицом к камере левое плечо человека — справа по картинке: «наружу» для него — +x.
  const outward = SIDES.filter((s) => vis(ARM[s].elbow) >= 0.3).map(
    (s) => (OUTWARD[s] * (pt(frame, ARM[s].elbow).x - pt(frame, ARM[s].shoulder).x)) / shoulderWidth,
  );
  const feet = SIDES.flatMap((s) => [LEG[s].ankle, LEG[s].heel, LEG[s].toe]).filter((i) => vis(i) >= minV);
  const lowestHand = arms.length ? Math.max(...arms.map((s) => pt(frame, ARM[s].wrist).y)) : null;
  return {
    shoulderX: (ls.x + rs.x) / 2,
    shoulderY,
    shoulderWidth,
    elbow: angles.length ? angles.reduce((a, b) => a + b, 0) / angles.length : null,
    wristDrop: arms.length ? Math.min(...arms.map((s) => below(ARM[s].wrist))) : null,
    feet:
      feet.length && lowestHand !== null
        ? Math.max(...feet.map((i) => (pt(frame, i).y - lowestHand) / shoulderWidth))
        : null,
    tilt: Math.abs(ls.y - rs.y) / shoulderWidth,
    elbowOut: outward.length ? Math.max(...outward) : null,
  };
}

/**
 * В упоре лёжа лицом к камере: кисти ниже плеч, и кисти — самое нижнее в кадре: ладони на полу ближе всего
 * к камере, стопы на полу дальше — на картинке выше. Стоя (и в приседе) стопы всегда ниже кистей.
 * Таз спереди закрыт телом, модели угадывают его по-разному — по нему не решаем.
 * scale — устойчивая ширина плеч (медиана за окно): в кадре она «дышит».
 */
export function inPushUpPosition(pose: FrontPose, scale: number, cfg: FloorConfig): boolean {
  const k = pose.shoulderWidth / scale;
  const wrist = pose.wristDrop === null ? null : pose.wristDrop * k;
  if (wrist === null || wrist < cfg.minWristDrop) return false;
  if (pose.feet !== null && pose.feet * k > cfg.maxFeetBelowHands) return false;
  return true;
}

class FloorMeter implements ExerciseMeter<FloorMetrics> {
  private readonly width: SlidingQuantile;
  private readonly top: SlidingQuantile;
  /** Последнее принятое положение плеч и с какого момента держится «скачок». */
  private last: { x: number; y: number; t: number } | null = null;
  private jumpSince: number | null = null;
  /** «В упоре» с удержанием: вошёл — признаки держатся enterMs, вышел — пропали на leaveMs. */
  private inPos = false;
  private switchSince: number | null = null;
  /** Планка: высота плеч (в ширинах плеч) за последние plankStillMs. */
  private recent: { t: number; y: number }[] = [];
  private rawSince: number | null = null;
  /** Руки «как в планке» — с гистерезисом: у границы (перекос плеч, шум) не мигает. */
  private armsOk = false;

  constructor(
    private readonly cfg: FloorConfig,
    private readonly hold: boolean,
  ) {
    this.width = new SlidingQuantile(cfg.windowMs, 0.5);
    // Верхняя точка плеч — нижний квантиль y (плечи выше всего), только в упоре.
    this.top = new SlidingQuantile(cfg.windowMs, 0.1);
  }

  measure(frame: PoseFrame): FloorMetrics | null {
    const pose = frontPose(frame);
    if (!pose) return null;
    this.width.push(pose.shoulderWidth, frame.t);
    const scale = this.width.value ?? pose.shoulderWidth;
    // Сбой модели спереди: плечи «схлопнулись» в точку (ширина падает в разы на 1–3 кадра) — угол локтя,
    // кисти и корпус в таком кадре мусорные. Кадр не мерим: счётчик держит фазу, а не ловит ложный «низ».
    const k0 = pose.shoulderWidth / scale;
    if (k0 < this.cfg.minWidthRatio || k0 > 1 / this.cfg.minWidthRatio) return null;
    if (!this.plausible(pose, scale, frame.t)) return null;
    // Перекос и локти — в устойчивых ширинах плеч (ширина в кадре «дышит»).
    const k = k0;
    const shape = {
      elbow: pose.elbow,
      tilt: pose.tilt * k,
      elbowOut: pose.elbowOut === null ? null : pose.elbowOut * k,
    };
    const raw = inPushUpPosition(pose, scale, this.cfg);
    // С какого момента упор виден непрерывно (для планки; считаем и до того, как сработало удержание).
    if (!raw) this.rawSince = null;
    else this.rawSince ??= frame.t;
    if (!this.position(raw, frame.t)) {
      // Не в упоре (встал, сел) — прогресс 0, а не «потерялся»: иначе при подготовке была бы пауза.
      return { progress: 0, inPlank: false, drop: null, lowArms: false, ...shape };
    }
    if (this.hold) {
      // Планка — неподвижное удержание: секунды идут, только пока упор виден прямо сейчас (без удержания на
      // выходе — иначе после «встал» натикало бы ещё до 1,5 с) и плечи почти не двигаются. Отжимания, бёрпи,
      // присед с гирями у голеней в секунды планки не превращаются.
      // Лёг на пол и замер — тоже «в упоре» (кисти под плечами, стопы не видны), но секунды не идут: планка —
      // либо на прямых руках, либо на предплечьях (локти ~90°, кисти вынесены далеко вперёд — на записях
      // они ниже плеч на 1,6–1,9 ширины плеч, а внизу отжимания и лёжа — не больше 1,05).
      const arms = this.plankArms(pose, k);
      const still = this.still(pose.shoulderY / scale, frame.t);
      // И упор держится непрерывно хотя бы plankStillMs: мимолётная поза, похожая на упор, — не планка.
      const held = raw && arms && still && frame.t - (this.rawSince ?? frame.t) >= this.cfg.plankStillMs;
      return { progress: held ? 1 : 0, inPlank: held, drop: null, lowArms: raw && !arms, ...shape };
    }
    this.top.push(pose.shoulderY, frame.t);
    const drop = (pose.shoulderY - (this.top.value ?? pose.shoulderY)) / scale;
    const byDrop = drop / this.cfg.dropBottom;
    const byElbow =
      pose.elbow === null
        ? null
        : (this.cfg.straightDeg - pose.elbow) / (this.cfg.straightDeg - this.cfg.bottomDeg);
    // Сигналы сильно расходятся — локоть смазан в движении или спутан с кистью: верим плечам,
    // их путь на записи чище (иначе ложная «середина» наверху склеивает два отжимания в одно).
    let progress =
      byElbow === null || Math.abs(byDrop - byElbow) > this.cfg.maxDisagree ? byDrop : (byDrop + byElbow) / 2;
    // Отжимание без сгибания локтей невозможно: плечи опускаются при прямых руках — это присед или сбой
    // модели, а не низ отжимания.
    if (byElbow !== null) progress = Math.min(progress, byElbow + this.cfg.elbowSlack);
    return { progress: clamp(progress, -0.3, 1.5), inPlank: true, drop, lowArms: false, ...shape };
  }

  /** Руки как в планке: прямые — или на предплечьях (согнуты, кисти далеко впереди). */
  private plankArms(pose: FrontPose, k: number): boolean {
    const slack = this.armsOk ? this.cfg.plankArmsSlack : 0;
    const straight = pose.elbow !== null && pose.elbow >= this.cfg.plankStraightElbowDeg - slack * 100;
    const forearms = pose.wristDrop !== null && pose.wristDrop * k >= this.cfg.plankForearmWristDrop - slack;
    this.armsOk = straight || forearms;
    return this.armsOk;
  }

  /**
   * Правдоподобие по плечам (вместо общего фильтра по длине корпуса — спереди корпус «дышит» вдвое):
   * середина плеч за кадр не прыгает дальше, чем позволяет скорость, в устойчивых ширинах плеч.
   * «Скачок» держится дольше settleMs — это новое положение, принимаем.
   */
  private plausible(pose: FrontPose, scale: number, t: number): boolean {
    const last = this.last;
    if (last) {
      const dt = Math.max(0, t - last.t) / 1000;
      const shift = Math.hypot(pose.shoulderX - last.x, pose.shoulderY - last.y) / scale;
      if (shift > this.cfg.maxShiftPerSec * dt + this.cfg.shiftSlack) {
        this.jumpSince ??= t;
        if (t - this.jumpSince < this.cfg.settleMs) return false;
      }
    }
    this.jumpSince = null;
    this.last = { x: pose.shoulderX, y: pose.shoulderY, t };
    return true;
  }

  /**
   * Удержание «в упоре». Спереди таз, ноги и кисти у края кадра модель угадывает, и разные модели угадывают
   * по-разному (full на видеокарте видела «ноги далеко внизу» целую секунду посреди подхода) — одиночные
   * и короткие провалы признаков не выбивают счёт; встал по-настоящему — через leaveMs упражнение не считается.
   */
  private position(raw: boolean, t: number): boolean {
    if (raw === this.inPos) {
      this.switchSince = null;
      return this.inPos;
    }
    this.switchSince ??= t;
    if (t - this.switchSince >= (this.inPos ? this.cfg.leaveMs : this.cfg.enterMs)) {
      this.inPos = raw;
      this.switchSince = null;
    }
    return this.inPos;
  }

  /** Плечи за последние plankStillMs сдвинулись по высоте меньше plankMaxTravel ширин плеч. */
  private still(y: number, t: number): boolean {
    this.recent.push({ t, y });
    while (this.recent.length > 1 && (this.recent[0] as { t: number }).t < t - this.cfg.plankStillMs)
      this.recent.shift();
    const ys = this.recent.map((r) => r.y);
    return Math.max(...ys) - Math.min(...ys) < this.cfg.plankMaxTravel;
  }

  reset(): void {
    this.width.reset();
    this.top.reset();
    this.last = null;
    this.jumpSince = null;
    this.inPos = false;
    this.switchSince = null;
    this.recent = [];
    this.rawSince = null;
    this.armsOk = false;
  }
}

/**
 * Что видно спереди: перекос (одно плечо ниже — заваливается на руку) и локти в стороны («буквой Т»).
 * Пороги выше всего, что было на записи с правильной техникой (перекос до 0,27, локти до 0,7 ширины плеч).
 * minProgress — проверяем только в глубине отжимания (у планки — всё время в упоре).
 */
function shapeRules(cfg: FloorConfig, minProgress: number): RuleDef<FloorMetrics>[] {
  return [
    {
      code: 'shoulders_uneven',
      kind: 'frame',
      check: (m) =>
        m.inPlank && m.progress >= minProgress && m.tilt > cfg.maxTilt
          ? { joints: [LM.leftShoulder, LM.rightShoulder] }
          : null,
    },
    {
      code: 'elbows_wide',
      kind: 'frame',
      check: (m) =>
        m.inPlank && m.progress >= minProgress && m.elbowOut !== null && m.elbowOut > cfg.maxElbowOut
          ? { joints: [LM.leftElbow, LM.rightElbow] }
          : null,
    },
  ];
}

export function pushUpRules(cfg: FloorConfig = ENGINE_CONFIG.exercises.push_up): RuleDef<FloorMetrics>[] {
  return [
    {
      code: 'shallow_pushup',
      kind: 'rep',
      on: ['rep', 'attempt'],
      check: (c) =>
        c.summary.pMax < cfg.goodProgress ? { joints: [ARM.left.elbow, ARM.right.elbow] } : null,
    },
    ...shapeRules(cfg, cfg.shapeMinProgress),
  ];
}

export function plankRules(cfg: FloorConfig = ENGINE_CONFIG.exercises.push_up): RuleDef<FloorMetrics>[] {
  return [
    ...shapeRules({ ...cfg, maxElbowOut: cfg.plankMaxElbowOut }, 0),
    // Лёг на пол посреди планки: секунды стоят, говорим, как их вернуть.
    { code: 'plank_low', kind: 'frame', check: (m) => (m.lowArms ? {} : null) },
  ];
}

/** Плечи и кисти — то, без чего спереди упор не распознать. */
const FLOOR_JOINTS = [LM.leftShoulder, LM.rightShoulder, LM.leftWrist, LM.rightWrist];

export function createPushUp(cfg: FloorConfig = ENGINE_CONFIG.exercises.push_up): ExerciseDef<FloorMetrics> {
  return {
    id: 'push_up',
    requiredJoints: FLOOR_JOINTS,
    armsOverhead: false,
    fsm: cfg.fsm,
    createMeter: () => new FloorMeter(cfg, false),
    rules: pushUpRules(cfg),
    ownGate: true,
    lostHint: CALIBRATION_DETAIL_HINTS.lostFloor,
  };
}

export function createPlank(cfg: FloorConfig = ENGINE_CONFIG.exercises.push_up): ExerciseDef<FloorMetrics> {
  return {
    id: 'plank',
    requiredJoints: FLOOR_JOINTS,
    armsOverhead: false,
    // Пороги счётчика планке не нужны (повтор — секунда в упоре), но тип их требует.
    fsm: cfg.fsm,
    createMeter: () => new FloorMeter(cfg, true),
    rules: plankRules(cfg),
    hold: true,
    ownGate: true,
    lostHint: CALIBRATION_DETAIL_HINTS.lostFloor,
  };
}
