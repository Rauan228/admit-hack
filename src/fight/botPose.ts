// Позы бота для боя от первого лица (U-25): процедурно из стойки эталона бокса, по состоянию бота (fight.ts).
// Эталон умеет только джеб и кросс в пустоту; здесь — живой боец: покачивается в стойке, закрывается
// глухим блоком, опускает руки, замахивается (джеб — коротко, мощный — широко: корпус закручен, задняя
// рука у уха — это видно и можно поймать), бьёт в тебя (кулак летит в камеру), проваливается после
// промаха, «плывёт», когда потрясён, дёргает головой от твоих попаданий. U-26: уходит от твоих ударов
// (уклон влево-вправо, нырок, отход), пружинит на носках и ходит по рингу челноком — шаги в фазе подскока.
//
// Координаты — как в athleteMotion.json: метры, y вниз, лицом к зрителю −z, x+ — левая сторона бота.
// Корпус выше таза поворачиваем вокруг середины таза (закрутка, наклон вперёд, вбок), руки — двухзвенные
// (IK, длины из эталона): задаём кисть, локоть считаем. Параметры сглаживаются по времени, так что
// переходы между состояниями плавные, а удары остаются быстрыми.

import { athletePose } from '../ui/lib/athlete';
import type { AttackKind, BotView, Side } from './fight';

export type V3 = { x: number; y: number; z: number };

export interface BotPoseInput {
  now: number;
  bot: BotView;
  /** Куда бить — твоя голова (камера) в координатах бота; null — прямо вперёд. */
  aim: V3 | null;
  /** Твой удар попал: когда, какой рукой (с твоей стороны), в корпус ли. */
  hurt: { at: number; side: Side; low: boolean } | null;
  /** Бот принял твой удар на перчатки. */
  blockedAt: number;
  /** Нокаут 0…1 — руки опускаются. */
  ko: number;
}

export interface BotPoseOut {
  pose: (V3 | null)[];
  /** Шаг вперёд (к тебе), м: удары, отход и перемещение по рингу. */
  step: number;
  /** Сдвиг вбок по рингу, м (x+ — его левая сторона). */
  x: number;
  /** Подскок над полом, м. */
  lift: number;
}

/** Ринг для бота: насколько далеко ходит вбок, вперёд и назад, м; скорость, м/с. */
const RING = { x: 0.55, zIn: 0.14, zOut: -0.42, speed: 0.85 };
/** Подскок: период, мс; высота в стойке и в движении, м. */
const HOP = { periodMs: 440, rest: 0.018, moving: 0.034 };

/** Длины плеча и предплечья эталона, м; вытянутая рука чуть короче суммы. */
const UPPER = 0.3;
const FORE = 0.27;
const REACH = UPPER + FORE - 0.015;

/** Набор параметров позы — его и сглаживаем. */
interface Params {
  twist: number;
  lean: number;
  side: number;
  crouch: number;
  step: number;
  headBack: number;
  headTurn: number;
  /** Кисти (в координатах бота) и направление кулака. */
  lw: V3;
  rw: V3;
  lf: V3;
  rf: V3;
  /** Локти: куда сгиб (вниз-наружу или в сторону — боковой). */
  lPole: V3;
  rPole: V3;
  /** Уклон вбок — сдвиг всего бота, м. */
  slipX: number;
  /** На носках: пятки подняты, м. */
  heel: number;
}

const BASE = athletePose('boxing', 0).map((p) => (p ? { ...p } : null));
const LS0 = BASE[11]!;
const RS0 = BASE[12]!;
const HIP = mid(BASE[23]!, BASE[24]!);

