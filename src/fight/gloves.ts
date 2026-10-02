// Перчатки для боя от первого лица: где на экране твои кулаки и насколько рука вынесена вперёд.
// По точкам кадра, без движка: перчатка идёт за кистью каждый кадр, а удар (rep движка) только добивает
// анимацию — punch() выбрасывает перчатку вперёд, даже если в этом кадре вынос не поймался.
//
// Координаты — от середины плеч в ширинах плеч, как у StanceTracker: x — вправо по экрану игры (твоя правая
// рука справа, камера зеркалит), y — вниз. ext — 0 стойка, 1 рука в ударе.
//
// Как виден удар в камеру (разбор 5 записей боксёров анфас, .cache/box): рука летит вдоль оси камеры и
// в кадре укорачивается — угол локтя в кадре врёт (в стойке скачет до 150–180°), глубина z кисти в момент
// удара тоже (модель теряет кулак, z прыгает «за спину»). Надёжно другое:
// - локоть поднимается к линии плеч: в стойке он висит на ~1 ширину плеч ниже, в прямом и боковом —
//   почти на уровне плеча (lift, главный сигнал);
// - кулак растёт в кадре относительно своего размера в стойке (grow) — когда локоть закрыт перчаткой;
// - глубина z кисти от своего уровня стойки (depth) — слабый, с меньшим весом.
// Вынос — больший из них, с мёртвой зоной: дрожание в стойке не двигает перчатку.
// Кисть сильно ниже плеч или над головой — это не удар.

import type { Landmark } from '../engine/types';

export type GloveSide = 'left' | 'right';

export interface Glove {
  x: number;
  y: number;
  ext: number;
  /** Кисть видна в этом кадре (иначе перчатка плавно уходит в стойку). */
  seen: boolean;
}

export type Gloves = Record<GloveSide, Glove>;

/** Составляющие выноса (для разбора записей и настройки). */
export interface GloveSignals {
  lift: number;
  grow: number;
  depth: number;
  center: number;
}

export const GLOVES = {
  minVisibility: 0.3,
  elbowVisibility: 0.4,
  /** Длина руки в ширинах плеч (без 3D-точек). */
  armPerShoulder: 1.55,
  /** Локоть: уровень стойки (ниже плеч, в ширинах плеч) держим в этих пределах; в ударе — на этом уровне. */
  elbowGuardMin: 0.6,
  elbowGuardMax: 1.5,
  elbowPunch: 0.2,
  /** Уровень локтя в стойке: вниз догоняет за столько мс, вверх (к удару) — медленно. */
  elbowDownTauMs: 300,
  elbowUpTauMs: 4000,
  /** Кулак больше своего размера в стойке в столько раз — начало и полный вынос. */
  growFrom: 1.35,
  growFull: 2.2,
  handTauMs: 2500,
  /** Глубина: вынос от стойки до прямой руки, в длинах руки, и её вес. */
  fullReach: 0.5,
  depthWeight: 0.6,
  guardTauMs: 1500,
  /** Кулак к середине: место в стойке (своя сторона, ширин плеч) — наружу догоняет быстро, внутрь — медленно. */
  sideOutTauMs: 300,
  sideInTauMs: 4000,
  sideMin: 0.45,
  /** «К середине» учитываем, только когда подъём локтя уже не меньше этого. */
  centerNeedsLift: 0.3,
  /** Мёртвая зона выноса: меньше — стойка. */
  deadZone: 0.15,
  /** Кисть ниже плеч больше чем на столько ширин плеч — рука опущена, вынос 0. */
  maxDrop: 1.0,
  /** Выше плеч больше чем на столько — рука над головой, тоже не удар. */
  maxRise: 1.4,
  /** Сглаживание положения и выноса, мс (вынос вперёд — быстрее, назад — мягче). */
  posTauMs: 35,
  extUpTauMs: 30,
  extDownTauMs: 110,
  /** Без кисти дольше — перчатка уходит в стойку. */
  lostMs: 300,
  /** Перчатка «была в ударе», если вынос дошёл до этого; удар движка в пределах recentPunchMs — тот же. */
  punchedExt: 0.6,
  recentPunchMs: 700,
  /** Добивка удара: вылет и возврат, мс. */
  punchOutMs: 90,
  punchBackMs: 260,
} as const;

/** Где перчатка в стойке (кулаки у подбородка). */
export const GUARD_POSE: Readonly<Record<GloveSide, Glove>> = {
  left: { x: -0.45, y: -0.35, ext: 0, seen: false },
  right: { x: 0.45, y: -0.35, ext: 0, seen: false },
};

const LS = 11;
const RS = 12;
const ARM = {
  left: { shoulder: LS, elbow: 13, wrist: 15, index: 19, pinky: 17 },
  right: { shoulder: RS, elbow: 14, wrist: 16, index: 20, pinky: 18 },
} as const;

