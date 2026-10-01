// Чистая кинематика атлета (как выпады и подъём рук): ровное тело build-ghost.mjs, плавные кривые, ни шума, ни
// дрожи. Видео — только образец позы и темпа. Оси: y вниз (пол — y = 0), лицом к зрителю — −z (вперёд),
// левая сторона человека — знак body.side по x.

const V = (x, y, z) => ({ x, y, z });
const add = (a, b, k = 1) => V(a.x + b.x * k, a.y + b.y * k, a.z + b.z * k);
const sub = (a, b) => V(a.x - b.x, a.y - b.y, a.z - b.z);
const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const len = (a) => Math.hypot(a.x, a.y, a.z);
const norm = (a) => {
  const l = len(a) || 1;
  return V(a.x / l, a.y / l, a.z / l);
};
const lerp = (a, b, k) => a + (b - a) * k;
const lerpV = (a, b, k) => V(lerp(a.x, b.x, k), lerp(a.y, b.y, k), lerp(a.z, b.z, k));
const rad = (d) => (d * Math.PI) / 180;
export const ease = (x) => {
  const c = Math.min(1, Math.max(0, x));
  return c * c * (3 - 2 * c);
};
/** Плавнее ease: нулевые скорость и ускорение на концах. */
const ease5 = (x) => {
  const c = Math.min(1, Math.max(0, x));
  return c * c * c * (c * (c * 6 - 15) + 10);
};
/** Отрезок [a, b] шкалы u → 0..1 с плавностью. */
const seg = (u, a, b, f = ease) => f((u - a) / (b - a));

/** Наклон вперёд вокруг оси x через pivot: точка над pivot уходит вперёд (−z). */
function pitch(p, pivot, deg) {
  const c = Math.cos(rad(deg));
  const s = Math.sin(rad(deg));
  const y = p.y - pivot.y;
  const z = p.z - pivot.z;
  return V(p.x, pivot.y + y * c - z * s, pivot.z + y * s + z * c);
}
/** Поворот вокруг вертикали через pivot: +deg — левая сторона (знак side) уходит назад (+z). */
function yaw(p, pivot, deg, side) {
  const a = rad(deg) * side;
  const c = Math.cos(a);
  const s = Math.sin(a);
  const x = p.x - pivot.x;
  const z = p.z - pivot.z;
  return V(pivot.x + x * c - z * s, p.y, pivot.z + x * s + z * c);
}
/** Наклон вбок через pivot в сторону toward (знак x): точка над pivot уходит к toward. */
function roll(p, pivot, deg, toward) {
  const c = Math.cos(rad(deg));
  const s = Math.sin(rad(deg));
  const x = p.x - pivot.x;
  const y = p.y - pivot.y;
  return V(pivot.x + x * c - y * toward * s, pivot.y + y * c + x * toward * s, p.z);
}

/** Средний сустав двухзвенной цепочки от R к цели T; изгиб — в сторону pole. */
function ik(R, T, a, b, pole) {
  const d0 = sub(T, R);
  const d = Math.min(len(d0), (a + b) * 0.9995);
  const axis = norm(d0);
  const along = (a * a - b * b + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, a * a - along * along));
  const pp = norm(sub(pole, V(axis.x * dot(pole, axis), axis.y * dot(pole, axis), axis.z * dot(pole, axis))));
  return { mid: add(add(R, axis, along), pp, h), end: add(R, axis, d) };
}

const SIDES = [
  { k: 'l', sh: 11, el: 13, wr: 15, fing: [17, 19, 21], hp: 23, kn: 25, an: 27, he: 29, to: 31, ear: 7 },
  { k: 'r', sh: 12, el: 14, wr: 16, fing: [18, 20, 22], hp: 24, kn: 26, an: 28, he: 30, to: 32, ear: 8 },
];
const UPPER = [0, 7, 8, 11, 12];