/** Места кистей относительно плеча (в стойке без поворота): стойка, глухой блок, руки опущены. */
const OFF = {
  guard: { left: sub(BASE[15]!, LS0), right: sub(BASE[16]!, RS0) },
  shell: { left: v(-0.1, -0.17, -0.12), right: v(0.04, -0.17, -0.27) },
  open: { left: v(0.05, 0.25, -0.05), right: v(-0.04, 0.25, -0.08) },
};
/** Кулак в стойке — вперёд и вверх; в блоке — вверх; опущен — вперёд-вниз. */
const FIST = {
  guard: norm(v(0, -0.7, -0.7)),
  shell: v(0, -1, -0.15),
  open: norm(v(0, 0.4, -0.9)),
};
const POLE_DOWN = { left: v(0.6, 1, 0.25), right: v(-0.6, 1, 0.25) };
const POLE_OUT = { left: v(1, 0.15, 0.2), right: v(-1, 0.15, 0.2) };

export class BotPoser {
  private p: Params | null = null;
  private lastT = 0;
  /** Где бот на ринге (сдвиг от центра), скорость, фаза подскока, высота подскока. */
  private x = 0;
  private z = 0;
  private vx = 0;
  private vz = 0;
  private hop = 0;
  private hopAmp: number = HOP.rest;

  /** Поза в момент input.now. */
  update(input: BotPoseInput): BotPoseOut {
    const want = target(input);
    const dt = this.p ? Math.min(100, Math.max(0, input.now - this.lastT)) : 0;
    this.lastT = input.now;
    // Удар, уклон и замах — быстро, остальное — мягко.
    const st = input.bot.state;
    const tau = st === 'strike' ? 22 : st === 'dodge' ? 35 : st === 'windup' ? 55 : 90;
    this.p = this.p ? blend(this.p, want, 1 - Math.exp(-dt / tau)) : want;
    const air = this.footwork(input, dt);
    // Приземление — колени пружинят.
    const land = 0.016 * (1 - air) * (this.hopAmp / HOP.moving);
    return {
      pose: build({ ...this.p, crouch: this.p.crouch + land }),
      step: this.p.step + this.z,
      x: this.x + this.p.slipX,
      lift: this.hopAmp * air,
    };
  }

  reset(): void {
    this.p = null;
    this.x = this.z = this.vx = this.vz = this.hop = 0;
    this.hopAmp = HOP.rest;
  }

  /**
   * Перемещение по рингу: к цели хода (кружит, сближается, отходит) с разгоном; подскок на носках, шаг — в
   * основном в воздухе (челнок). Замах, удар, уклон, потрясение — ноги стоят. Возвращает долю «в воздухе» 0…1.
   */
  private footwork(input: BotPoseInput, dt: number): number {
    const st = input.bot.state;
    const planted = st === 'windup' || st === 'strike' || st === 'dodge' || st === 'stagger' || input.ko > 0;
    const move = input.bot.move ?? 'hold';
    const tx = move === 'circle_left' ? RING.x : move === 'circle_right' ? -RING.x : this.x;
    // Сближается, отходит — или потихоньку к своей дистанции.
    const tz = move === 'in' ? RING.zIn : move === 'out' ? RING.zOut : this.z + (-0.05 - this.z) * 0.5;
    const max = planted ? 0.12 : RING.speed;
    const want = (d: number) => clamp(d * 2.6, -max, max);
    const k = 1 - Math.exp(-dt / 140);
    this.vx += (want(tx - this.x) - this.vx) * k;
    this.vz += (want(tz - this.z) - this.vz) * k;
    // Подскок: пружинит всегда, в движении — выше; стоя в замахе и ударе — нет.
    this.hop += (dt / HOP.periodMs) * Math.PI;
    const air = Math.abs(Math.sin(this.hop));
    const speed = Math.hypot(this.vx, this.vz);
    const amp = planted
      ? 0
      : st === 'open'
        ? HOP.moving
        : HOP.rest + (HOP.moving - HOP.rest) * clamp01(speed / 0.5);
    this.hopAmp += (amp - this.hopAmp) * (1 - Math.exp(-dt / 120));
    const glide = 0.35 + 0.65 * air;
    this.x = clamp(this.x + this.vx * (dt / 1000) * glide, -RING.x, RING.x);
    this.z = clamp(this.z + this.vz * (dt / 1000) * glide, RING.zOut, RING.zIn);
    return air;
  }
}