interface SideState {
  x: number;
  y: number;
  ext: number;
  /** Уровни стойки: глубина, локоть ниже плеч, размер кулака. */
  depth0: number | null;
  elbow0: number | null;
  hand0: number | null;
  side0: number | null;
  lastSeen: number;
  punchAt: number;
  /** Когда перчатка последний раз сама была в ударе (ext ≥ punchedExt). */
  extAt: number;
  sig: GloveSignals;
}

export class GloveTracker {
  private readonly s: Record<GloveSide, SideState> = {
    left: fresh('left'),
    right: fresh('right'),
  };
  private lastT: number | null = null;

  update(lms: readonly Landmark[], t: number, aspect = 16 / 9): Gloves {
    const dt = this.lastT === null ? 0 : Math.max(0, Math.min(200, t - this.lastT));
    this.lastT = t;
    const ls = lms[LS];
    const rs = lms[RS];
    const body = seen(ls) && seen(rs);
    const sw = body ? Math.hypot((ls.x - rs.x) * aspect, ls.y - rs.y) : 0;
    for (const side of ['left', 'right'] as const) {
      const st = this.s[side];
      const target =
        body && sw > 0 ? this.measure(lms, side, aspect, sw, (ls.x + rs.x) / 2, (ls.y + rs.y) / 2, dt) : null;
      if (target) st.lastSeen = t;
      const lost = !target && t - st.lastSeen > GLOVES.lostMs;
      const goal = target ?? (lost ? GUARD_POSE[side] : { x: st.x, y: st.y, ext: st.ext });
      const kp = ease(dt, lost ? 200 : GLOVES.posTauMs);
      st.x += (goal.x - st.x) * kp;
      st.y += (goal.y - st.y) * kp;
      const ke = ease(dt, goal.ext > st.ext ? GLOVES.extUpTauMs : GLOVES.extDownTauMs);
      st.ext += (goal.ext - st.ext) * ke;
      if (st.ext >= GLOVES.punchedExt) st.extAt = t;
    }
    return this.read(t);
  }

  /**
   * Засчитанный удар (rep движка). Движок засчитывает удар, когда рука уже вернулась (~0,3 с позже), — если
   * перчатка только что сама была в ударе, второй раз её не выбрасываем (иначе «фантомный» удар после
   * настоящего). Добиваем, только если вынос не поймался. Возвращает бьющую руку.
   */
  punch(t: number, side?: GloveSide): GloveSide {
    const recent = (s: GloveSide) => t - this.s[s].extAt <= GLOVES.recentPunchMs;
    const hand =
      side ??
      (recent('left') || recent('right')
        ? this.s.left.extAt >= this.s.right.extAt
          ? 'left'
          : 'right'
        : this.s.left.ext >= this.s.right.ext
          ? 'left'
          : 'right');
    if (!recent(hand)) this.s[hand].punchAt = t;
    return hand;
  }

  /** Перчатки сейчас: сглаженное положение плюс добивка удара. */
  read(t: number): Gloves {
    const out = {} as Gloves;
    for (const side of ['left', 'right'] as const) {
      const st = this.s[side];
      const p = punchPulse(t - st.punchAt);
      out[side] = {
        x: st.x,
        y: st.y,
        ext: Math.max(st.ext, p),
        seen: t - st.lastSeen <= GLOVES.lostMs,
      };
    }
    return out;
  }

  /** Составляющие выноса в последнем кадре. */
  signals(side: GloveSide): GloveSignals {
    return this.s[side].sig;
  }

  reset(): void {
    this.s.left = fresh('left');
    this.s.right = fresh('right');
    this.lastT = null;
  }