/** Контекст тела: стороны со знаком x и ровная стойка. */
function kit(body) {
  const sgn = { l: body.side, r: -body.side };
  const S = { l: { ...SIDES[0], s: sgn.l }, r: { ...SIDES[1], s: sgn.r } };
  const stand = () => body.pts.map((p) => ({ ...p }));
  const pelvis = V(0, body.hipY, 0);

  /** Стопа плоско на полу: щиколотка A, носок развёрнут наружу на turn°, подъём пятки heel (м). */
  const foot = (pts, L, A, turn = 8, heel = 0) => {
    const out = V(L.s * Math.sin(rad(turn)), 0, -Math.cos(rad(turn))); // носок: вперёд и наружу
    pts[L.an] = A;
    pts[L.to] = V(A.x + out.x * 0.17, 0, A.z + out.z * 0.17);
    pts[L.he] = V(A.x - out.x * 0.05, -heel, A.z - out.z * 0.05);
  };
  /** Нога от таза к щиколотке A: колено выводим вперёд и чуть наружу (по носку). */
  const leg = (pts, L, A, out = 0.25) => {
    const r = ik(pts[L.hp], A, body.thigh, body.shin, V(L.s * out, 0, -1));
    pts[L.kn] = r.mid;
    return r.end;
  };
  /** Рука по цели: локоть — в сторону pole. */
  const armTo = (pts, L, W, pole, fingerDir) => {
    const r = ik(pts[L.sh], W, body.upperArm, body.forearm, pole);
    pts[L.el] = r.mid;
    pts[L.wr] = r.end;
    const f = fingerDir ? norm(fingerDir) : norm(sub(r.end, r.mid));
    for (const j of L.fing) pts[j] = add(r.end, f, 0.08);
  };
  /** Прямая рука из плеча по направлению dir. */
  const armDir = (pts, L, dir) => {
    const d = norm(dir);
    pts[L.el] = add(pts[L.sh], d, body.upperArm);
    pts[L.wr] = add(pts[L.sh], d, body.upperArm + body.forearm);
    for (const j of L.fing) pts[j] = add(pts[L.sh], d, body.upperArm + body.forearm + 0.08);
  };
  /** Руки на поясе (как в выпадах): ладони на гребнях таза, локти в стороны и чуть назад. */
  const handsOnHips = (pts, L) => {
    const hip = pts[L.hp];
    const W = V(hip.x + L.s * 0.085, hip.y - 0.1, hip.z + 0.015);
    armTo(pts, L, W, V(L.s, 0, 0.5), V(-L.s * 0.3, 0.4, -1));
  };
  /** Верх тела (голова, плечи) — через функцию f. */
  const upper = (pts, f) => {
    for (const i of UPPER) pts[i] = f(pts[i]);
  };
  return { S, stand, pelvis, foot, leg, armTo, armDir, handsOnHips, upper };
}

/** Талия: изгибы корпуса — от неё, а не от тазобедренного сустава (иначе верх «перекручивается» доской). */
const waist = (body, dx = 0, dy = 0) => V(dx, body.hipY - 0.2 + dy, 0);

/** Прямая рука в сагиттальной плоскости под углом a от «вниз» (вперёд — +, назад — −), длины как в приседе. */
function sagArm(pts, sh, el, wr, fing, a) {
  const s = pts[sh];
  const d = V(0, Math.cos(a), -Math.sin(a));
  pts[el] = add(s, d, 0.3);
  pts[wr] = add(s, d, 0.57);
  for (const j of fing) pts[j] = add(s, d, 0.65);
}

/** Кадр позы в момент u (0..1) из функции pose(u) — n кадров цикла. */
const cycle = (n, pose) => Array.from({ length: n }, (_, k) => pose(k / n));

/** Упор лёжа строится от носков — ставим середину тела (между плечами и щиколотками) в центр кадра. */
function centerZ(frames) {
  const zs = frames.map((pts) => (pts[11].z + pts[12].z + pts[27].z + pts[28].z) / 4);
  const c = zs.reduce((a, b) => a + b, 0) / zs.length;
  return frames.map((pts) => pts.map((p) => ({ ...p, z: p.z - c })));
}

// ——— Приседания с вариациями: на основе записанного приседа ———

/** Кадр приседа в доле p цикла (0 — стоя, 0.5 — внизу) с интерполяцией. */
function squatAt(sq, p) {
  const n = sq.length;
  const u = (((p % 1) + 1) % 1) * n;
  const i = Math.floor(u) % n;
  const j = (i + 1) % n;
  const k = u - Math.floor(u);
  return sq[i].map((a, q) => lerpV(a, sq[j][q], k));
}
/** Самая глубокая точка записанного приседа (доля цикла). */
function squatBottom(sq) {
  let best = -Infinity;
  let bi = 0;
  sq.forEach((pts, i) => {
    const d = (pts[23].y + pts[24].y) / 2;
    if (d > best) {
      best = d;
      bi = i;
    }
  });
  return bi / sq.length;
}

/**
 * Присед с выпрыгиванием: тот же присед (руки вперёд для баланса); на выходе — мах вверх и тройное
 * разгибание (таз, колени, голеностоп), полёт по параболе с вытянутыми носками и лёгким подбором коленей,
 * приземление с носка в амортизацию и снова стойка.
 */
