// Жесты интерфейса (E-07): курсор-рука и «обе руки вверх».
//
// Курсор: ведёт поднятая рука (запястье выше середины корпуса). Опущенная рука курсор отпускает,
// поэтому он не дёргается, когда человек просто стоит. Позиция считается не по всему кадру,
// а в зоне досягаемости вокруг плеча, растянутой на весь экран, и зеркально: человек поднимает
// правую руку — курсор уходит вправо, как в зеркале. Сглаживание двойное: точки уже прошли
// One Euro, курсор проходит ещё один фильтр в координатах экрана.
//
// «Обе руки вверх»: запястья выше головы 0,8 с подряд. Срабатывает один раз; следующий жест —
// только после того, как руки опустились. Пока жест держится, курсор отпущен (pointer_lost),
// чтобы он не скакал по кнопкам.

import { ENGINE_CONFIG, type Widen } from './config';
import { OneEuroFilter } from './filter';
import { clamp, isVisible, mirrorX, torsoLength, type PoseFrame } from './geometry';
import { LM } from './hints';
import type { EngineEvent } from './types';

export type GestureEvent = Extract<EngineEvent, { type: 'pointer' | 'pointer_lost' | 'gesture' }>;
export type Hand = 'left' | 'right';

export interface GestureOptions {
  /** Вести курсор (меню, итоги). */
  pointer: boolean;
  /** Ловить «обе руки вверх» (везде, кроме подхода с руками над головой). */
  bothHandsUp: boolean;
}

type GestureConfig = Widen<typeof ENGINE_CONFIG.gestures>;

const SIDES: Record<Hand, { wrist: number; shoulder: number }> = {
  left: { wrist: LM.leftWrist, shoulder: LM.leftShoulder },
  right: { wrist: LM.rightWrist, shoulder: LM.rightShoulder },
};

interface ScreenPoint {
  x: number;
  y: number;
}

/**
 * Точка кадра в координатах зеркального экрана с поправкой на аспект:
 * x растёт вправо по экрану (то есть влево по исходной картинке), единица — высота кадра.
 */
function screenPoint(frame: PoseFrame, i: number): ScreenPoint {
  const p = frame.image[i];
  return p ? { x: mirrorX(p.x) * frame.aspect, y: p.y } : { x: NaN, y: NaN };
}

/**
 * Позиция курсора 0..1 для руки hand: зона досягаемости вокруг её плеча → весь экран.
 * На зеркальном экране правая рука человека справа, поэтому «наружу» для неё — вправо.
 */
export function pointerPosition(
  frame: PoseFrame,
  hand: Hand,
  cfg: GestureConfig = ENGINE_CONFIG.gestures,
): ScreenPoint {
  const torso = torsoLength(frame);
  const shoulder = screenPoint(frame, SIDES[hand].shoulder);
  const wrist = screenPoint(frame, SIDES[hand].wrist);
  const { outward, inward, up, down } = cfg.reach;
  const x0 = hand === 'right' ? shoulder.x - inward * torso : shoulder.x - outward * torso;
  const x1 = hand === 'right' ? shoulder.x + outward * torso : shoulder.x + inward * torso;
  const y0 = shoulder.y - up * torso;
  const y1 = shoulder.y + down * torso;
  return { x: clamp((wrist.x - x0) / (x1 - x0), 0, 1), y: clamp((wrist.y - y0) / (y1 - y0), 0, 1) };
}

export class GestureTracker {
  private active: Hand | null = null;
  private pointerShown = false;
  private lastPointerAt = -Infinity;
  private readonly fx: OneEuroFilter;
  private readonly fy: OneEuroFilter;

  private bothSince: number | null = null;
  private bothLastSeen = -Infinity;
  private armed = true;

  constructor(private readonly cfg: GestureConfig = ENGINE_CONFIG.gestures) {
    this.fx = new OneEuroFilter(cfg.pointerFilter);
    this.fy = new OneEuroFilter(cfg.pointerFilter);
  }

  update(frame: PoseFrame | null, tMs: number, opts: GestureOptions): GestureEvent[] {
    const events: GestureEvent[] = [];
    const bothUp = frame ? this.handsAboveHead(frame) : false;
    this.trackBothHands(frame, bothUp, tMs, opts.bothHandsUp, events);

    // Пока обе руки над головой (идёт жест), курсор отпущен.
    const hand = frame && opts.pointer && !bothUp ? this.pickHand(frame) : null;
    if (!hand || !frame) {
      this.releasePointer(events);
      return events;
    }
    if (hand !== this.active) {
      // Сменилась рука — курсор прыгает к новой, сглаживание с нуля.
      this.fx.reset();
      this.fy.reset();
    }
    this.active = hand;
    const raw = pointerPosition(frame, hand, this.cfg);
    const x = clamp(this.fx.filter(raw.x, tMs), 0, 1);
    const y = clamp(this.fy.filter(raw.y, tMs), 0, 1);
    if (tMs - this.lastPointerAt >= this.cfg.pointerIntervalMs) {
      this.lastPointerAt = tMs;
      this.pointerShown = true;
      events.push({ type: 'pointer', x: round3(x), y: round3(y), hand });
    }
    return events;
  }

