// Калибровка (E-06): виден ли человек целиком, не далеко ли, не близко ли, хватает ли света.
//
// Два режима:
// - полный (экран калибровки): проверяем всё, от света до размера тела в кадре;
// - «присутствие» (меню и тренировка): только «человек в кадре и нужные суставы видны».
//   Размер тела во время упражнения не проверяем: в приседе человек «уменьшается», в «звёздочке»
//   руки уходят за край кадра — полная калибровка кричала бы «подойди ближе» посреди подхода.

import { ENGINE_CONFIG, type Widen } from './config';
import { dist2, isVisible, meanVisibility, pt, torsoLength, type PoseFrame } from './geometry';
import { CALIBRATION_DETAIL_HINTS, CALIBRATION_HINTS, LM } from './hints';
import type { CalibrationStatus } from './types';

export interface CalibrationVerdict {
  status: CalibrationStatus;
  hint: string;
}

type CalibrationConfig = Widen<typeof ENGINE_CONFIG.calibration>;

const HEAD = [LM.nose] as const;
const TORSO = [LM.leftShoulder, LM.rightShoulder, LM.leftHip, LM.rightHip] as const;
const LEGS = [LM.leftKnee, LM.rightKnee, LM.leftAnkle, LM.rightAnkle] as const;
const KEY = [...HEAD, ...TORSO, ...LEGS] as const;
/** Корпус (плечи → таз) — примерно 30 % роста: по нему прикидываем рост, когда ног не видно. */
const TORSO_SHARE_OF_HEIGHT = 0.3;

const verdict = (
  status: CalibrationStatus,
  hint: string = CALIBRATION_HINTS[status],
): CalibrationVerdict => ({
  status,
  hint,
});

/**
 * Мгновенная оценка одного кадра для экрана калибровки.
 * brightness — средняя яркость кадра 0..255 или null, если её не меряли.
 */
export function assessCalibration(
  frame: PoseFrame | null,
  brightness: number | null,
  cfg: CalibrationConfig = ENGINE_CONFIG.calibration,
): CalibrationVerdict {
  if (brightness !== null && brightness < cfg.darkLuma) return verdict('dark');
  if (!frame) {
    // Никого не видно в полутьме — скорее всего, дело в свете, а не в человеке.
    return brightness !== null && brightness < cfg.dimLuma ? verdict('dark') : verdict('no_person');
  }

  const seen = (i: number) => isVisible(frame.image[i], cfg.minVisibility);
  if (brightness !== null && brightness < cfg.dimLuma && meanVisibility(frame, KEY) < cfg.lowVisibility) {
    return verdict('dark');
  }

  const torsoSeen = TORSO.filter(seen);
  if (torsoSeen.length < TORSO.length) {
    // Корпус виден не целиком. Причины две: человек у бокового края (плечо вышло за кадр)
    // или вплотную к камере. Различаем по тому, где по горизонтали видимая часть тела.
    const anchors: number[] = torsoSeen.length > 0 ? torsoSeen : seen(LM.nose) ? [LM.nose] : [];
    if (anchors.length === 0) return verdict('no_person');
    const cx = anchors.reduce((sum, i) => sum + (frame.image[i]?.x ?? 0.5), 0) / anchors.length;
    if (cx < cfg.offCenter || cx > 1 - cfg.offCenter)
      return verdict('partial', CALIBRATION_DETAIL_HINTS.center);
    return verdict('too_close');
  }

  // Корпус целиком в кадре. Сначала — повернут ли человек лицом: боком дальняя нога закрыта ближней,
  // и без этой проверки мы бы твердили «отойди, нужно видеть ноги» вместо «повернись».
  const shoulderWidth = dist2(pt(frame, LM.leftShoulder), pt(frame, LM.rightShoulder));
  const torso = torsoLength(frame);
  if (torso > 0 && shoulderWidth / torso < cfg.minShoulderToTorso) {
    return verdict('partial', CALIBRATION_DETAIL_HINTS.faceCamera);
  }

  // Боковые края: человек частично вышел из кадра.
  const offEdge = KEY.some((i) => {
    const p = frame.image[i];
    return !!p && p.v >= cfg.minVisibility && (p.x < cfg.edgeMargin || p.x > 1 - cfg.edgeMargin);
  });
  if (offEdge) return verdict('partial', CALIBRATION_DETAIL_HINTS.center);

  const legsSeen = LEGS.every(seen);
  if (!legsSeen) {
    // Ноги не влезли. Если корпус и так большой — человек слишком близко, иначе камеру надо опустить
    // или отойти: в обоих случаях полезная подсказка одна — «отойди, нужно видеть ноги».
    const estimatedHeight = torso / TORSO_SHARE_OF_HEIGHT;
    return estimatedHeight > cfg.maxBodyHeight
      ? verdict('too_close', CALIBRATION_DETAIL_HINTS.showLegs)
      : verdict('partial', CALIBRATION_DETAIL_HINTS.showLegs);
  }
  if (!seen(LM.nose)) {
    // Нос выше кадра — голова обрезана. Нос в кадре, но невидим — человек стоит спиной.
    const noseY = frame.image[LM.nose]?.y ?? 0;
    return noseY < cfg.edgeMargin
      ? verdict('too_close', CALIBRATION_DETAIL_HINTS.showHead)
      : verdict('partial', CALIBRATION_DETAIL_HINTS.faceCamera);
  }

  // Целиком в кадре, но у края: в «звёздочке» руки сразу уйдут за кадр.
  const hipX = ((frame.image[LM.leftHip]?.x ?? 0.5) + (frame.image[LM.rightHip]?.x ?? 0.5)) / 2;
  if (hipX < cfg.offCenter || hipX > 1 - cfg.offCenter)
    return verdict('partial', CALIBRATION_DETAIL_HINTS.center);

  const feetY = Math.max(frame.image[LM.leftAnkle]?.y ?? 0, frame.image[LM.rightAnkle]?.y ?? 0);
  const bodyHeight = feetY - (frame.image[LM.nose]?.y ?? feetY);
  if (bodyHeight < cfg.minBodyHeight) return verdict('too_far');
  if (bodyHeight > cfg.maxBodyHeight) return verdict('too_close');
  return verdict('ok');
}