export function jumpSquat(sq, n) {
  const bot = squatBottom(sq);
  const HOP = 0.24;
  const L1 = dist(sq[0][23], sq[0][25]);
  const L2 = dist(sq[0][25], sq[0][27]);
  return cycle(n, (u) => {
    let pts;
    let lift = 0;
    let point = 0; // носки вниз
    let tuck = 0; // подбор коленей в полёте
    let arm; // угол рук, град
    if (u < 0.42) {
      const k = ease(u / 0.42);
      pts = squatAt(sq, bot * k);
      arm = lerp(15, 80, k); // как в приседе: руки вперёд для баланса
    } else if (u < 0.54) {
      const k = seg(u, 0.42, 0.54, (x) => x * (2 - x));
      pts = squatAt(sq, bot + (1 - bot) * k);
      arm = lerp(80, 150, k);
      point = Math.max(0, (k - 0.6) / 0.4);
    } else if (u < 0.78) {
      const t = (u - 0.54) / 0.24;
      pts = squatAt(sq, 0);
      lift = HOP * 4 * t * (1 - t);
      point = 1 - 0.7 * seg(t, 0.6, 1);
      tuck = Math.sin(Math.PI * t) ** 1.5;
      arm = lerp(150, 60, ease(t));
    } else if (u < 0.9) {
      const k = Math.sin((Math.PI / 2) * seg(u, 0.78, 0.9, (x) => x));
      pts = squatAt(sq, bot * 0.42 * k);
      arm = lerp(60, 40, k);
      point = 0.3 * (1 - k);
    } else {
      const k = seg(u, 0.9, 1, ease5);
      pts = squatAt(sq, bot * 0.42 * (1 - k));
      arm = lerp(40, 15, k);
    }
    pts = pts.map((p) => ({ ...p, y: p.y - lift }));
    sagArm(pts, 11, 13, 15, [17, 19, 21], rad(arm));
    sagArm(pts, 12, 14, 16, [18, 20, 22], rad(arm));
    for (const [hp, kn, an, he, to] of [
      [23, 25, 27, 29, 31],
      [24, 26, 28, 30, 32],
    ]) {
      if (tuck > 0) {
        // В полёте стопы подтягиваются к тазу, колени выходят вперёд.
        const H = pts[hp];
        const A0 = pts[an];
        const A = V(A0.x, A0.y - 0.16 * tuck, A0.z + 0.05 * tuck);
        const r = ik(H, A, L1, L2, V(0, 0, -1));
        const off = sub(r.end, A0);
        pts[kn] = r.mid;
        for (const j of [an, he, to]) pts[j] = add(pts[j], off);
      }
      if (point > 0) {
        // Стопа вытягивается: пятка вверх, носок вниз — поворот вокруг щиколотки.
        const A = pts[an];
        pts[he] = V(pts[he].x, A.y - 0.02 - 0.03 * point, pts[he].z + 0.02 * point);
        pts[to] = V(pts[to].x, lerp(pts[to].y, A.y + 0.15, point), lerp(pts[to].z, A.z - 0.08, point));
      }
    }
    return pts;
  });
}

/** Присед + руки вверх: тот же присед, потом прямые руки через перёд над головой и обратно. */
export function squatPress(sq, n) {
  const arm = (pts, sh, el, wr, fing, a) => {
    const s = pts[sh];
    const d = V(0, Math.cos(a), -Math.sin(a));
    pts[el] = add(s, d, 0.3);
    pts[wr] = add(s, d, 0.57);
    for (const j of fing) pts[j] = add(s, d, 0.65);
  };
  return cycle(n, (u) => {
    if (u < 0.56) return squatAt(sq, ease(u / 0.56));
    const pts = squatAt(sq, 0);
    // Руки: 15° (как в приседе) → 176° над головой → обратно.
    const w = u < 0.76 ? seg(u, 0.56, 0.76, ease5) : u < 0.8 ? 1 : 1 - seg(u, 0.8, 0.97, ease5);
    const a = rad(15 + 161 * w);
    for (const i of [11, 12]) pts[i] = { ...pts[i], y: pts[i].y - 0.035 * w * w };
    arm(pts, 11, 13, 15, [17, 19, 21], a);
    arm(pts, 12, 14, 16, [18, 20, 22], a);
    return pts;
  });
}

// ——— Стоя: руки ———

/** Круги руками: прямые руки в стороны, большие плавные круги вперёд; подъём и опускание как в «подъёме рук». */
export function armCircles(body, n) {
  const K = kit(body);
  const CIRCLES = 3;
  return cycle(n, (u) => {
    const pts = K.stand();
    // 0–0.15 руки через стороны до горизонтали, 0.15–0.85 три круга, 0.85–1 вниз.
    const raise = u < 0.15 ? seg(u, 0, 0.15, ease5) : u < 0.85 ? 1 : 1 - seg(u, 0.85, 1, ease5);
    const t = Math.max(0, Math.min(1, (u - 0.15) / 0.7));
    const phase = 2 * Math.PI * CIRCLES * ease(t);
    // Размах круга нарастает и спадает, чтобы вход и выход были без рывка.
    const r = rad(26) * Math.sin(Math.PI * t) ** 0.6;
    for (const L of [K.S.l, K.S.r]) {
      const base = rad(12 + 78 * raise); // от вертикали вниз к горизонтали
      const up = r * Math.sin(phase);
      const fwd = r * Math.cos(phase);
      const a = base + up;
      K.armDir(pts, L, V(L.s * Math.sin(a) * Math.cos(fwd), Math.cos(a), -Math.sin(fwd) * raise));
    }
    return pts;
  });
}