/** Куда стремится поза сейчас (без сглаживания). */
function target(input: BotPoseInput): Params {
  const { now, bot } = input;
  const u =
    bot.until > bot.since && Number.isFinite(bot.until)
      ? clamp01((now - bot.since) / (bot.until - bot.since))
      : 0;
  // Покачивание в стойке: вверх-вниз и с ноги на ногу.
  const bob = Math.sin(now / 210);
  const sway = Math.sin(now / 470);
  const p: Params = {
    twist: 0.04 * sway,
    lean: 0.03,
    side: 0.035 * sway,
    crouch: 0.012 * (1 + bob),
    step: 0,
    headBack: 0,
    headTurn: 0,
    lw: { ...OFF.guard.left },
    rw: { ...OFF.guard.right },
    lf: FIST.guard,
    rf: FIST.guard,
    lPole: POLE_DOWN.left,
    rPole: POLE_DOWN.right,
    slipX: 0,
    heel: 0.028,
  };
  // Перчатки в стойке чуть ходят — живой боец.
  p.lw = add(p.lw, v(0, 0.012 * Math.sin(now / 260), 0.015 * Math.sin(now / 330)));
  p.rw = add(p.rw, v(0, 0.012 * Math.sin(now / 290 + 1), 0.012 * Math.sin(now / 310 + 2)));

  switch (bot.state) {
    case 'guard':
      break;
    case 'shell':
      p.lw = { ...OFF.shell.left };
      p.rw = { ...OFF.shell.right };
      p.lf = p.rf = FIST.shell;
      p.crouch = 0.05 + 0.01 * bob;
      p.lean = 0.12;
      p.twist = 0.08 * Math.sin(now / 160);
      break;
    case 'open': {
      // Руки опущены, пританцовывает, голова качается — дразнит.
      p.lw = add(OFF.open.left, v(0, 0.02 * bob, 0));
      p.rw = add(OFF.open.right, v(0, -0.02 * bob, 0));
      p.lf = p.rf = FIST.open;
      p.lean = -0.04;
      p.side = 0.07 * Math.sin(now / 300);
      p.headTurn = 0.12 * Math.sin(now / 300);
      p.crouch = 0.02 * (1 + Math.sin(now / 150));
      break;
    }
    case 'stagger': {
      // Поплыл: откинулся, руки наполовину опущены, качается.
      const w = Math.sin(now / 140);
      p.lw = lerp(OFF.guard.left, OFF.open.left, 0.7);
      p.rw = lerp(OFF.guard.right, OFF.open.right, 0.7);
      p.lf = p.rf = FIST.open;
      p.lean = -0.14 + 0.05 * w;
      p.side = 0.1 * Math.sin(now / 230);
      p.headBack = 0.25 + 0.08 * w;
      p.headTurn = 0.15 * Math.sin(now / 190);
      p.crouch = 0.05;
      p.step = -0.12 * (1 - u);
      break;
    }
    case 'windup':
      p.heel = 0.012;
      if (bot.attack) windup(p, bot.attack.kind, bot.attack.side, u);
      break;
    case 'strike':
      p.heel = 0.02;
      if (bot.attack) strike(p, bot.attack.kind, bot.attack.side, ease(u), input.aim);
      break;
    case 'dodge': {
      // Уклон: быстро ушёл, подержал, вернулся; руки плотнее к лицу.
      const e = u < 0.3 ? smooth(u / 0.3) : u > 0.72 ? smooth((1 - u) / 0.28) : 1;
      p.lw = lerp(p.lw, OFF.shell.left, 0.35 * e);
      p.rw = lerp(p.rw, OFF.shell.right, 0.35 * e);
      p.heel = 0.012;
      switch (bot.dodge) {
        case 'slip_left':
        case 'slip_right': {
          const d = bot.dodge === 'slip_left' ? 1 : -1;
          p.side += d * 0.3 * e;
          p.twist += d * 0.12 * e;
          p.crouch += 0.06 * e;
          p.headTurn += d * 0.1 * e;
          p.slipX = d * 0.1 * e;
          break;
        }
        case 'duck':
          p.crouch += 0.2 * e;
          p.lean += 0.38 * e;
          p.headBack -= 0.1 * e;
          break;
        case 'back':
          p.lean -= 0.3 * e;
          p.step -= 0.22 * e;
          p.headBack += 0.12 * e;
          p.crouch += 0.02 * e;
          break;
      }
      break;
    }
    case 'recover':
      if (bot.attack) {
        // Возврат из удара в стойку; долгий (промах) — провалился вперёд.
        const ext = params0();
        strike(ext, bot.attack.kind, bot.attack.side, 1, input.aim);
        const k = smooth(Math.min(1, u * 1.6));
        Object.assign(p, blend(ext, p, k));
        if (bot.until - bot.since > 700) p.lean += 0.12 * (1 - k);
      }
      break;
  }
  // Твоё попадание: голова и корпус дёргаются от удара (~0,35 с).
  if (input.hurt) {
    const t = now - input.hurt.at;
    if (t >= 0 && t < 350) {
      const k = Math.exp(-t / 110) * Math.min(1, t / 25);
      if (input.hurt.low) {
        p.lean += 0.22 * k;
        p.crouch += 0.05 * k;
      } else {
        p.headBack += 0.45 * k;
        p.lean -= 0.12 * k;
        // Твоя левая (слева на экране) попадает ему в правую сторону лица — голова уходит влево по экрану.
        p.headTurn += (input.hurt.side === 'left' ? 0.35 : -0.35) * k;
      }
      p.step -= 0.08 * k;
    }
  }
  // Принял на перчатки: их отбрасывает к лицу.
  const tb = now - input.blockedAt;
  if (tb >= 0 && tb < 220) {
    const k = Math.exp(-tb / 70);
    p.lw = add(p.lw, v(0, 0, 0.06 * k));
    p.rw = add(p.rw, v(0, 0, 0.06 * k));
    p.lean -= 0.05 * k;
  }
  // Устал (U-27): перчатки ниже, корпус наклонён вперёд, плечи ходят от тяжёлого дыхания.
  const f = bot.fatigue ?? 0;
  if (
    f > 0 &&
    (bot.state === 'guard' || bot.state === 'open' || bot.state === 'recover' || bot.state === 'shell')
  ) {
    const breath = Math.sin(now / 340);
    p.lw = add(p.lw, v(0, 0.08 * f + 0.012 * f * breath, -0.02 * f));
    p.rw = add(p.rw, v(0, 0.08 * f + 0.012 * f * breath, -0.02 * f));
    p.lean += 0.07 * f;
    p.crouch += 0.025 * f + 0.012 * f * breath;
    p.headBack -= 0.06 * f;
  }
  if (input.ko > 0) {
    const k = clamp01(input.ko * 1.5);
    p.lw = lerp(p.lw, v(0.08, 0.5, 0.05), k);
    p.rw = lerp(p.rw, v(-0.08, 0.5, 0.05), k);
    p.lf = p.rf = v(0, 1, 0);
    p.headBack += 0.5 * k;
  }
  return p;
}

