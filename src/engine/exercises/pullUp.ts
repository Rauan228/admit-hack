// Подтягивания на турнике (E-39). Камера лицом, спиной или сбоку — меры вертикальные, ракурс не важен.
//
// Повтор засчитывается, только если человек правда на турнике и поднимает тело:
// 1. Плечи сближаются с хватом (кисти или перекладина) — «закрытие» в длинах руки.
// 2. И одновременно сами плечи поднимаются в кадре — «подъём», хотя бы на половину закрытия (камера в руках
//    может плыть, поэтому не один в один). Махи руками стоя дают закрытие без подъёма, прыжки с поднятыми
//    руками — подъём без закрытия, и то и другое — ноль.
// 3. Начать подтягивание можно только из виса: кисти выше плеч почти на длину руки (руки над головой,
//    тело под ними). Стоя с руками внизу — в бёрпи, приседе, жиме, отжиманиях — повтор не начнётся.
//    Руки над головой стоя по точкам не отличить от виса — отличают стопы: на турнике тело поднимается
//    целиком, щиколотки идут вверх вместе с плечами; стоя (присед, выпрыгивание, бёрпи) стопы на полу.
//    Видны щиколотки и почти не поднимаются, пока плечи идут вверх, — это не подтягивание.
//    И кисти держатся за перекладину: ушли вверх от положения виса (жим, рывок гири) — тоже не оно.
// 4. Анфас и спиной хват широкий — перекладина в кадре горизонтальная линия, её ищем по пикселям (bar.ts).
//    Нет линии у кистей — это не турник, прогресс ноль и подсказка «не вижу турник». Сбоку перекладина
//    смотрит в камеру торцом, там турник подтверждают пункты 1–2.
// Кисти в верхней точке модель видит плохо (перекрыты головой, смазаны): опора хвата держится с виса,
// а наверху её заменяет перекладина, если она найдена (со сдвигом «кисти − перекладина», без скачка).
// Повтор засчитываем, когда человек дошёл до верха и пошёл вниз (returned): вис до конца ждать не нужно —
// иначе последнее подтягивание перед тем, как спрыгнуть, терялось бы.

import { ENGINE_CONFIG, type Widen } from '../config';
import { barApplies } from '../bar';
import { clamp, dist2, pt, type PoseFrame } from '../geometry';
import { LM } from '../hints';
import type { RuleDef } from '../rules';
import type { Phase } from '../types';
import { SlidingMax } from './baseline';
import { joint2, seen } from './common';
import type { BaseMetrics, ExerciseDef, ExerciseMeter } from './types';

type PullUpConfig = Widen<typeof ENGINE_CONFIG.exercises.pull_up>;

export interface PullUpMetrics extends BaseMetrics {
  /** Плечи сблизились с хватом от виса, в длинах руки. */
  closing: number;
  /** Плечи поднялись в кадре от виса, в длинах руки. */
  rise: number;
  /** Человек на турнике: руки над головой и (анфас/спиной) перекладина в кадре. */
  onBar: boolean;
  /** Плечи ниже хвата, в длинах руки (в висе ~0,9–1,1). */
  hang: number;
  /** Щиколотки поднялись от виса, в длинах руки (null — не видны). */
  ankleRise: number | null;
  /** Почему не на турнике: перекладины не видно / руки не над головой / стопы стоят на полу. */
  why: 'no_bar' | 'hands_low' | 'feet_down' | null;
  /** Наибольший угол в локтях (2D), градусы — прямые ли руки в висе. null — не видно. */
  elbow: number | null;
  /** Таз относительно плеч по горизонтали, в длинах руки (раскачка). null — таз не виден. */
  hipX: number | null;
}

const SHOULDERS = [LM.leftShoulder, LM.rightShoulder] as const;
const WRISTS = [LM.leftWrist, LM.rightWrist] as const;