/**
 * Оценка «присутствия» для меню и тренировки: только человек в кадре и нужные ему суставы.
 * required — суставы, без которых текущий режим не работает (например, ноги для приседа).
 */
export function assessPresence(
  frame: PoseFrame | null,
  required: readonly number[],
  cfg: CalibrationConfig = ENGINE_CONFIG.calibration,
): CalibrationVerdict {
  if (!frame) return verdict('no_person', CALIBRATION_DETAIL_HINTS.lostBody);
  const missing = required.some((i) => !isVisible(frame.image[i], cfg.minVisibility, 0.02));
  return missing ? verdict('partial', CALIBRATION_DETAIL_HINTS.lostJoints) : verdict('ok');
}

/**
 * Антидребезг статуса: новый статус принимается, только если продержался stableMs.
 * Иначе на границе кадра подсказки мигали бы «отойди / подойди» по пять раз в секунду.
 */
export class CalibrationTracker {
  private stable: CalibrationVerdict | null = null;
  private candidate: CalibrationVerdict | null = null;
  private candidateSince = 0;

  constructor(
    private readonly stableMs: Record<CalibrationStatus, number> = ENGINE_CONFIG.calibration.stableMs,
  ) {}

  get current(): CalibrationVerdict | null {
    return this.stable;
  }

  /** Возвращает новый устойчивый вердикт, если он сменился (статус или текст), иначе null. */
  update(next: CalibrationVerdict, tMs: number): CalibrationVerdict | null {
    if (this.stable && sameVerdict(this.stable, next)) {
      this.candidate = null;
      return null;
    }
    if (!this.candidate || !sameVerdict(this.candidate, next)) {
      this.candidate = next;
      this.candidateSince = tMs;
    }
    // Самый первый статус принимаем сразу: UI не должен ждать, пока «что-то» появится.
    const hold = this.stable ? this.stableMs[next.status] : 0;
    if (tMs - this.candidateSince >= hold) {
      this.stable = next;
      this.candidate = null;
      return next;
    }
    return null;
  }

  reset(): void {
    this.stable = null;
    this.candidate = null;
  }
}

function sameVerdict(a: CalibrationVerdict, b: CalibrationVerdict): boolean {
  return a.status === b.status && a.hint === b.hint;
}