  private measure(
    lms: readonly Landmark[],
    side: GloveSide,
    aspect: number,
    sw: number,
    mx: number,
    my: number,
    dt: number,
  ): { x: number; y: number; ext: number } | null {
    const a = ARM[side];
    const w = lms[a.wrist];
    const s = lms[a.shoulder];
    if (!seen(w) || !seen(s)) return null;
    const st = this.s[side];
    const x = (-(w.x - mx) * aspect) / sw;
    const y = (w.y - my) / sw;
    const atShoulders = y <= GLOVES.maxDrop && y >= -GLOVES.maxRise;

    // Локоть к линии плеч — от своего уровня в стойке.
    let lift = 0;
    const e = lms[a.elbow];
    if (e && e.v >= GLOVES.elbowVisibility) {
      const drop = (e.y - s.y) / sw;
      if (atShoulders) {
        if (st.elbow0 === null) st.elbow0 = drop;
        else
          st.elbow0 +=
            (drop - st.elbow0) * ease(dt, drop > st.elbow0 ? GLOVES.elbowDownTauMs : GLOVES.elbowUpTauMs);
        st.elbow0 = clamp(st.elbow0, GLOVES.elbowGuardMin, GLOVES.elbowGuardMax);
      }
      const base = st.elbow0 ?? GLOVES.elbowGuardMin;
      lift = (base - drop) / Math.max(0.4, base - GLOVES.elbowPunch);
    }

    // Кулак растёт в кадре — от своего размера в стойке (медленное среднее, удары его почти не двигают).
    let grow = 0;
    const ix = lms[a.index];
    const pk = lms[a.pinky];
    if (ix && pk && ix.v >= 0.2 && pk.v >= 0.2) {
      const size =
        (Math.hypot((ix.x - w.x) * aspect, ix.y - w.y) + Math.hypot((pk.x - w.x) * aspect, pk.y - w.y)) / sw;
      if (size > 0) {
        if (st.hand0 === null) st.hand0 = size;
        else if (size < st.hand0 * GLOVES.growFrom)
          st.hand0 += (size - st.hand0) * ease(dt, GLOVES.handTauMs);
        grow = (size / st.hand0 - GLOVES.growFrom) / (GLOVES.growFull - GLOVES.growFrom);
      }
    }

    // Глубина z от своего уровня стойки (слабый сигнал).
    const d = ((s.z - w.z) * aspect) / (sw * GLOVES.armPerShoulder);
    if (atShoulders) {
      if (st.depth0 === null || d < st.depth0) st.depth0 = d;
      else st.depth0 += (d - st.depth0) * ease(dt, GLOVES.guardTauMs);
    }
    const depth = st.depth0 === null ? 0 : ((d - st.depth0) / GLOVES.fullReach) * GLOVES.depthWeight;

    // Кулак уходит к середине (линии носа) от своего места в стойке — прямой и боковой в камеру.
    const out = side === 'left' ? -x : x; // своя сторона — положительная
    let center = 0;
    if (atShoulders) {
      if (st.side0 === null) st.side0 = out;
      else st.side0 += (out - st.side0) * ease(dt, out > st.side0 ? GLOVES.sideOutTauMs : GLOVES.sideInTauMs);
      const base = Math.max(GLOVES.sideMin, st.side0);
      center = (base - out) / base;
    }

    st.sig = { lift: clamp01(lift), grow: clamp01(grow), depth: clamp01(depth), center: clamp01(center) };
    // Подъём локтя — главный сигнал; «к середине» только добирает вынос, когда локоть уже пошёл вверх:
    // в стойке вполоборота передняя рука и так у середины.
    const { lift: l, center: c } = st.sig;
    const raw = !atShoulders ? 0 : l >= GLOVES.centerNeedsLift ? Math.max(l, c) : l;
    const ext = clamp01((raw - GLOVES.deadZone) / (1 - GLOVES.deadZone));
    return { x, y, ext };
  }
}

/** Добивка удара: быстро вперёд, мягко назад (0…1). */
export function punchPulse(ms: number): number {
  if (!(ms >= 0)) return 0;
  if (ms < GLOVES.punchOutMs) return Math.sin(((ms / GLOVES.punchOutMs) * Math.PI) / 2);
  const back = (ms - GLOVES.punchOutMs) / GLOVES.punchBackMs;
  return back >= 1 ? 0 : 1 - back * back;
}

function fresh(side: GloveSide): SideState {
  const g = GUARD_POSE[side];
  return {
    x: g.x,
    y: g.y,
    ext: 0,
    depth0: null,
    elbow0: null,
    hand0: null,
    side0: null,
    lastSeen: -Infinity,
    punchAt: -Infinity,
    extAt: -Infinity,
    sig: { lift: 0, grow: 0, depth: 0, center: 0 },
  };
}

function seen(p: Landmark | undefined): p is Landmark {
  return !!p && p.v >= GLOVES.minVisibility;
}

const ease = (dt: number, tau: number) => (dt <= 0 ? 1 : 1 - Math.exp(-dt / tau));
const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
const clamp01 = (v: number) => clamp(v, 0, 1);

export type Framing = 'ok' | 'none' | 'close' | 'low' | 'elbows';

/** Подсказка для кадра (бокс от первого лица): удар виден по локтям — они должны быть в кадре. */
export const FRAMING_HINT: Record<Exclude<Framing, 'ok'>, string> = {
  none: 'Тебя не видно — встань перед камерой по пояс',
  close: 'Отойди на шаг назад — ты слишком близко к камере',
  low: 'Плечи у нижнего края — опусти камеру или отойди',
  elbows: 'Отойди на шаг: в кадре нужны оба локтя',
};

/** Хорош ли кадр для боя: плечи не у нижнего края, оба локтя видны, человек не вплотную. */
export function framing(lms: readonly Landmark[], aspect = 16 / 9): Framing {
  const ls = lms[LS];
  const rs = lms[RS];
  if (!seen(ls) || !seen(rs)) return lms.length ? 'low' : 'none';
  if ((ls.y + rs.y) / 2 > 0.72) return 'low';
  // Ширина плеч в долях высоты кадра: больше — человек вплотную (в записях вблизи модель теряет руки).
  if (Math.hypot((ls.x - rs.x) * aspect, ls.y - rs.y) > 0.5) return 'close';
  const elbowOk = (p: Landmark | undefined) => !!p && p.v >= 0.5 && p.y < 0.97;
  if (!elbowOk(lms[13]) || !elbowOk(lms[14])) return 'elbows';
  return 'ok';
}