/**
 * Наклоны в стороны по очереди (как на примере): руки на поясе; наклон от талии в сторону — противоположная
 * рука через сторону уходит над головой и тянется в ту же сторону, рука со стороны наклона скользит по бедру
 * вниз; таз чуть смещается в противоположную сторону. Возврат, руки на пояс, то же в другую сторону.
 */
export function sideBend(body, n) {
  const K = kit(body);
  const MAX = 44;
  const reach = body.upperArm + body.forearm;
  const pose = (u, T, O) => {
    // T — сторона наклона (рука скользит по бедру), O — рука над головой.
    const d =
      u < 0.1
        ? 0
        : u < 0.48
          ? seg(u, 0.1, 0.48, ease5)
          : u < 0.6
            ? 1
            : u < 0.94
              ? 1 - seg(u, 0.6, 0.94, ease5)
              : 0;
    const pts = K.stand();
    const hipShift = O.s * 0.05 * d;
    for (const p of pts) if (p.y < body.hipY + 0.01) p.x += hipShift;
    const pv = waist(body, hipShift);
    // Позвоночник: плечи — на полный угол, голова чуть больше.
    for (const i of [11, 12]) pts[i] = roll(pts[i], pv, MAX * d, T.s);
    for (const i of [0, 7, 8]) pts[i] = roll(pts[i], pv, MAX * d * 1.18, T.s);
    // Рука со стороны наклона: с пояса скользит вниз по внешней стороне бедра.
    const onHip = pts.map((q) => ({ ...q }));
    K.handsOnHips(onHip, T);
    const kneeOut = V(pts[T.kn].x + T.s * 0.07, pts[T.kn].y - 0.08, pts[T.kn].z - 0.02);
    const Wt = lerpV(onHip[T.wr], kneeOut, 0.62 * d);
    K.armTo(pts, T, Wt, V(T.s, -0.2, 0.4), V(0, 1, -0.1));
    // Рука над головой: с пояса (0) — через сторону вверх и дальше за голову в сторону наклона.
    const hipPose = pts.map((q) => ({ ...q }));
    K.handsOnHips(hipPose, O);
    const a = rad(lerp(40, 198, d)); // от «вниз» на стороне O; > 180 — за голову к стороне T
    const dir = roll(V(O.s * Math.sin(a), Math.cos(a), 0), V(0, 0, 0), MAX * d, T.s);
    const Wo = add(pts[O.sh], dir, reach * 0.96);
    const mid = pts.map((q) => ({ ...q }));
    K.armTo(mid, O, Wo, V(-O.s * 0.2, -1, 0.35), dir);
    const k = seg(d, 0, 0.3); // сначала рука отрывается от пояса, потом идёт дугой
    for (const j of [O.el, O.wr, ...O.fing]) pts[j] = lerpV(hipPose[j], mid[j], k);
    return pts;
  };
  return cycle(n, (u) => (u < 0.5 ? pose(u * 2, K.S.r, K.S.l) : pose(u * 2 - 1, K.S.l, K.S.r)));
}

// ——— Стоя: ноги ———

/** Отведение прямой ноги в сторону по очереди: руки на поясе, корпус ровно, колено прямое. */
export function sideLegRaise(body, n) {
  const K = kit(body);
  const MAX = 42;
  const pose = (u, L, O) => {
    const pts = K.stand();
    const w =
      u < 0.1
        ? 0
        : u < 0.45
          ? seg(u, 0.1, 0.45, ease5)
          : u < 0.55
            ? 1
            : u < 0.9
              ? 1 - seg(u, 0.55, 0.9, ease5)
              : 0;
    // Вес на опорную ногу: таз чуть смещается к ней, корпус слегка к опорной стороне.
    const shift = 0.035 * ease(Math.min(1, u / 0.1)) * (u < 0.9 ? 1 : 1 - seg(u, 0.9, 1));
    for (const p of pts) if (p.y < body.hipY + 0.01) p.x += O.s * shift;
    K.upper(pts, (p) => roll(p, V(O.s * shift, body.hipY, 0), 4 * w, O.s));
    // Опорная нога — прямо на месте.
    const aO = V(body.pts[O.an].x, -body.ankleH, 0);
    K.leg(pts, O, aO);
    K.foot(pts, O, aO);
    // Рабочая нога: прямая, в сторону на угол MAX·w, носок вперёд.
    const a = rad(MAX * w);
    const H = pts[L.hp];
    const legLen = body.thigh + body.shin;
    const dir = V(L.s * Math.sin(a), Math.cos(a), 0);
    const A = add(H, dir, legLen * 0.995);
    pts[L.kn] = add(H, dir, body.thigh);
    pts[L.an] = A;
    pts[L.to] = add(A, V(L.s * 0.02, body.ankleH * Math.cos(a) * 0.9, -0.16));
    pts[L.he] = add(A, V(-L.s * 0.01, body.ankleH, 0.05));
    K.handsOnHips(pts, K.S.l);
    K.handsOnHips(pts, K.S.r);
    return pts;
  };
  return cycle(n, (u) => (u < 0.5 ? pose(u * 2, K.S.r, K.S.l) : pose(u * 2 - 1, K.S.l, K.S.r)));
}