/** Замах: джеб — короткий отвод и присед, мощный — закрутка корпуса назад, рука отведена (открыт). */
function windup(p: Params, kind: AttackKind, side: Side, u: number): void {
  const k = smooth(u);
  const dir = side === 'left' ? 1 : -1;
  if (kind === 'jab') {
    p.twist += -0.12 * k;
    p.crouch += 0.035 * k;
    p.lw = add(p.lw, v(0.02 * k, 0.03 * k, 0.05 * k));
    p.step = -0.03 * k;
    return;
  }
  // Мощный: корпус закручен от удара, откинулся, бьющая рука отведена назад к уху (правой) или вбок
  // (левый боковой), вторая рука опущена — открыт.
  p.twist += dir * -0.42 * k;
  p.lean += -0.1 * k;
  p.crouch += 0.06 * k;
  p.step = -0.1 * k;
  if (side === 'right') {
    p.rw = lerp(p.rw, v(-0.02, -0.12, 0.15), k);
    p.rf = norm(lerp(FIST.guard, v(0, -0.5, -1), k));
    p.lw = lerp(p.lw, lerp(OFF.guard.left, OFF.open.left, 0.55), k);
  } else {
    p.lw = lerp(p.lw, v(0.2, -0.04, 0.05), k);
    p.lPole = POLE_OUT.left;
    p.lf = norm(lerp(FIST.guard, v(-1, 0, -0.4), k));
    p.rw = lerp(p.rw, lerp(OFF.guard.right, OFF.open.right, 0.45), k);
  }
  p.headTurn += dir * 0.1 * k;
}

