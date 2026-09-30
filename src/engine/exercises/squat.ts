// Приседания: глубина, прогресс, счёт (E-08) и ошибки техники (E-10).
//
// Глубину меряем не углом колена, а «вертикалью бедра»: насколько колено ниже таза.
// Анфас бедро в приседе уходит на камеру, и 2D-угол колена почти не меняется — а высота таза
// относительно колена видна с любого ракурса. «Бедро параллельно полу» — ровно «таз на уровне
// колена», то есть вертикаль бедра 0.
//
// Вертикаль бедра делим на вертикаль голени того же кадра, а потом на это же отношение стоя.
// Так мера не зависит от расстояния до камеры: человек отошёл — укоротились обе вертикали,
// отношение то же. Первая версия делила на бедро стоя, и уход от камеры выглядел как начало
// приседа: счётчик уходил в «down» и зависал (поймал тест).
//
// Все метрики ошибок тоже нормированы на то, что не меняется от расстояния: ширину таза или
// плеч, а не доли кадра.

import { ENGINE_CONFIG, type Widen } from '../config';
import {
  RAD_TO_DEG,
  angleFromVertical,
  dist2,
  isVisible,
  mid2,
  pt,
  tiltFromForeshortening,
  torsoLength,
  type PoseFrame,
  type Vec2,
  type Vec3,
} from '../geometry';
import { LM } from '../hints';
import type { RuleDef } from '../rules';
import type { Joint, Phase } from '../types';
import { SlidingMax } from './baseline';
import type { BaseMetrics, ExerciseDef, ExerciseMeter } from './types';

type SquatConfig = Widen<typeof ENGINE_CONFIG.exercises.squat>;
type Side = 'left' | 'right';

export interface SquatMetrics extends BaseMetrics {
  /** Глубина по бедру: 1 — стоя, 0 — бедро параллельно полу, < 0 — ниже. */
  thighRatio: number;
  /** То же по каждой ноге (null — нога не видна). */
  thighRatioL: number | null;
  thighRatioR: number | null;
  /** Видны обе ноги и человек анфас или спиной: только тогда имеют смысл «колени внутрь» и асимметрия. */
  frontal: boolean;
  /** Наклон корпуса от вертикали, градусы; null — не измерить. */
  lean: number | null;
  /** Ширина между коленями / между щиколотками (анфас). */
  kneeWidthRatio: number | null;
  /** Насколько колено ушло внутрь от линии таз → щиколотка, в ширинах таза (+ внутрь). */
  kneeInL: number | null;
  kneeInR: number | null;
  /** Смещение таза над опорой в долях расстояния между щиколотками; + — вправо по зеркальному экрану. */
  hipShift: number | null;
  /** Перекос линии таза: разница высоты бёдер / ширина таза. */
  hipTilt: number | null;
}

const LEGS = {
  left: { hip: LM.leftHip, knee: LM.leftKnee, ankle: LM.leftAnkle },
  right: { hip: LM.rightHip, knee: LM.rightKnee, ankle: LM.rightAnkle },
} as const;

/** Голень короче этой доли высоты кадра — точки слиплись, делить на неё нельзя. */
const MIN_SHIN = 0.02;

/** Соседние кадры для эталона — не дальше друг от друга (на 15 FPS шаг 67 мс, пропуски кадров бывают). */
const PAIR_GAP_MS = 250;

/** Прогресс по отношению бедра: 0 стоя, 1 — у параллели, больше — глубже. */
export function squatProgress(thighRatio: number, cfg: SquatConfig = ENGINE_CONFIG.exercises.squat): number {
  return (1 - thighRatio) / (1 - cfg.parallelRatio);
}

class SquatMeter implements ExerciseMeter<SquatMetrics> {
  private readonly base: Record<Side, SlidingMax>;
  /** Корпус по вертикали / ширина плеч стоя — для наклона анфас. */
  private readonly torsoBase: SlidingMax;
  /** Прошлый кадр по каждому эталону: в эталон идёт минимум пары соседних кадров. */
  private readonly prevBase = new Map<SlidingMax, { v: number; t: number }>();

  constructor(private readonly cfg: SquatConfig) {
    // В конструкторе, а не инициализатором поля: при target ES2022 поля создаются раньше, чем cfg.
    this.base = { left: new SlidingMax(cfg.baselineWindowMs), right: new SlidingMax(cfg.baselineWindowMs) };
    this.torsoBase = new SlidingMax(cfg.baselineWindowMs);
  }