class PullUpMeter implements ExerciseMeter<PullUpMetrics> {
  /** Длина руки (плечо → локоть → кисть по кадру): наибольшая в висе. */
  private readonly arm: SlidingMax;
  /** Плечи в висе — самые низкие (наибольший y) за окно. */
  private readonly shoulderRest: SlidingMax;
  /** Расстояние плечи → хват в висе — наибольшее за окно. */
  private readonly gapRest: SlidingMax;
  /** Щиколотки в висе — самые низкие за окно. */
  private readonly ankleRest: SlidingMax;
  private anchorY: number | null = null;
  private lastBarAt = -Infinity;
  private lastBarY: number | null = null;
  /** Кисти минус перекладина по высоте — чтобы опора не прыгала при переходе с кистей на перекладину. */
  private barOffset = 0;
  /** Наибольший прогресс текущего повтора (для засчёта на спуске) и «взведён» ли счёт. */
  private peak = 0;
  private armed = true;
  private lastLift = 0;
  /** Когда человек последний раз был в висе (руки над головой на всю длину). */
  private lastHangAt = -Infinity;
  /** Кисти в висе (самые низкие за окно) — подъём кистей выше этого значит, что их не держит перекладина. */
  private readonly wristRest: SlidingMax;

  constructor(private readonly cfg: PullUpConfig) {
    this.arm = new SlidingMax(cfg.armWindowMs);
    this.shoulderRest = new SlidingMax(cfg.baselineWindowMs);
    this.gapRest = new SlidingMax(cfg.baselineWindowMs);
    this.ankleRest = new SlidingMax(cfg.baselineWindowMs);
    this.wristRest = new SlidingMax(cfg.baselineWindowMs);
  }