/**
 * Удар в тебя: рука вытягивается к цели (aim — в координатах бота), корпус докручивается, шаг вперёд.
 * Кисть задаём относительно плеча, но плечо после закрутки другое — поэтому смещение считаем в build.
 */
function strike(p: Params, kind: AttackKind, side: Side, k: number, aim: V3 | null): void {
  const dir = side === 'left' ? 1 : -1;
  const power = kind === 'power';
  const hook = power && side === 'left';
  p.twist = (power ? 0.55 : 0.22) * dir * k + (power ? -0.42 * dir * (1 - k) : 0);
  p.lean = 0.03 + (power ? 0.16 : 0.07) * k;
  p.crouch = 0.02 + 0.02 * k;
  p.step = (power ? 0.42 : 0.26) * k;
  // Цель — в координатах бота; переводим в «смещение от плеча в стойке» (корпус поворачивает build).
  const shoulder = side === 'left' ? LS0 : RS0;
  const goal = aim ?? v(shoulder.x * 0.3, shoulder.y + 0.05, -2);
  // Плечо в момент удара (после закрутки и наклона), чтобы кулак шёл в цель.
  const sh = torso(shoulder, p.twist, p.lean, p.side, p.crouch);
  const d = norm(sub(goal, sh));
  const hit = add(sh, scale(d, REACH));
  const off = untorso(hit, p.twist, p.lean, p.side, p.crouch);
  const rel = sub(off, shoulder);
  const from = side === 'left' ? p.lw : p.rw;
  let w: V3;
  if (hook) {
    // Боковой — по дуге снаружи.
    const ctrl = add(lerp(from, rel, 0.5), v(0.22, 0.02, 0.1));
    w = bezier(from, ctrl, rel, k);
  } else w = lerp(from, rel, k);
  const fist = norm(lerp(FIST.guard, untorsoDir(d, p.twist, p.lean, p.side), Math.min(1, k * 1.4)));
  if (side === 'left') {
    p.lw = w;
    p.lf = fist;
    if (hook) p.lPole = POLE_OUT.left;
  } else {
    p.rw = w;
    p.rf = fist;
  }
  // Вторая рука — у подбородка (защита), на мощном чуть ниже.
  if (power) {
    if (side === 'left') p.rw = lerp(OFF.guard.right, OFF.open.right, 0.15);
    else p.lw = lerp(OFF.guard.left, OFF.open.left, 0.2);
  }
  p.headTurn = -dir * 0.08 * k;
}