  measure(frame: PoseFrame, phase: Phase): SquatMetrics | null {
    const seen = (i: number) => isVisible(frame.image[i], 0.5, 0.05);
    const updateBase = (base: SlidingMax, v: number) => {
      // Эталон обновляем, только пока человек стоит (или эталона ещё нет вовсе), и не отдельным кадром, а
      // минимумом двух соседних: эталон — максимум, и один завышенный кадр держал бы его, пока человек не
      // постоит снова. Так в эталон не попадают ни сбой модели (колено «прыгнуло» на кадр — отношение
      // 0,73 → 1,73, и 12 с приседы не считались), ни первый кадр движения, который приходит ещё с фазой
      // 'start' (прямая нога бокового выпада — на 20 % выше, чем стоя: на 15 FPS 5 выпадов → 4).
      const prev = this.prevBase.get(base);
      this.prevBase.set(base, { v, t: frame.t });
      const pair = prev && frame.t - prev.t <= PAIR_GAP_MS ? Math.min(prev.v, v) : null;
      // Эталона нет вовсе — затравка первым кадром, чтобы мерить сразу; дальше его поправят пары.
      if (base.value === null) base.push(pair ?? v, frame.t);
      else if (phase === 'start' && pair !== null) base.push(pair, frame.t);
      else base.expire(frame.t);
      return base.value;
    };

    const ratio = (side: Side): number | null => {
      const { hip, knee, ankle } = LEGS[side];
      if (!seen(hip) || !seen(knee) || !seen(ankle)) return null;
      const shin = pt(frame, ankle).y - pt(frame, knee).y;
      if (shin < MIN_SHIN) return null;
      const standing = updateBase(this.base[side], (pt(frame, knee).y - pt(frame, hip).y) / shin);
      return standing && standing > 0 ? (pt(frame, knee).y - pt(frame, hip).y) / shin / standing : null;
    };
    const l = ratio('left');
    const r = ratio('right');
    if (l === null && r === null) return null;
    // Анфас и со спины видны обе ноги — усредняем; сбоку дальняя закрыта — берём видимую.
    const thighRatio = l !== null && r !== null ? (l + r) / 2 : ((l ?? r) as number);

    const torso = torsoLength(frame);
    const hipWidth = dist2(pt(frame, LM.leftHip), pt(frame, LM.rightHip));
    const frontal = l !== null && r !== null && torso > 0 && this.isFrontal(frame, hipWidth, torso);

    return {
      progress: squatProgress(thighRatio, this.cfg),
      thighRatio,
      thighRatioL: l,
      thighRatioR: r,
      frontal,
      lean: this.lean(frame, updateBase),
      ...(frontal
        ? this.knees(frame, hipWidth)
        : { kneeWidthRatio: null, kneeInL: null, kneeInR: null, hipShift: null, hipTilt: null }),
    };
  }

  reset(): void {
    this.base.left.reset();
    this.base.right.reset();
    this.torsoBase.reset();
    this.prevBase.clear();
  }

  /**
   * Наклон корпуса от вертикали.
   * Основная оценка — по мировым 3D-точкам MediaPipe: угол вектора таз → плечи от вертикали.
   * На реальных записях она сходится с прямым 2D-углом сбоку (~21°) и честна анфас (25–30° на
   * хорошем кубковом приседе). 2D-оценки — запасные: сбоку прямой угол, анфас укорочение корпуса
   * (acos(сейчас / стоя), корпус нормирован на ширину плеч). Анфас укорочение завышает наклон на
   * ~20° из-за перспективы (плечи в приседе ближе к камере), поэтому только как запасной вариант.
   */
  private lean(frame: PoseFrame, updateBase: (b: SlidingMax, v: number) => number | null): number | null {
    const shoulderMid = seenMid(frame, LM.leftShoulder, LM.rightShoulder);
    const hipMid = seenMid(frame, LM.leftHip, LM.rightHip);
    if (!shoulderMid || !hipMid) return null;

    const w = frame.world;
    const ws = [LM.leftShoulder, LM.rightShoulder, LM.leftHip, LM.rightHip].map((i) => w?.[i]);
    if (ws.every(Boolean)) {
      const [sl, sr, hl, hr] = ws as [Vec3, Vec3, Vec3, Vec3];
      const up = {
        x: (sl.x + sr.x - hl.x - hr.x) / 2,
        y: (sl.y + sr.y - hl.y - hr.y) / 2,
        z: (sl.z + sr.z - hl.z - hr.z) / 2,
      };
      const n = Math.hypot(up.x, up.y, up.z);
      // Мировая ось y у MediaPipe смотрит вниз, поэтому «вверх» — это −y.
      if (n > 0) return Math.acos(Math.max(-1, Math.min(1, -up.y / n))) * RAD_TO_DEG;
    }

    const direct = angleFromVertical(hipMid, shoulderMid);
    let foreshortened = NaN;
    const four = [LM.leftShoulder, LM.rightShoulder, LM.leftHip, LM.rightHip];
    if (four.every((i) => isVisible(frame.image[i]))) {
      const shoulderWidth = dist2(pt(frame, LM.leftShoulder), pt(frame, LM.rightShoulder));
      const torsoV = hipMid.y - shoulderMid.y;
      if (shoulderWidth > 0 && shoulderWidth >= this.cfg.frontalMinHipToTorso * Math.abs(torsoV)) {
        const standing = updateBase(this.torsoBase, torsoV / shoulderWidth);
        if (standing) foreshortened = tiltFromForeshortening(torsoV / shoulderWidth, standing);
      }
    }
    if (!Number.isFinite(direct) && !Number.isFinite(foreshortened)) return null;
    return Math.max(Number.isFinite(direct) ? direct : 0, Number.isFinite(foreshortened) ? foreshortened : 0);
  }