/** Подъём на носки: стопы параллельно на ширине таза, колени прямые, пятки вверх, пауза, плавно вниз. */
export function calfRaise(body, n) {
  const K = kit(body);
  const LIFT = 0.1;
  return cycle(n, (u) => {
    const w = u < 0.32 ? seg(u, 0, 0.32, ease5) : u < 0.52 ? 1 : u < 0.88 ? 1 - seg(u, 0.52, 0.88, ease5) : 0;
    const up = LIFT * w;
    const pts = K.stand().map((p) => ({ ...p, y: p.y - up }));
    for (const L of [K.S.l, K.S.r]) {
      const x = body.pts[L.an].x;
      // Носок на полу, щиколотка поднимается: стопа поворачивается вокруг носка.
      const toe = V(x, 0, -0.17);
      const A = V(x, -body.ankleH - up, -0.01 * w);
      pts[L.an] = A;
      pts[L.to] = toe;
      pts[L.he] = V(x, -up * 1.15, 0.05 - 0.02 * w);
      K.leg(pts, L, A, 0);
      // Руки свободно вдоль тела.
      K.armDir(pts, L, V(L.s * 0.12, 1, 0.02));
    }
    return pts;
  });
}

/**
 * Боковые выпады: широкая стойка, таз уходит в сторону и вниз, колено над носком, вторая нога прямая и
 * неподвижна, стопы на полу; корпус чуть вперёд, ладони вместе у груди. Сначала в одну сторону, потом в другую.
 */
export function sideLunge(body, n) {
  const K = kit(body);
  const W = 0.5; // щиколотки от центра, м
  const SHIFT = 0.24;
  const reach = (body.thigh + body.shin) * 0.99;
  const pose = (u, L) => {
    const d =
      u < 0.08
        ? 0
        : u < 0.45
          ? seg(u, 0.08, 0.45, ease5)
          : u < 0.58
            ? 1
            : u < 0.95
              ? 1 - seg(u, 0.58, 0.95, ease5)
              : 0;
    const pts = K.stand();
    // Таз уходит к согнутой ноге; высота — такая, чтобы вторая нога была ровно прямой до стопы на полу.
    const dx = L.s * SHIFT * d;
    const h = W - body.hipHalf + SHIFT * d;
    const hipH = body.ankleH + Math.sqrt(reach * reach - h * h);
    const dy = -hipH - body.hipY;
    for (const p of pts)
      if (p.y < body.hipY + 0.01) {
        p.x += dx;
        p.y += dy;
      }
    const pv = V(dx, body.hipY + dy, 0);
    K.upper(pts, (p) => pitch(p, pv, 6 + 20 * d));
    for (const S of [K.S.l, K.S.r]) {
      const A = V(S.s * W, -body.ankleH, 0);
      K.leg(pts, S, A, S === L ? 0.5 : 0.25);
      K.foot(pts, S, A, 18);
    }
    // Ладони вместе у груди.
    const sh = lerpV(pts[11], pts[12], 0.5);
    for (const S of [K.S.l, K.S.r]) {
      const Wr = add(sh, V(S.s * 0.03, 0.2, -0.26));
      K.armTo(pts, S, Wr, V(S.s, 0.4, 0.3), V(-S.s * 0.5, -1, -0.3));
    }
    return pts;
  };
  return cycle(n, (u) => (u < 0.5 ? pose(u * 2, K.S.l) : pose(u * 2 - 1, K.S.r)));
}

/**
 * Бокс (как на примере): боковая стойка — левая нога впереди, колено согнуто, правая отставлена назад,
 * корпус развёрнут левым плечом к цели. Защита: кулаки у подбородка, локти вниз и прижаты. Джеб — левая рука
 * прямо к цели на высоте плеча, правый кулак у щеки; кросс — правая прямо вперёд с разворотом корпуса и правой
 * пятки, левый кулак возвращается к подбородку. Лёгкое пружинение.
 */