/** Поза из параметров: корпус выше таза повёрнут, руки по IK, ноги согнуты на присед. */
function build(p: Params): (V3 | null)[] {
  const out = BASE.map((q) => (q ? { ...q } : null));
  const T = (q: V3) => torso(q, p.twist, p.lean, p.side, p.crouch);
  // Ноги: таз опускается на присед, колени уходят вперёд; стопы на месте (шаг — сдвиг всего бота снаружи).
  for (const i of [23, 24]) out[i] = { ...out[i]!, y: out[i]!.y + p.crouch };
  for (const i of [25, 26])
    out[i] = { ...out[i]!, y: out[i]!.y + p.crouch * 0.5, z: out[i]!.z - p.crouch * 0.8 };
  // На носках: лодыжки и пятки приподняты, носки на полу.
  for (const i of [27, 28, 29, 30]) if (out[i]) out[i] = { ...out[i]!, y: out[i]!.y - p.heel };
  const ls = T(LS0);
  const rs = T(RS0);
  out[11] = ls;
  out[12] = rs;
  // Голова: с корпусом, плюс свой наклон назад и поворот (вокруг шеи).
  const neck = mid(ls, rs);
  for (const i of [0, 7, 8]) {
    let q = T(BASE[i]!);
    q = rotAround(q, neck, p.headTurn, -p.headBack * 0.6);
    out[i] = q;
  }
  arm(out, 'left', ls, add(ls, rotDir(p.lw, p)), rotDir(p.lf, p), rotDir(p.lPole, p));
  arm(out, 'right', rs, add(rs, rotDir(p.rw, p)), rotDir(p.rf, p), rotDir(p.rPole, p));
  return out;
}

function arm(out: (V3 | null)[], side: Side, s: V3, w: V3, fist: V3, pole: V3): void {
  const [ei, wi, pi, ii] = side === 'left' ? [13, 15, 17, 19] : [14, 16, 18, 20];
  const e = solveElbow(s, w, pole);
  // Кисть, до которой рука дотянулась (цель дальше — рука прямая).
  const reached = add(e, scale(norm(sub(w, e)), FORE));
  const f = add(reached, scale(norm(fist), 0.08));
  out[ei] = e;
  out[wi] = reached;
  out[pi] = f;
  out[ii] = { ...f };
}

/** Локоть двухзвенной руки: плечо s, кисть w, сгиб в сторону pole. */
function solveElbow(s: V3, w: V3, pole: V3): V3 {
  const d = sub(w, s);
  const len = Math.min(Math.max(length(d), 1e-4), UPPER + FORE - 1e-4);
  const u = norm(d);
  const cos = clamp((UPPER * UPPER + len * len - FORE * FORE) / (2 * UPPER * len), -1, 1);
  const sin = Math.sqrt(1 - cos * cos);
  const n = norm(sub(pole, scale(u, dot(pole, u))));
  return add(s, add(scale(u, UPPER * cos), scale(n, UPPER * sin)));
}

/**
 * Корпус: точка выше таза — закрутка (вокруг вертикали), наклон вперёд, вбок; присед опускает. Шаг сюда
 * не входит — его делает бот целиком (и цель aim уже в его координатах после шага).
 */
function torso(q: V3, twist: number, lean: number, side: number, crouch: number): V3 {
  const r = rotDir(sub(q, HIP), { twist, lean, side });
  return { x: HIP.x + r.x, y: HIP.y + r.y + crouch, z: HIP.z + r.z };
}

/** Обратное к torso. */
function untorso(q: V3, twist: number, lean: number, side: number, crouch: number): V3 {
  const r = unrotDir({ x: q.x - HIP.x, y: q.y - HIP.y - crouch, z: q.z - HIP.z }, { twist, lean, side });
  return add(HIP, r);
}

/** Направление: закрутка (y), наклон вперёд (x), вбок (z). */
function rotDir(d: V3, p: { twist: number; lean: number; side: number }): V3 {
  // Вбок: вокруг z.
  let { x, y, z } = d;
  let c = Math.cos(p.side);
  let s = Math.sin(p.side);
  [x, y] = [x * c - y * s, x * s + y * c];
  // Наклон вперёд: вокруг x (голова уходит к −z).
  c = Math.cos(p.lean);
  s = Math.sin(p.lean);
  [y, z] = [y * c - z * s, y * s + z * c];
  // Закрутка: вокруг y (левое плечо — вперёд при twist > 0).
  c = Math.cos(p.twist);
  s = Math.sin(p.twist);
  [x, z] = [x * c + z * s, -x * s + z * c];
  return { x, y, z };
}