  /**
   * Анфас (или спиной) — только тогда «колени внутрь» и перекос таза что-то значат.
   * Главный признак — поворот линии таза к камере по мировым 3D-точкам: анфас ~13°, вполоборота ~56°,
   * боком ~75–80° (реальные записи). В повороте таз, уходя назад, проецируется в сдвиг вбок,
   * а колени — в «завал», поэтому на повёрнутом человеке эти правила врут. Без 3D-точек — по ширине таза.
   */
  private isFrontal(frame: PoseFrame, hipWidth: number, torso: number): boolean {
    const w = frame.world;
    const hl = w?.[LM.leftHip];
    const hr = w?.[LM.rightHip];
    if (hl && hr) {
      const yaw = Math.atan2(Math.abs(hl.z - hr.z), Math.abs(hl.x - hr.x)) * RAD_TO_DEG;
      return yaw <= this.cfg.frontalMaxYawDeg;
    }
    return hipWidth >= this.cfg.frontalMinHipToTorso * torso;
  }

  /** Колени и смещение таза — только анфас/спиной, когда видны обе ноги. */
  private knees(
    frame: PoseFrame,
    hipWidth: number,
  ): Pick<SquatMetrics, 'kneeWidthRatio' | 'kneeInL' | 'kneeInR' | 'hipShift' | 'hipTilt'> {
    const hipMid = mid2(pt(frame, LM.leftHip), pt(frame, LM.rightHip));
    const kneeIn = (side: Side): number => {
      const hip = pt(frame, LEGS[side].hip);
      const knee = pt(frame, LEGS[side].knee);
      const ankle = pt(frame, LEGS[side].ankle);
      // Линия таз → щиколотка на высоте колена; «внутрь» — к средней линии тела. Так работает и анфас,
      // и спиной (где левое и правое на картинке меняются местами).
      const span = ankle.y - hip.y;
      const u = span > 0 ? (knee.y - hip.y) / span : 0;
      const lineX = hip.x + u * (ankle.x - hip.x);
      const outward = Math.sign(hip.x - hipMid.x) || 1;
      return ((lineX - knee.x) * outward) / hipWidth;
    };
    const ankleL = pt(frame, LM.leftAnkle);
    const ankleR = pt(frame, LM.rightAnkle);
    const ankleWidth = Math.abs(ankleL.x - ankleR.x);
    // Стопы слиплись по горизонтали (боком, или стоит «ноги вместе») — делить на их ширину нельзя:
    // сбоку щиколотки перекрываются, и отношения улетали в сотни.
    if (ankleWidth < this.cfg.minStanceToHip * hipWidth) {
      return { kneeWidthRatio: null, kneeInL: null, kneeInR: null, hipShift: null, hipTilt: null };
    }
    const kneeWidth = Math.abs(pt(frame, LM.leftKnee).x - pt(frame, LM.rightKnee).x);
    const ankleMidX = (ankleL.x + ankleR.x) / 2;
    return {
      kneeWidthRatio: kneeWidth / ankleWidth,
      kneeInL: kneeIn('left'),
      kneeInR: kneeIn('right'),
      // На зеркальном экране x растёт в обратную сторону, поэтому знак меняется.
      hipShift: -(hipMid.x - ankleMidX) / ankleWidth,
      hipTilt: (pt(frame, LM.leftHip).y - pt(frame, LM.rightHip).y) / hipWidth,
    };
  }
}