  /**
   * Смена режима движка. Жест не взведён, пока руки не опустятся ниже плеч: иначе руки, поднятые
   * ещё в интро («готов — начали»), через 0,8 с закончили бы подход досрочно. Опущенные руки
   * взводят его на первом же кадре, так что в обычном случае задержки нет.
   */
  reset(): void {
    this.active = null;
    this.pointerShown = false;
    this.lastPointerAt = -Infinity;
    this.fx.reset();
    this.fy.reset();
    this.bothSince = null;
    this.armed = false;
  }

  private releasePointer(events: GestureEvent[]): void {
    if (this.pointerShown) events.push({ type: 'pointer_lost' });
    this.pointerShown = false;
    this.active = null;
    this.lastPointerAt = -Infinity;
  }

  /** Какая рука ведёт курсор: текущая, пока она поднята; иначе поднятая выше другой. */
  private pickHand(frame: PoseFrame): Hand | null {
    const torso = torsoLength(frame);
    if (!(torso > 0)) return null;
    const raised = (hand: Hand, threshold: number): number | null => {
      const wrist = frame.image[SIDES[hand].wrist];
      const shoulder = frame.image[SIDES[hand].shoulder];
      if (!isVisible(wrist, this.cfg.minVisibility, 0.05) || !shoulder) return null;
      return wrist.y < shoulder.y + threshold * torso ? wrist.y : null;
    };
    if (this.active && raised(this.active, this.cfg.releaseBelowShoulder) !== null) return this.active;
    const left = raised('left', this.cfg.activateBelowShoulder);
    const right = raised('right', this.cfg.activateBelowShoulder);
    if (left === null && right === null) return null;
    if (left === null) return 'right';
    if (right === null) return 'left';
    return left < right ? 'left' : 'right';
  }

  private handsAboveHead(frame: PoseFrame): boolean {
    const torso = torsoLength(frame);
    const lw = frame.image[LM.leftWrist];
    const rw = frame.image[LM.rightWrist];
    if (
      !(torso > 0) ||
      !isVisible(lw, this.cfg.minVisibility, 0.1) ||
      !isVisible(rw, this.cfg.minVisibility, 0.1)
    ) {
      return false;
    }
    // Если нос не виден (руки закрыли лицо), считаем голову на корпус выше плеч.
    const nose = frame.image[LM.nose];
    const shoulderY = ((frame.image[LM.leftShoulder]?.y ?? 0) + (frame.image[LM.rightShoulder]?.y ?? 0)) / 2;
    const headY = nose && nose.v >= this.cfg.minVisibility ? nose.y : shoulderY - 0.45 * torso;
    const line = headY - this.cfg.handsAboveNose * torso;
    return lw.y < line && rw.y < line;
  }

  private trackBothHands(
    frame: PoseFrame | null,
    bothUp: boolean,
    tMs: number,
    enabled: boolean,
    events: GestureEvent[],
  ): void {
    if (!enabled) {
      this.bothSince = null;
      return;
    }
    if (bothUp) {
      if (this.bothSince === null || tMs - this.bothLastSeen > this.cfg.bothHandsGapMs) this.bothSince = tMs;
      this.bothLastSeen = tMs;
      if (this.armed && tMs - this.bothSince >= this.cfg.bothHandsHoldMs) {
        this.armed = false;
        events.push({ type: 'gesture', name: 'both_hands_up' });
      }
      return;
    }
    if (tMs - this.bothLastSeen > this.cfg.bothHandsGapMs) this.bothSince = null;
    // Перевзвод: обе руки опущены ниже плеч.
    if (!this.armed && frame && this.handsBelowShoulders(frame)) this.armed = true;
  }

  private handsBelowShoulders(frame: PoseFrame): boolean {
    const torso = torsoLength(frame);
    const below = (hand: Hand) => {
      const w = frame.image[SIDES[hand].wrist];
      const s = frame.image[SIDES[hand].shoulder];
      // Невидимое запястье (опущено за край кадра или закрыто телом) тоже считаем опущенным.
      return !w || !s || w.v < this.cfg.minVisibility || w.y > s.y + this.cfg.rearmBelowShoulder * torso;
    };
    return below('left') && below('right');
  }
}

const round3 = (v: number) => Math.round(v * 1000) / 1000;