function unrotDir(d: V3, p: { twist: number; lean: number; side: number }): V3 {
  let { x, y, z } = d;
  let c = Math.cos(-p.twist);
  let s = Math.sin(-p.twist);
  [x, z] = [x * c + z * s, -x * s + z * c];
  c = Math.cos(-p.lean);
  s = Math.sin(-p.lean);
  [y, z] = [y * c - z * s, y * s + z * c];
  c = Math.cos(-p.side);
  s = Math.sin(-p.side);
  [x, y] = [x * c - y * s, x * s + y * c];
  return { x, y, z };
}

const untorsoDir = (d: V3, twist: number, lean: number, side: number) => unrotDir(d, { twist, lean, side });

/** Поворот точки вокруг центра: turn — вокруг вертикали, tilt — кивок (назад при tilt < 0). */
function rotAround(q: V3, c: V3, turn: number, tilt: number): V3 {
  return add(c, rotDir(sub(q, c), { twist: turn, lean: tilt, side: 0 }));
}

function params0(): Params {
  return {
    twist: 0,
    lean: 0.03,
    side: 0,
    crouch: 0.012,
    step: 0,
    headBack: 0,
    headTurn: 0,
    lw: { ...OFF.guard.left },
    rw: { ...OFF.guard.right },
    lf: FIST.guard,
    rf: FIST.guard,
    lPole: POLE_DOWN.left,
    rPole: POLE_DOWN.right,
    slipX: 0,
    heel: 0.028,
  };
}

function blend(a: Params, b: Params, k: number): Params {
  const n = (x: number, y: number) => x + (y - x) * k;
  return {
    twist: n(a.twist, b.twist),
    lean: n(a.lean, b.lean),
    side: n(a.side, b.side),
    crouch: n(a.crouch, b.crouch),
    step: n(a.step, b.step),
    headBack: n(a.headBack, b.headBack),
    headTurn: n(a.headTurn, b.headTurn),
    lw: lerp(a.lw, b.lw, k),
    rw: lerp(a.rw, b.rw, k),
    lf: lerp(a.lf, b.lf, k),
    rf: lerp(a.rf, b.rf, k),
    lPole: lerp(a.lPole, b.lPole, k),
    rPole: lerp(a.rPole, b.rPole, k),
    slipX: n(a.slipX, b.slipX),
    heel: n(a.heel, b.heel),
  };
}

function bezier(a: V3, c: V3, b: V3, t: number): V3 {
  const u = 1 - t;
  return add(add(scale(a, u * u), scale(c, 2 * u * t)), scale(b, t * t));
}

function v(x: number, y: number, z: number): V3 {
  return { x, y, z };
}
function add(a: V3, b: V3): V3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}
function sub(a: V3, b: V3): V3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}
function scale(a: V3, k: number): V3 {
  return { x: a.x * k, y: a.y * k, z: a.z * k };
}
function dot(a: V3, b: V3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}
function length(a: V3): number {
  return Math.sqrt(dot(a, a));
}
function norm(a: V3): V3 {
  const l = length(a) || 1;
  return scale(a, 1 / l);
}
function lerp(a: V3, b: V3, k: number): V3 {
  return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, z: a.z + (b.z - a.z) * k };
}
function mid(a: V3, b: V3): V3 {
  return lerp(a, b, 0.5);
}
const clamp = (x: number, a: number, b: number) => (x < a ? a : x > b ? b : x);
const clamp01 = (x: number) => clamp(x, 0, 1);
const smooth = (x: number) => {
  const t = clamp01(x);
  return t * t * (3 - 2 * t);
};
/** Удар: быстрый разгон и дотяг (ease-out). */
const ease = (x: number) => 1 - (1 - clamp01(x)) ** 2.4;