  measure(frame: PoseFrame, phase: Phase): PullUpMetrics | null {
    const sh = SHOULDERS.filter((i) => seen(frame, i, 0.5, 0.2)).map((i) => pt(frame, i));
    if (!sh.length) return null;
    const shoulderY = sh.reduce((a, p) => a + p.y, 0) / sh.length;
    const aspect = frame.aspect;
    const h = (a: { x: number; y: number }, b: { x: number; y: number }) =>
      Math.hypot((a.x - b.x) * aspect, a.y - b.y);

    // Длина руки — по сторонам, где видна вся рука.
    for (const [s, e, w] of [
      [LM.leftShoulder, LM.leftElbow, LM.leftWrist],
      [LM.rightShoulder, LM.rightElbow, LM.rightWrist],
    ] as const) {
      if ([s, e, w].every((i) => seen(frame, i, 0.5, 0.2)))
        this.arm.push(h(pt(frame, s), pt(frame, e)) + h(pt(frame, e), pt(frame, w)), frame.t);
    }
    const arm = this.arm.value;
    if (!arm || arm <= 0) return null;

    // Опора хвата: видимые кисти, иначе перекладина, иначе последняя известная.
    const wr = WRISTS.filter((i) => seen(frame, i, this.cfg.wristMinVisibility, 0.2)).map((i) =>
      pt(frame, i),
    );
    const bar = frame.bar;
    if (bar && bar.score >= this.cfg.barMinScore) {
      this.lastBarAt = frame.t;
      this.lastBarY = bar.y;
    }
    let wristsUp = 0;
    if (wr.length === 2) {
      this.anchorY = (wr[0]!.y + wr[1]!.y) / 2;
      // Кисти «в висе» — только когда руки над головой на всю длину: пока человек тянется к перекладине или
      // запрыгивает, кисти ниже, и эталон по ним потом принимал бы вис за поднятые руки.
      const sy = sh.reduce((s, q) => s + q.y, 0) / sh.length;
      if (phase === 'start' && (sy - this.anchorY) / arm >= this.cfg.hangMinGap)
        this.wristRest.push(this.anchorY, frame.t);
      const wRest = this.wristRest.value;
      if (wRest !== null) wristsUp = (wRest - this.anchorY) / arm;
      if (bar && bar.score >= this.cfg.barMinScore) this.barOffset = this.anchorY - bar.y;
    } else if (this.lastBarY !== null && frame.t - this.lastBarAt < this.cfg.barMemoryMs)
      this.anchorY = this.lastBarY + this.barOffset;
    if (this.anchorY === null) return null;

    const gap = shoulderY - this.anchorY;
    // Эталон виса обновляем только в исходном положении: на подъёме он не должен ползти за плечами.
    if (phase === 'start') {
      this.shoulderRest.push(shoulderY, frame.t);
      this.gapRest.push(gap, frame.t);
    }
    const restY = this.shoulderRest.value ?? shoulderY;
    const restGap = this.gapRest.value ?? gap;
    const closing = (restGap - gap) / arm;
    const rise = (restY - shoulderY) / arm;
    const an = [LM.leftAnkle, LM.rightAnkle]
      .filter((i) => seen(frame, i, 0.6, 0.02))
      .map((i) => pt(frame, i).y);
    let ankleRise: number | null = null;
    if (an.length) {
      const ankleY = an.reduce((a, b) => a + b, 0) / an.length;
      if (phase === 'start' && gap / arm >= this.cfg.hangMinGap) this.ankleRest.push(ankleY, frame.t);
      const rest = this.ankleRest.value;
      if (rest !== null) ankleRise = (rest - ankleY) / arm;
    }

    // На турнике ли: хват выше головы; анфас/спиной — перекладина у кистей за последние barMemoryMs.
    const nose = seen(frame, LM.nose, 0.3, 0.2) ? pt(frame, LM.nose).y : shoulderY - 0.2 * arm;
    const torso =
      seen(frame, LM.leftHip, 0.3, 0.3) && seen(frame, LM.rightHip, 0.3, 0.3)
        ? dist2(
            { x: ((pt(frame, 11).x + pt(frame, 12).x) / 2) * aspect, y: shoulderY },
            {
              x: ((pt(frame, 23).x + pt(frame, 24).x) / 2) * aspect,
              y: (pt(frame, 23).y + pt(frame, 24).y) / 2,
            },
          )
        : arm * 0.75;
    const raw = clamp(Math.min(closing, rise / this.cfg.minRiseShare) / this.cfg.fullLift, -0.5, 1.6);
    let why: PullUpMetrics['why'] = null;
    const hang = gap / arm;
    if (hang >= this.cfg.hangMinGap) this.lastHangAt = frame.t;
    // Не вис: хват ниже носа или руки не вытянуты над головой. Наверху нос и должен быть выше, поэтому —
    // только в исходном положении; начать подъём можно, лишь если только что был вис.
    if (
      raw < this.cfg.fsm.startMax &&
      (this.anchorY > nose || frame.t - this.lastHangAt > this.cfg.hangMemoryMs)
    )
      why = 'hands_low';
    else if (phase === 'start' && frame.t - this.lastHangAt > this.cfg.hangMemoryMs) why = 'hands_low';
    // Кисти ушли с перекладины (вверх — жим, или плечи сильно выше них — руки внизу): повтор отменяем.
    const handsOff = wristsUp > this.cfg.maxWristRise || hang < this.cfg.minTopGap;
    if (why === null && handsOff) why = 'hands_low';
    else if (
      why === null &&
      ankleRise !== null &&
      rise > this.cfg.feetCheckRise &&
      ankleRise < this.cfg.minAnkleShare * rise
    )
      why = 'feet_down';
    else if (
      why === null &&
      bar !== undefined &&
      barApplies(frame.image, aspect, torso) &&
      frame.t - this.lastBarAt >= this.cfg.barMemoryMs
    )
      why = 'no_bar';
    const onBar = why === null;

    const elbow = Math.max(
      joint2(frame, LM.leftShoulder, LM.leftElbow, LM.leftWrist) ?? -1,
      joint2(frame, LM.rightShoulder, LM.rightElbow, LM.rightWrist) ?? -1,
    );
    const shX = sh.length === 2 ? (sh[0]!.x + sh[1]!.x) / 2 : sh[0]!.x;
    const hipX =
      seen(frame, LM.leftHip, 0.4, 0.3) && seen(frame, LM.rightHip, 0.4, 0.3)
        ? (((pt(frame, LM.leftHip).x + pt(frame, LM.rightHip).x) / 2 - shX) * aspect) / arm
        : null;

    // Посреди повтора выяснилось, что это не подтягивание (кисти ушли с перекладины, турника нет), — повтор
    // отменяем, а не засчитываем возвратом к нулю. Стопы «на полу» посреди подъёма бывают и от сбоя модели
    // (щиколотки в тени) — тогда прогресс просто держим на прошлом значении.
    const midRep = phase !== 'start';
    const abort = midRep && (handsOff || why === 'no_bar');
    let lift = onBar ? raw : midRep && why === 'feet_down' ? this.lastLift : 0;
    if (abort) this.armed = false;
    // Засчёт на спуске: дошёл до верха и опустился на countDrop — повтор есть; следующий — только из виса.
    let returned = false;
    if (phase === 'start') this.peak = 0;
    else this.peak = Math.max(this.peak, lift);
    if (!this.armed) {
      // Взводим снова, только когда человек правда вернулся в вис (по самому движению, не по проверкам).
      if (raw < this.cfg.fsm.startMax) this.armed = true;
      else lift = 0;
    } else if (
      phase === 'up' &&
      this.peak >= this.cfg.fsm.bottomMin &&
      lift <= this.peak - this.cfg.countDrop
    ) {
      returned = true;
      this.armed = false;
    }
    this.lastLift = lift;
    return {
      progress: lift,
      returned,
      abort,
      hang,
      ankleRise,
      closing,
      rise,
      onBar,
      why,
      elbow: elbow >= 0 ? elbow : null,
      hipX,
    };
  }