/** Середина пары точек; если видна одна — она сама (сбоку дальнее плечо закрыто). */
function seenMid(frame: PoseFrame, a: number, b: number): Vec2 | null {
  const va = isVisible(frame.image[a]);
  const vb = isVisible(frame.image[b]);
  if (va && vb) return mid2(pt(frame, a), pt(frame, b));
  if (va) return pt(frame, a);
  if (vb) return pt(frame, b);
  return null;
}

/** Правила ошибок приседа (PLAN §3). Тексты, суставы, фазы и важность — в hints.ts. */
export function squatRules(cfg: SquatConfig = ENGINE_CONFIG.exercises.squat): RuleDef<SquatMetrics>[] {
  return [
    {
      code: 'shallow_depth',
      kind: 'rep',
      // По итогу повтора (самая глубокая точка), а не по первой «нижней»: отскок внизу не должен
      // записывать «мало глубины» в повтор, который потом дошёл до параллели. И после неглубокой
      // попытки тоже: человек должен услышать «глубже».
      on: ['rep', 'attempt'],
      check: (c) => (c.summary.pMax < cfg.goodDepthProgress ? {} : null),
    },
    {
      code: 'knees_in',
      kind: 'frame',
      check: (m) => {
        if (!m.frontal || m.progress < cfg.kneesMinProgress) return null;
        // Одно колено «внутрь» считаем, только если второе не ушло сильно наружу: пара «одно внутрь,
        // другое наружу» — подпись поворота корпуса, а не завала колена.
        const kl = m.kneeInL ?? 0;
        const kr = m.kneeInR ?? 0;
        const inL = kl > cfg.kneeInOffset && kr > -cfg.kneeInOffset;
        const inR = kr > cfg.kneeInOffset && kl > -cfg.kneeInOffset;
        const narrow = m.kneeWidthRatio !== null && m.kneeWidthRatio < cfg.kneeWidthRatio;
        if (!inL && !inR && !narrow) return null;
        // Подсвечиваем то колено, что завалилось; если оба или «вообще узко» — оба.
        const joints: Joint[] =
          inL && !inR ? [LM.leftKnee] : inR && !inL ? [LM.rightKnee] : [LM.leftKnee, LM.rightKnee];
        return { joints };
      },
    },
    {
      code: 'torso_lean',
      kind: 'frame',
      check: (m) => (m.lean !== null && m.lean > cfg.maxLeanDeg ? {} : null),
    },
    {
      code: 'asymmetry',
      kind: 'frame',
      check: (m) => {
        if (!m.frontal || m.progress < cfg.asymmetryMinProgress) return null;
        // Разницу глубины ног сравниваем только на середине амплитуды: ниже параллели отношение
        // плохо обусловлено, и симметричный присед со спины под углом давал разницу 0,35.
        const midDepth = m.progress <= cfg.asymmetryMaxProgress;
        const depthGap =
          midDepth && m.thighRatioL !== null && m.thighRatioR !== null
            ? Math.abs(m.thighRatioL - m.thighRatioR)
            : 0;
        const shift = m.hipShift ?? 0;
        const tilt = Math.abs(m.hipTilt ?? 0);
        if (
          depthGap <= cfg.asymmetryRatio &&
          Math.abs(shift) <= cfg.hipShiftRatio &&
          tilt <= cfg.hipTiltRatio
        )
          return null;
        // Если таз уехал вбок — стрелка показывает, куда его вернуть (на зеркальном экране).
        if (Math.abs(shift) > cfg.hipShiftRatio / 2) return { arrow: shift > 0 ? 'left' : 'right' };
        return {};
      },
    },
    {
      code: 'too_fast',
      kind: 'rep',
      on: ['rep'],
      check: (c) => (c.summary.durationMs < cfg.minRepMs ? {} : null),
    },
  ];
}

export function createSquat(cfg: SquatConfig = ENGINE_CONFIG.exercises.squat): ExerciseDef<SquatMetrics> {
  return {
    id: 'squat',
    requiredJoints: [LM.leftHip, LM.rightHip, LM.leftKnee, LM.rightKnee, LM.leftAnkle, LM.rightAnkle],
    armsOverhead: false,
    fsm: cfg.fsm,
    createMeter: () => new SquatMeter(cfg),
    rules: squatRules(cfg),
  };
}