export function boxing(body, n) {
  const K = kit(body);
  const L = K.S.l;
  const R = K.S.r;
  const reach = body.upperArm + body.forearm;
  return cycle(n, (u) => {
    const out = (x) => 1 - (1 - x) ** 3;
    const jab = u < 0.09 ? out(u / 0.09) : u < 0.24 ? 1 - seg(u, 0.09, 0.24) : 0;
    const cross = u < 0.38 ? 0 : u < 0.5 ? out((u - 0.38) / 0.12) : u < 0.68 ? 1 - seg(u, 0.5, 0.68) : 0;
    const bounce = 0.012 * (0.5 - 0.5 * Math.cos(2 * Math.PI * 2 * u));
    const pts = K.stand();
    // Стойка: таз ниже (колени согнуты), между стоп, развёрнут левым боком вперёд.
    const drop = 0.08 + bounce;
    const pz = 0.02;
    const hipYaw = -28 + 22 * cross;
    const chestYaw = -42 + 58 * cross - 6 * jab;
    const pv = V(0, body.hipY + drop, pz);
    for (const p of pts)
      if (p.y < body.hipY + 0.01) {
        p.y += drop;
        p.z += pz;
      }
    for (const i of [23, 24]) pts[i] = yaw(pts[i], pv, hipYaw, body.side);
    const wv = waist(body, 0, drop);
    for (const i of UPPER) pts[i] = yaw(pts[i], V(wv.x, wv.y, pz), chestYaw, body.side);
    // Подбородок чуть вниз, к груди.
    for (const i of [0, 7, 8]) pts[i] = add(pts[i], V(0, 0.02, 0.01));
    // Ноги: левая впереди (носок почти к цели), правая сзади (носок наружу, на кроссе пятка вверх).
    const aL = V(L.s * 0.1, -body.ankleH, -0.32);
    const aR = V(R.s * 0.2, -body.ankleH - 0.035 * cross, 0.28);
    K.leg(pts, L, aL, 0.3);
    K.leg(pts, R, aR, 0.45);
    K.foot(pts, L, aL, 12);
    K.foot(pts, R, aR, 50 - 25 * cross, 0.03 + 0.07 * cross);
    // Защита: левый кулак впереди подбородка, правый — у правой щеки; локти вниз к корпусу.
    const chin = add(lerpV(pts[7], pts[8], 0.5), V(0, 0.15, -0.02));
    const fwd = V(0, 0, -1);
    const guardL = add(chin, V(L.s * 0.05, 0.02, -0.2));
    const guardR = add(chin, V(R.s * 0.09, -0.01, -0.08));
    const punch = (S, k, G) => {
      const Sh = pts[S.sh];
      const tgt = V(Sh.x * 0.25, Sh.y + 0.02, -0.95);
      const T = add(Sh, norm(sub(tgt, Sh)), reach * 0.99);
      const W = lerpV(G, T, k);
      K.armTo(pts, S, W, V(S.s * 0.35, 1, 0.3), k > 0.5 ? fwd : V(0, -1, -0.4));
    };
    punch(L, jab, guardL);
    punch(R, cross, guardR);
    return pts;
  });
}

/**
 * Локоть к колену стоя (как на примере): руки за головой, локти широко в стороны. Правое колено высоко вверх
 * и чуть к центру, корпус от талии скручивается и сгибается — левый локоть навстречу колену; потом левое
 * колено и правый локоть. Опорная нога прямая, таз чуть к опорной ноге.
 */
export function kneeToElbow(body, n) {
  const K = kit(body);
  const pose = (u, knee, elbow) => {
    const w =
      u < 0.08
        ? 0
        : u < 0.42
          ? seg(u, 0.08, 0.42, ease5)
          : u < 0.52
            ? 1
            : u < 0.9
              ? 1 - seg(u, 0.52, 0.9, ease5)
              : 0;
    const pts = K.stand();
    const stand = knee === K.S.r ? K.S.l : K.S.r;
    const shift = stand.s * 0.03 * w;
    for (const p of pts) if (p.y < body.hipY + 0.01) p.x += shift;
    const pv = waist(body, shift);
    // Корпус от талии: скручивание локтем к колену, наклон вперёд и вбок к колену.
    const twist = 34 * w * (elbow === K.S.l ? 1 : -1);
    K.upper(pts, (p) => {
      let q = yaw(p, pv, twist, body.side);
      q = pitch(q, pv, 28 * w);
      return roll(q, pv, 16 * w, knee.s);
    });
    // Опорная нога прямая.
    const aS = V(body.pts[stand.an].x, -body.ankleH, 0);
    K.leg(pts, stand, aS);
    K.foot(pts, stand, aS);
    // Рабочая нога: бедро вперёд-вверх до ~115° и к центру, голень почти вертикально, носок вниз.
    const H = pts[knee.hp];
    const fl = rad(115 * w);
    const ad = rad(22 * w);
    const thighDir = norm(V(-knee.s * Math.sin(ad), Math.cos(fl), -Math.sin(fl) * Math.cos(ad)));
    const Kn = add(H, thighDir, body.thigh);
    const shinDir = norm(V(-knee.s * 0.04 * w, 1, 0.22 * w));
    const A = add(Kn, shinDir, body.shin);
    pts[knee.kn] = Kn;
    pts[knee.an] = A;
    pts[knee.to] = add(A, V(0, body.ankleH * (1 - 0.3 * w) + 0.05 * w, -0.16 + 0.07 * w));
    pts[knee.he] = add(A, V(0, body.ankleH - 0.03 * w, 0.05));
    // Руки за головой: ладони на затылке, локти широко в стороны; рабочий локоть на касании смотрит
    // вниз-вперёд, к поднятому колену (движок засчитывает касание, когда локоть и колено сошлись).
    const back = add(lerpV(pts[7], pts[8], 0.5), V(0, 0.01, 0.09));
    for (const S of [K.S.l, K.S.r]) {
      const Wr = add(back, V(S.s * 0.05, 0, 0));
      const hint =
        S === elbow ? lerpV(V(S.s, -0.15, -0.25), V(-S.s * 0.1, 1.3, -0.7), w) : V(S.s, -0.15, -0.25);
      K.armTo(pts, S, Wr, hint, V(-S.s, 0.2, 0.3));
    }
    return pts;
  };
  return cycle(n, (u) => (u < 0.5 ? pose(u * 2, K.S.r, K.S.l) : pose(u * 2 - 1, K.S.l, K.S.r)));
}