  reset(): void {
    this.arm.reset();
    this.shoulderRest.reset();
    this.gapRest.reset();
    this.ankleRest.reset();
    this.wristRest.reset();
    this.anchorY = null;
    this.lastBarAt = -Infinity;
    this.lastBarY = null;
    this.barOffset = 0;
    this.peak = 0;
    this.armed = true;
    this.lastLift = 0;
    this.lastHangAt = -Infinity;
  }
}

export function pullUpRules(cfg: PullUpConfig = ENGINE_CONFIG.exercises.pull_up): RuleDef<PullUpMetrics>[] {
  return [
    // Не на турнике — счёт стоит, говорим почему.
    { code: 'no_bar', kind: 'frame', check: (m) => (m.why === 'no_bar' ? {} : null), holdMs: 1500 },
    {
      code: 'hands_low',
      kind: 'frame',
      check: (m) => (m.why === 'hands_low' || m.why === 'feet_down' ? {} : null),
      holdMs: 1500,
    },
    {
      code: 'chin_low',
      kind: 'rep',
      on: ['rep', 'attempt'],
      check: (c) =>
        c.summary.pMax < cfg.goodProgress ? { joints: [LM.nose, LM.leftWrist, LM.rightWrist] } : null,
    },
    {
      code: 'bent_hang',
      kind: 'rep',
      on: ['rep'],
      // Перед подъёмом руки так и не выпрямились — вис не полный.
      check: (c) => {
        const start = c.frames.slice(0, Math.max(3, Math.floor(c.frames.length / 3)));
        const best = Math.max(...start.map((m) => m.elbow ?? -1));
        return best >= 0 && best < cfg.minHangElbowDeg ? { joints: [LM.leftElbow, LM.rightElbow] } : null;
      },
    },
    {
      code: 'swing',
      kind: 'rep',
      on: ['rep'],
      check: (c) => {
        const xs = c.frames.map((m) => m.hipX).filter((x): x is number => x !== null);
        if (xs.length < 3) return null;
        return Math.max(...xs) - Math.min(...xs) > cfg.maxSwing
          ? { joints: [LM.leftHip, LM.rightHip] }
          : null;
      },
    },
  ];
}

export function createPullUp(
  cfg: PullUpConfig = ENGINE_CONFIG.exercises.pull_up,
): ExerciseDef<PullUpMetrics> {
  return {
    id: 'pull_up',
    requiredJoints: [LM.leftShoulder, LM.rightShoulder],
    // Руки весь подход над головой: жест «обе руки вверх» на подходе выключен.
    armsOverhead: true,
    needsBar: true,
    // Тело поднимается к кистям быстрее, чем общий фильтр правдоподобия считает возможным (принимал за «телепорт»).
    ownGate: true,
    fsm: cfg.fsm,
    createMeter: () => new PullUpMeter(cfg),
    rules: pullUpRules(cfg),
    lostHint: 'Встань так, чтобы в кадре были турник и ты от кистей до пояса',
  };
}
