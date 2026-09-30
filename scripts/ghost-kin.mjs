// Чистая кинематика атлета (как выпады и подъём рук): ровное тело build-ghost.mjs, плавные кривые, ни шума, ни
// дрожи. Видео — только образец позы и темпа. Оси: y вниз (пол — y = 0), лицом к зрителю — −z (вперёд),
// левая сторона человека — знак body.side по x.

const V = (x, y, z) => ({ x, y, z });
const add = (a, b, k = 1) => V(a.x + b.x * k, a.y + b.y * k, a.z + b.z * k);
const sub = (a, b) => V(a.x - b.x, a.y - b.y, a.z - b.z);
const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
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

/** Кадр позы в момент u (0..1) из функции pose(u) — n кадров цикла. */
const cycle = (n, pose) => Array.from({ length: n }, (_, k) => pose(k / n));

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
 * Присед с выпрыгиванием: тот же присед, взрывной выход вверх, полёт с вытянутыми носками, мягкое
 * приземление с амортизацией и снова стойка.
 */
export function jumpSquat(sq, n) {
  const bot = squatBottom(sq);
  const HOP = 0.22;
  return cycle(n, (u) => {
    let pts;
    let lift = 0;
    let point = 0; // носки вниз в полёте
    if (u < 0.48) pts = squatAt(sq, bot * ease(u / 0.48));
    else if (u < 0.6) pts = squatAt(sq, bot + (1 - bot) * seg(u, 0.48, 0.6, (x) => x * (2 - x)));
    else if (u < 0.84) {
      const t = (u - 0.6) / 0.24;
      pts = squatAt(sq, 0);
      lift = HOP * Math.sin(Math.PI * t);
      point = Math.sin(Math.PI * Math.min(1, t * 1.15));
    } else {
      // Приземление: неглубокая амортизация и выход в стойку.
      pts = squatAt(sq, bot * 0.32 * Math.sin(Math.PI * ((u - 0.84) / 0.16)));
    }
    pts = pts.map((p) => ({ ...p, y: p.y - lift }));
    if (point > 0)
      for (const [an, he, to] of [
        [27, 29, 31],
        [28, 30, 32],
      ]) {
        // Стопа вытягивается: пятка поднимается выше носка.
        pts[he] = { ...pts[he], y: pts[he].y - 0.07 * point };
        pts[to] = { ...pts[to], y: pts[to].y + 0.03 * point };
        pts[an] = { ...pts[an], y: pts[an].y - 0.02 * point };
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
 * Наклоны в стороны по очереди: одна рука на поясе, другая прямая вверх; наклон в сторону руки на поясе,
 * верхняя рука уходит дугой над головой. На смене сторон руки меняются местами.
 */
export function sideBend(body, n) {
  const K = kit(body);
  const MAX = 32;
  const pose = (u, toward) => {
    // toward — сторона наклона (L на поясе), вверх — другая.
    const hipL = toward === 'l' ? K.S.l : K.S.r;
    const upL = toward === 'l' ? K.S.r : K.S.l;
    // 0–0.3 смена рук, 0.3–0.58 наклон, 0.58–0.68 держим, 0.68–0.92 обратно.
    const swap = seg(u, 0, 0.3, ease5);
    const bend =
      u < 0.3 ? 0 : u < 0.58 ? seg(u, 0.3, 0.58, ease5) : u < 0.68 ? 1 : 1 - seg(u, 0.68, 0.92, ease5);
    const pts = K.stand();
    const pv = V(0, body.hipY, 0);
    const deg = MAX * bend;
    K.upper(pts, (p) => roll(p, pv, deg, hipL.s));
    // Рука, которая идёт на пояс: из «вверх» (прошлая сторона) → вниз вдоль тела → на пояс.
    const onHip = () => {
      const tmp = pts.map((p) => ({ ...p }));
      K.handsOnHips(tmp, hipL);
      return tmp;
    };
    const hipPose = onHip();
    const downDir = V(hipL.s * 0.2, 1, 0);
    if (swap < 1) {
      if (swap < 0.5) {
        // Верхняя (прошлая) рука опускается через сторону.
        const a = rad(172 - 150 * ease(swap / 0.5));
        K.armDir(pts, hipL, V(hipL.s * Math.sin(a), Math.cos(a), 0));
      } else {
        const tmp = pts.map((p) => ({ ...p }));
        K.armDir(tmp, hipL, downDir);
        const k = ease((swap - 0.5) / 0.5);
        for (const j of [hipL.el, hipL.wr, ...hipL.fing]) pts[j] = lerpV(tmp[j], hipPose[j], k);
      }
    } else for (const j of [hipL.el, hipL.wr, ...hipL.fing]) pts[j] = hipPose[j];
    // Рука вверх: с пояса (прошлая сторона) → вниз → через сторону вверх; в наклоне — дугой над головой.
    // В наклоне верхняя рука продолжает линию корпуса и уходит дугой над головой.
    const upAngle = (a0) => roll(V(upL.s * Math.sin(a0), Math.cos(a0), 0), V(0, 0, 0), deg * 1.35, hipL.s);
    if (swap < 0.5) {
      const tmp = pts.map((p) => ({ ...p }));
      K.handsOnHips(tmp, upL);
      const tmp2 = pts.map((p) => ({ ...p }));
      K.armDir(tmp2, upL, V(upL.s * 0.2, 1, 0));
      const k = ease(swap / 0.5);
      for (const j of [upL.el, upL.wr, ...upL.fing]) pts[j] = lerpV(tmp[j], tmp2[j], k);
    } else {
      const a = rad(12 + 158 * ease((swap - 0.5) / 0.5));
      K.armDir(pts, upL, upAngle(a));
    }
    return pts;
  };
  return cycle(n, (u) => (u < 0.5 ? pose(u * 2, 'l') : pose(u * 2 - 1, 'r')));
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
 * Бокс: стойка (левая нога впереди, колени мягкие), кулаки у подбородка, локти внизу. Джеб левой — прямая рука
 * вперёд, правая у подбородка; кросс правой — разворот корпуса и пятки, левая у подбородка. Лёгкое пружинение.
 */
export function boxing(body, n) {
  const K = kit(body);
  return cycle(n, (u) => {
    const jab = u < 0.08 ? seg(u, 0, 0.08, (x) => x * (2 - x)) : u < 0.2 ? 1 - seg(u, 0.08, 0.2) : 0;
    const cross =
      u < 0.4 ? 0 : u < 0.5 ? seg(u, 0.4, 0.5, (x) => x * (2 - x)) : u < 0.64 ? 1 - seg(u, 0.5, 0.64) : 0;
    const bounce = 0.012 * Math.sin(2 * Math.PI * 2 * u);
    const pts = K.stand();
    const DROP = 0.06 + bounce;
    for (const p of pts) if (p.y < body.hipY + 0.01) p.y += DROP;
    const pv = V(0, body.hipY + DROP, 0);
    // Корпус: базовый разворот правым плечом назад, на кроссе — вперёд.
    const twist = 18 - 40 * cross + 6 * jab;
    K.upper(pts, (p) => yaw(p, pv, -twist, body.side));
    // Ноги: левая впереди, правая сзади; на кроссе правая пятка поднимается.
    const L = K.S.l;
    const R = K.S.r;
    const aL = V(L.s * 0.14, -body.ankleH, -0.24);
    const aR = V(R.s * 0.17, -body.ankleH - 0.03 * cross, 0.22);
    K.leg(pts, L, aL, 0.2);
    K.leg(pts, R, aR, 0.3);
    K.foot(pts, L, aL, 20);
    K.foot(pts, R, aR, 45, 0.06 * cross + 0.02);
    // Руки: у подбородка — кулак перед подбородком, локоть вниз.
    const chin = add(pts[0], V(0, 0.12, 0.02));
    const guard = (S) => add(chin, V(S.s * 0.08, 0.02, -0.08));
    const target = V(0, pts[0].y + 0.12, -0.8);
    for (const [S, k] of [
      [L, jab],
      [R, cross],
    ]) {
      const G = guard(S);
      const reach = body.upperArm + body.forearm;
      const T = add(pts[S.sh], norm(sub(target, pts[S.sh])), reach * 0.995);
      const W = lerpV(G, T, k);
      K.armTo(pts, S, W, V(S.s * 0.4, 1, 0.25), sub(W, pts[S.sh]));
    }
    return pts;
  });
}

/**
 * Локоть к колену стоя: руки за головой, локти в стороны и вперёд. Правое колено вверх и чуть к центру,
 * корпус скручивается и наклоняется — левый локоть к правому колену; потом наоборот.
 */
export function kneeToElbow(body, n) {
  const K = kit(body);
  const pose = (u, knee, elbow) => {
    const w =
      u < 0.06
        ? 0
        : u < 0.4
          ? seg(u, 0.06, 0.4, ease5)
          : u < 0.5
            ? 1
            : u < 0.88
              ? 1 - seg(u, 0.5, 0.88, ease5)
              : 0;
    const pts = K.stand();
    const pv = V(0, body.hipY, 0);
    const stand = knee === K.S.r ? K.S.l : K.S.r;
    // Корпус: наклон вперёд, вбок к колену и поворот локтем к колену.
    K.upper(pts, (p) => {
      let q = pitch(p, pv, 20 * w);
      q = roll(q, pv, 14 * w, knee.s);
      return yaw(q, pv, 32 * w * (elbow === K.S.l ? -1 : 1), body.side);
    });
    // Опорная нога прямая.
    const aS = V(body.pts[stand.an].x, -body.ankleH, 0);
    K.leg(pts, stand, aS);
    K.foot(pts, stand, aS);
    // Рабочая: бедро вперёд-вверх до ~95° и к центру, голень вниз.
    const H = pts[knee.hp];
    const fl = rad(95 * w);
    const ad = rad(18 * w);
    const thighDir = norm(V(-knee.s * Math.sin(ad), Math.cos(fl), -Math.sin(fl)));
    const Kn = add(H, thighDir, body.thigh);
    const shinDir = norm(V(-knee.s * 0.05 * w, 1, 0.15 * w));
    const A = add(Kn, shinDir, body.shin);
    pts[knee.kn] = Kn;
    pts[knee.an] = A;
    pts[knee.to] = add(A, V(0, body.ankleH * (1 - 0.6 * w), -0.16 + 0.05 * w));
    pts[knee.he] = add(A, V(0, body.ankleH, 0.05));
    // Руки за головой: кисти на затылке, локти в стороны и вперёд.
    const head = pts[0];
    for (const S of [K.S.l, K.S.r]) {
      const Wr = add(head, V(S.s * 0.07, -0.02, 0.16));
      K.armTo(pts, S, Wr, V(S.s, 0.1, -0.7), V(-S.s, 0, 0));
    }
    return pts;
  };
  return cycle(n, (u) => (u < 0.5 ? pose(u * 2, K.S.r, K.S.l) : pose(u * 2 - 1, K.S.l, K.S.r)));
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
  const top = lying(body, 0);
  // Угол тела наверху: плечи на высоте прямых рук; внизу — плечи в ~12 см от пола.
  const shDist = (() => {
    const s = top.pts[11];
    return Math.hypot(s.y - top.pivot.y, s.z - top.pivot.z);
  })();
  const aTop = (Math.asin(Math.min(0.99, (reach * 0.97 + 0.02) / shDist)) * 180) / Math.PI;
  const aBot = (Math.asin(0.13 / shDist) * 180) / Math.PI;
  // Кисти — под плечами в верхней точке, чуть шире плеч, и дальше не двигаются.
  const up = lying(body, aTop);
  const hand = {};
  for (const L of [up.K.S.l, up.K.S.r]) hand[L.k] = V(up.pts[L.sh].x + L.s * 0.05, -0.03, up.pts[L.sh].z);
  return cycle(n, (u) => {
    const w = u < 0.45 ? seg(u, 0, 0.45, ease5) : u < 0.53 ? 1 : u < 0.85 ? 1 - seg(u, 0.53, 0.85, ease5) : 0;
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
  });
}

/** Планка на предплечьях: локти под плечами, предплечья на полу вперёд, тело прямое, еле заметное дыхание. */
export function plank(body, n) {
  const base = lying(body, 0);
  const s = base.pts[11];
  const shDist = Math.hypot(s.y - base.pivot.y, s.z - base.pivot.z);
  const alpha = (Math.asin((body.upperArm + 0.03) / shDist) * 180) / Math.PI;
  return cycle(n, (u) => {
    const breath = 0.5 - 0.5 * Math.cos(2 * Math.PI * u);
    const { K, pts } = lying(body, alpha + 0.4 * breath);
    proneFeet(K, pts, body);
    for (const L of [K.S.l, K.S.r]) {
      const Sh = pts[L.sh];
      const E = V(Sh.x, -0.035, Sh.z);
      const W = V(Sh.x * 0.55, -0.03, Sh.z - body.forearm * 0.97);
      pts[L.el] = E;
      pts[L.wr] = W;
      for (const j of L.fing) pts[j] = V(W.x - L.s * 0.02, -0.03, W.z - 0.07);
    }
    return pts;
  });
}