/**
 * Высокие колени: бег на месте — колени по очереди до уровня пояса, опорная нога на носке, лёгкое
 * пружинение; руки согнуты под 90° и работают как при беге — навстречу колену противоположная рука.
 */
export function highKnees(body, n) {
  const K = kit(body);
  return cycle(n, (u) => {
    const ph = 2 * Math.PI * u;
    const liftL = Math.max(0, Math.sin(ph)) ** 1.2;
    const liftR = Math.max(0, -Math.sin(ph)) ** 1.2;
    const hop = 0.035 * Math.abs(Math.sin(2 * ph)) ** 0.8;
    const pts = K.stand().map((p) => ({ ...p, y: p.y - hop }));
    for (const [S, lift] of [
      [K.S.l, liftL],
      [K.S.r, liftR],
    ]) {
      const H = pts[S.hp];
      if (lift > 0.02) {
        const fl = rad(92 * lift);
        const Kn = add(H, V(0, Math.cos(fl), -Math.sin(fl)), body.thigh);
        const A = add(Kn, norm(V(0, 1, 0.3 * lift)), body.shin);
        pts[S.kn] = Kn;
        pts[S.an] = A;
        pts[S.to] = add(A, V(0, body.ankleH + 0.04 * lift, -0.15 + 0.05 * lift));
        pts[S.he] = add(A, V(0, body.ankleH - 0.02, 0.05));
      } else {
        // Опорная — на носке, пятка чуть поднята.
        const A = V(H.x, -body.ankleH - hop - 0.03, 0);
        K.leg(pts, S, A);
        pts[S.an] = A;
        pts[S.to] = V(A.x + S.s * 0.02, 0, -0.16);
        pts[S.he] = V(A.x, -0.05 - hop, 0.04);
      }
    }
    // Руки как в беге: правая вперёд, когда левое колено вверх.
    for (const [S, k] of [
      [K.S.l, Math.sin(ph + Math.PI)],
      [K.S.r, Math.sin(ph)],
    ]) {
      const a = rad(10 + 38 * k);
      const Sh = pts[S.sh];
      const d = V(S.s * 0.08, Math.cos(a), -Math.sin(a));
      const E = add(Sh, norm(d), body.upperArm);
      const f = norm(V(-S.s * 0.1, -Math.sin(a) + 0.15, -Math.cos(a)));
      pts[S.el] = E;
      pts[S.wr] = add(E, f, body.forearm);
      for (const j of S.fing) pts[j] = add(E, f, body.forearm + 0.07);
    }
    return pts;
  });
}

/**
 * «Звёздочка» с перекрёстом: прыжок — ноги широко, прямые руки в стороны на уровне плеч; прыжок — ноги
 * скрещены (одна перед другой), руки скрещены перед грудью; сверху по очереди то левая, то правая.
 */
export function crossJack(body, n) {
  const K = kit(body);
  const OUT = 0.32;
  const HOP = 0.07;
  const reach = body.upperArm + body.forearm;
  return cycle(n, (u) => {
    const half = u < 0.5 ? 0 : 1; // какая сторона сверху при скрещивании
    const v = (u * 2) % 1;
    // 0–0.4 прыжок в стороны, 0.4–0.5 широко, 0.5–0.9 прыжок в скрест, 0.9–1 скрещено.
    const spread = v < 0.5 ? ease(v / 0.4) : 1 - ease((v - 0.5) / 0.4);
    const flight =
      v < 0.4
        ? Math.sin((Math.PI * v) / 0.4)
        : v >= 0.5 && v < 0.9
          ? Math.sin((Math.PI * (v - 0.5)) / 0.4)
          : 0;
    const up = HOP * flight;
    const pts = K.stand().map((p) => ({ ...p, y: p.y - up }));
    const top = half ? K.S.r : K.S.l;
    for (const S of [K.S.l, K.S.r]) {
      // Ноги: от скреста (стопа за линию центра) до широко.
      const cx = -S.s * 0.09;
      const ax = lerp(cx, S.s * (body.hipHalf + OUT), spread);
      const az = S === top ? -0.08 * (1 - spread) : 0.08 * (1 - spread);
      const A = V(ax, -body.ankleH - up, az);
      K.leg(pts, S, A, 0.1);
      pts[S.an] = A;
      pts[S.to] = V(ax + S.s * 0.03 * spread, -up, az - 0.16);
      pts[S.he] = V(ax, -up, az + 0.05);
      // Руки: горизонтально — от «в стороны» до скреста перед грудью (верхняя рука выше).
      const h = rad(lerp(118, 0, spread));
      const dir = V(S.s * Math.cos(h), S === top ? -0.06 * (1 - spread) : 0.03 * (1 - spread), -Math.sin(h));
      K.armDir(pts, S, dir);
      void reach;
    }
    return pts;
  });
}

// ——— Упор лёжа ———

/** Прямое тело под углом alpha к полу с опорой на носки (носки — pivot на полу, голова — вперёд, −z). */
function lying(body, alpha) {
  const K = kit(body);
  const pts = K.stand();
  // Точка вращения — носки стоя; стоячее тело наклоняется вперёд на (90° − alpha).
  const pivot = V(0, 0, -0.14);
  const out = pts.map((p) => pitch(p, pivot, 90 - alpha));
  return { K, pts: out, pivot };
}
/** Стопы в упоре: носки на полу, пятки вверх и назад. */
function proneFeet(K, pts, body) {
  for (const L of [K.S.l, K.S.r]) {
    const x = body.pts[L.an].x * 0.8;
    pts[L.to] = V(x, 0, -0.14);
    const A = pts[L.an];
    pts[L.an] = V(x, A.y, A.z);
    pts[L.he] = V(x, A.y - 0.04, A.z + 0.06);
  }
}

/**
 * Отжимания: тело прямое от пяток до головы, ладони на полу под плечами, пальцы вперёд (к голове), локти
 * прижаты к корпусу и уходят назад; вниз медленно до груди у пола, вверх быстрее.
 */
export function pushUp(body, n) {
  const reach = body.upperArm + body.forearm;
  // Угол тела подбираем численно по высоте плеч: наверху руки почти прямые до ладоней на полу,
  // внизу плечи в ~13 см от пола (приближённая формула оставляла кисти висеть над полом).
  const angleFor = (h) => {
    let lo = 0;
    let hi = 60;
    for (let k = 0; k < 40; k += 1) {
      const m = (lo + hi) / 2;
      if (-lying(body, m).pts[11].y < h) lo = m;
      else hi = m;
    }
    return (lo + hi) / 2;
  };
  const aTop = angleFor(reach * 0.94 + 0.03);
  const aBot = angleFor(0.13);
  // Кисти — под плечами в верхней точке, чуть шире плеч, и дальше не двигаются.
  const up = lying(body, aTop);
  const hand = {};
  for (const L of [up.K.S.l, up.K.S.r]) hand[L.k] = V(up.pts[L.sh].x + L.s * 0.05, -0.03, up.pts[L.sh].z);
  return centerZ(
    cycle(n, (u) => {
      const w =
        u < 0.45 ? seg(u, 0, 0.45, ease5) : u < 0.53 ? 1 : u < 0.85 ? 1 - seg(u, 0.53, 0.85, ease5) : 0;
      const { K, pts } = lying(body, lerp(aTop, aBot, w));
      proneFeet(K, pts, body);
      for (const L of [K.S.l, K.S.r]) {
        const W = hand[L.k];
        // Локти прижаты: изгиб назад (к ногам, +z) и вверх (−y), наружу немного.
        K.armTo(pts, L, W, V(L.s * 0.3, -0.6, 1), V(0, 0, -1));
        // Ладонь плоско на полу, пальцы вперёд.
        for (const j of L.fing) pts[j] = V(W.x - L.s * 0.01, -0.01, W.z - 0.09);
      }
      return pts;
    }),
  );
}

/**
 * Планка на предплечьях (как на примере): локти под плечами, предплечья параллельно вперёд, кулаки рядом;
 * тело одной линией от пяток до головы, взгляд в пол; еле заметное дыхание.
 */
export function plank(body, n) {
  const base = lying(body, 0);
  const s = base.pts[11];
  const shDist = Math.hypot(s.y - base.pivot.y, s.z - base.pivot.z);
  const alpha = (Math.asin((body.upperArm + 0.04) / shDist) * 180) / Math.PI;
  return centerZ(
    cycle(n, (u) => {
      const breath = 0.5 - 0.5 * Math.cos(2 * Math.PI * u);
      const { K, pts } = lying(body, alpha + 0.35 * breath);
      proneFeet(K, pts, body);
      for (const L of [K.S.l, K.S.r]) {
        const Sh = pts[L.sh];
        const E = V(Sh.x * 0.95, -0.04, Sh.z + 0.01);
        const W = V(Sh.x * 0.62, -0.04, Sh.z - body.forearm * 0.96);
        pts[L.el] = E;
        pts[L.wr] = W;
        // Кулак: «пальцы» вперёд, чуть внутрь.
        for (const j of L.fing) pts[j] = V(W.x - L.s * 0.02, -0.04, W.z - 0.07);
      }
      return pts;
    }),
  );
}
