// Движение атлета из спецификации motion-specs/<id>.json (схема v2: contacts, hand_pos, check) — в 3D.
// В отличие от ghost-spec.mjs (только сагиттальная плоскость, бёрпи) здесь есть наклон вбок и скручивание
// корпуса, отведение ног и рук, широкие стойки. Опорные стопы ставятся двухзвенной IK в foot_pos, кисти —
// в цель по hands («на поясе», «за головой», «на полу» → hand_pos). Опорная стопа не скользит по полу:
// тело сдвигается так, чтобы стоящая нога оставалась на месте; накопленный за цикл сдвиг раскладывается
// обратно, чтобы цикл замкнулся, а фигура — по центру.
//
// Внутри — система спецификации: Y вверх, X вправо от атлета, Z вперёд, начало — проекция таза на пол.
// На выходе — оси build-ghost.mjs: y вниз (пол — y = 0), лицом к зрителю — −z, левая сторона — знак body.side.

const rad = (d) => (d * Math.PI) / 180;
const v = (x, y, z) => ({ x, y, z });
const add = (a, b, k = 1) => v(a.x + b.x * k, a.y + b.y * k, a.z + b.z * k);
const sub = (a, b) => v(a.x - b.x, a.y - b.y, a.z - b.z);
const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
const len = (a) => Math.hypot(a.x, a.y, a.z);
const norm = (a) => {
  const l = len(a) || 1;
  return v(a.x / l, a.y / l, a.z / l);
};
const cross = (a, b) => v(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x);

/** Поворот вокруг оси X (наклон вперёд: +Y уходит в +Z). */
const pitch = (p, deg) => {
  const c = Math.cos(rad(deg));
  const s = Math.sin(rad(deg));
  return v(p.x, p.y * c - p.z * s, p.y * s + p.z * c);
};
/** Вокруг оси Z (наклон вбок вправо: +Y уходит в +X). */
const roll = (p, deg) => {
  const c = Math.cos(rad(deg));
  const s = Math.sin(rad(deg));
  return v(p.x * c + p.y * s, -p.x * s + p.y * c, p.z);
};
/** Вокруг оси Y (поворот вправо: правое плечо назад, левое вперёд). */
const yaw = (p, deg) => {
  const c = Math.cos(rad(deg));
  const s = Math.sin(rad(deg));
  return v(p.x * c + p.z * s, p.y, -p.x * s + p.z * c);
};
/** Поворот вектора вокруг произвольной оси (Родриг). */
function around(p, axis, deg) {
  const k = norm(axis);
  const c = Math.cos(rad(deg));
  const s = Math.sin(rad(deg));
  return add(add(v(p.x * c, p.y * c, p.z * c), cross(k, p), s), k, dot(k, p) * (1 - c));
}

/** Направление сегмента от «вниз»: сгибание — вперёд, отведение — наружу (out = −1 слева, +1 справа). */
const limbDir = (flex, abd, out) =>
  norm(
    v(
      out * Math.sin(rad(abd)),
      -Math.cos(rad(abd)) * Math.cos(rad(flex)),
      Math.cos(rad(abd)) * Math.sin(rad(flex)),
    ),
  );

/** Средний сустав двухзвенной цепочки от R к цели T, изгиб — в сторону pole. */
function ik(R, T, a, b, pole) {
  const d0 = sub(T, R);
  const d = Math.min(len(d0), (a + b) * 0.999);
  const axis = norm(d0);
  const along = (a * a - b * b + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, a * a - along * along));
  const pp = norm(sub(pole, v(axis.x * dot(pole, axis), axis.y * dot(pole, axis), axis.z * dot(pole, axis))));
  const mid = add(add(R, axis, along), pp, h);
  return { mid, end: add(R, axis, d) };
}

/** Предплечье: сгибание локтя поворачивает от плеча «вперёд» (к груди), для руки вперёд — вверх. */
function foreDir(u, elbow) {
  const ref = Math.abs(u.z) < 0.9 ? v(0, 0, 1) : v(0, 1, 0);
  const perp = norm(sub(ref, v(u.x * dot(ref, u), u.y * dot(ref, u), u.z * dot(ref, u))));
  return norm(
    add(
      v(u.x * Math.cos(rad(elbow)), u.y * Math.cos(rad(elbow)), u.z * Math.cos(rad(elbow))),
      perp,
      Math.sin(rad(elbow)),
    ),
  );
}

const EASE = {
  linear: (u) => u,
  ease_in: (u) => u * u,
  ease_out: (u) => 1 - (1 - u) * (1 - u),
  ease_in_out: (u) => u * u * (3 - 2 * u),
};

/** Значения ключевых кадров в момент u (0..1), плавность — по фазе. Нечисловое — от ближайшего кадра. */
function sample(spec, u) {
  const kf = spec.keyframes;
  let i = 0;
  while (i < kf.length - 2 && u > kf[i + 1].t) i += 1;
  const A = kf[i];
  const B = kf[i + 1];
  const phase = spec.phases.find((p) => A.t >= p.start - 1e-6 && A.t < p.end - 1e-6);
  const ease = EASE[phase?.easing] ?? EASE.ease_in_out;
  const k = ease(Math.max(0, Math.min(1, (u - A.t) / (B.t - A.t || 1))));
  const out = {};
  for (const [key, a] of Object.entries(A)) {
    const b = B[key];
    if (typeof a === 'number' && typeof b === 'number') out[key] = a + (b - a) * k;
    else if (Array.isArray(a) && Array.isArray(b) && typeof a[0] === 'number')
      out[key] = a.map((x, j) => x + (b[j] - x) * k);
    else out[key] = k < 0.5 ? a : b;
  }
  // Опора: только то, что стоит на полу в обоих соседних кадрах (иначе нога «приклеится» в момент отрыва).
  const cA = new Set(A.contacts ?? []);
  const cB = new Set(B.contacts ?? []);
  out.contacts = new Set(
    [...cA].filter((c) => cB.has(c) || k < 0.15).concat([...cB].filter((c) => k > 0.85)),
  );
  return out;
}

const FOOT_LEN = 0.17;
const HEEL = 0.05;

/** Поза 33 точек в системе спецификации. */
function pose(body, s) {
  const P = new Array(33);
  const H0 = -body.hipY; // высота тазобедренного сустава стоя
  const pelvis = v(0, H0 + (s.pelvis_height ?? 0), 0);
  const lean = s.trunk_lean ?? 0;
  const side = s.trunk_side ?? 0;
  const twist = s.trunk_twist ?? 0;
  const torsoLen = body.hipY - body.shY; // > 0
  // Корпус: наклон вперёд, потом вбок, потом поворот — вокруг центра таза.
  const T = (p) => add(pelvis, yaw(roll(pitch(p, lean), side), twist));
  const prone = lean > 45;

  const sides = [
    {
      k: 'l',
      out: -1,
      sh: 11,
      el: 13,
      wr: 15,
      fing: [17, 19, 21],
      hp: 23,
      kn: 25,
      an: 27,
      he: 29,
      to: 31,
      ear: 7,
    },
    {
      k: 'r',
      out: 1,
      sh: 12,
      el: 14,
      wr: 16,
      fing: [18, 20, 22],
      hp: 24,
      kn: 26,
      an: 28,
      he: 30,
      to: 32,
      ear: 8,
    },
  ];
  for (const S of sides) {
    const o = S.out;
    // Таз поворачивается с корпусом частично (иначе при скручивании бёдра «ломаются»).
    const hipOff = yaw(pitch(v(o * body.hipHalf, 0, 0), 0), twist * 0.35);
    const Hp = add(pelvis, hipOff);
    P[S.hp] = Hp;
    P[S.sh] = T(v(o * body.shoulderHalf, torsoLen, 0));
    P[S.ear] = T(v(o * 0.075, torsoLen + 0.2, -0.01));

    // ——— Нога ———
    const flex = (s[`hip_flex_${S.k}`] ?? 0) - lean;
    const abd = s[`hip_abd_${S.k}`] ?? 0;
    const knee = s[`knee_flex_${S.k}`] ?? 0;
    const plantar = s[`ankle_plantar_${S.k}`] ?? 0;
    const turn = (s[`foot_turnout_${S.k}`] ?? 0) * o; // носок наружу
    const planted =
      s.contacts.has(`${S.k === 'l' ? 'left' : 'right'}_foot`) ||
      s.contacts.has(`${S.k === 'l' ? 'left' : 'right'}_toes`);
    const thighDir = limbDir(flex, abd, o);
    // Колено сгибается назад в плоскости бедра.
    const shinFK = around(thighDir, v(-1, 0, 0), -knee);
    let K = add(Hp, thighDir, body.thigh);
    let A = add(K, shinFK, body.shin);
    // Стопа: носок вперёд, подошва под углом plantar; ориентация — от голени.
    const footBase = (pl) => {
      const toe = pitch(v(0, -body.ankleH, FOOT_LEN), pl);
      const heel = pitch(v(0, -body.ankleH, -HEEL), pl);
      return { toe: yaw(toe, turn), heel: yaw(heel, turn) };
    };
    if (planted && !prone && Array.isArray(s[`foot_pos_${S.k}`])) {
      const [fx, fz] = s[`foot_pos_${S.k}`];
      const f = footBase(Math.max(0, plantar));
      const drop = -f.toe.y; // насколько носок ниже щиколотки
      const lift = plantar > 0 ? Math.max(0, drop - body.ankleH) : 0;
      const target = v(fx, body.ankleH + lift, fz);
      const r = ik(Hp, target, body.thigh, body.shin, add(v(0, 0, 1), v(o * 0.25, 0, 0)));
      K = r.mid;
      A = r.end;
      P[S.to] = add(A, f.toe);
      P[S.he] = add(A, f.heel);
    } else {
      // Нога в воздухе или упор лёжа — по углам; стопа продолжает голень.
      const shinPitch = (Math.atan2(shinFK.z, -shinFK.y) * 180) / Math.PI;
      const f = footBase(plantar - shinPitch);
      P[S.to] = add(A, f.toe);
      P[S.he] = add(A, f.heel);
    }
    P[S.kn] = K;
    P[S.an] = A;

    // ——— Рука ———
    const Sh = P[S.sh];
    const hands = s.hands ?? '';
    const handPos = s[`hand_pos_${S.k}`];
    const toWorld = (d) => yaw(roll(pitch(d, lean), side), twist);
    let E;
    let W;
    const onForearm = s.contacts.has(`${S.k === 'l' ? 'left' : 'right'}_forearm`);
    if (onForearm && Array.isArray(handPos)) {
      // Планка на предплечьях: плечо над локтем, предплечье лежит вперёд, к hand_pos (пол — по локтям).
      E = v(Sh.x, Sh.y - body.upperArm, Sh.z);
      const hand = v(handPos[0], E.y, handPos[1]);
      W = add(E, norm(sub(hand, E)), body.forearm);
    } else if (/на полу/.test(hands) && Array.isArray(handPos)) {
      const target = v(handPos[0], 0.03, handPos[1]);
      const pole = toWorld(v(o * 0.5, 0.2, -1)); // локти назад, к ногам
      const r = ik(Sh, target, body.upperArm, body.forearm, pole);
      E = r.mid;
      W = r.end;
    } else if (/на поясе/.test(hands)) {
      const target = T(v(o * (body.hipHalf + 0.06), 0.1, 0.02));
      const r = ik(Sh, target, body.upperArm, body.forearm, toWorld(v(o, 0, -0.35)));
      E = r.mid;
      W = r.end;
    } else if (/за головой/.test(hands)) {
      const target = T(v(o * 0.06, torsoLen + 0.16, -0.1));
      const r = ik(Sh, target, body.upperArm, body.forearm, toWorld(v(o, 0.25, 0.15)));
      E = r.mid;
      W = r.end;
    } else {
      const u = toWorld(limbDir(s[`shoulder_flex_${S.k}`] ?? 0, s[`shoulder_abd_${S.k}`] ?? 0, o));
      const fDir = toWorld(
        foreDir(
          limbDir(s[`shoulder_flex_${S.k}`] ?? 0, s[`shoulder_abd_${S.k}`] ?? 0, o),
          s[`elbow_flex_${S.k}`] ?? 0,
        ),
      );
      E = add(Sh, u, body.upperArm);
      W = add(E, fDir, body.forearm);
    }
    P[S.el] = E;
    P[S.wr] = W;
    const fore = norm(sub(W, E));
    for (const j of S.fing) P[j] = add(W, fore, 0.08);
  }
  P[0] = T(v(0, torsoLen + 0.19, 0.1));
  for (let i = 0; i < 33; i += 1) if (!P[i]) P[i] = P[0];
  return P;
}

/**
 * Упор лёжа: углы ног из разбора ролика не всегда сходятся с высотой таза — носки висят над полом.
 * Поворачиваем всё тело в сагиттальной плоскости вокруг опоры рук, пока носки не встанут на её уровень.
 */
function plantToes(pts, contacts) {
  const handIds = [
    ...(contacts.has('left_forearm') ? [13] : contacts.has('left_hand') ? [15] : []),
    ...(contacts.has('right_forearm') ? [14] : contacts.has('right_hand') ? [16] : []),
  ];
  if (!handIds.length) return pts;
  const pivot = v(
    0,
    Math.min(...handIds.map((i) => pts[i].y)),
    handIds.reduce((a, i) => a + pts[i].z, 0) / handIds.length,
  );
  const turn = (deg) => pts.map((p) => add(pivot, pitch(sub(p, pivot), deg)));
  const gap = (q) => Math.max(q[31].y, q[32].y) - pivot.y; // > 0 — носки выше опоры рук
  if (Math.abs(gap(pts)) < 0.01) return pts;
  // Носки позади (−Z): отрицательный поворот опускает их, положительный — поднимает.
  let lo = -45;
  let hi = 45;
  for (let i = 0; i < 40; i += 1) {
    const mid = (lo + hi) / 2;
    if (gap(turn(mid)) > 0) hi = mid;
    else lo = mid;
  }
  return turn((lo + hi) / 2);
}

/** Точки опоры кадра: что должно стоять на полу. */
function supportIds(contacts) {
  const ids = [];
  for (const [name, list] of [
    ['left_foot', [27, 29, 31]],
    ['right_foot', [28, 30, 32]],
    ['left_toes', [31]],
    ['right_toes', [32]],
    ['left_hand', [15, 17, 19]],
    ['right_hand', [16, 18, 20]],
    ['left_forearm', [13]],
    ['right_forearm', [14]],
  ])
    if (contacts.has(name)) ids.push(...list);
  return ids;
}
/** Опора, которая держит тело на месте по горизонтали (стопы, носки, кисти). */
function anchorIds(contacts) {
  const ids = [];
  if (contacts.has('left_foot') || contacts.has('left_toes')) ids.push(31);
  if (contacts.has('right_foot') || contacts.has('right_toes')) ids.push(32);
  if (contacts.has('left_hand')) ids.push(15);
  if (contacts.has('right_hand')) ids.push(16);
  return ids;
}

/** Кадры одного цикла: n кадров в осях build-ghost.mjs. */
export function spec3dMotion(spec, body, n) {
  const raw = [];
  for (let k = 0; k < n; k += 1) {
    const s = sample(spec, k / n);
    let pts = pose(body, s);
    if ((s.trunk_lean ?? 0) > 45) pts = plantToes(pts, s.contacts);
    // Пол: опора — на y = 0 (в воздухе — таз там, где сказано в спецификации).
    const sup = supportIds(s.contacts);
    if (sup.length) {
      const low = Math.min(...sup.map((i) => pts[i].y));
      const off = low - 0;
      pts = pts.map((p) => v(p.x, p.y - off, p.z));
    }
    raw.push({ pts, anchors: anchorIds(s.contacts) });
  }
  // Горизонталь: опорная точка, стоявшая на полу в прошлом кадре, остаётся на месте.
  const shift = [v(0, 0, 0)];
  for (let k = 1; k < n; k += 1) {
    const a = raw[k - 1];
    const b = raw[k];
    const common = b.anchors.filter((i) => a.anchors.includes(i));
    const prev = shift[k - 1];
    if (!common.length) {
      shift.push(prev);
      continue;
    }
    let dx = 0;
    let dz = 0;
    for (const i of common) {
      dx += a.pts[i].x - b.pts[i].x;
      dz += a.pts[i].z - b.pts[i].z;
    }
    shift.push(v(prev.x + dx / common.length, 0, prev.z + dz / common.length));
  }
  // Замыкаем цикл (остаток сдвига — поровну по кадрам) и ставим фигуру по центру.
  const last = raw[n - 1];
  const first = raw[0];
  const common = first.anchors.filter((i) => last.anchors.includes(i));
  let endX = shift[n - 1].x;
  let endZ = shift[n - 1].z;
  if (common.length) {
    for (const i of common) {
      endX += (last.pts[i].x - first.pts[i].x) / common.length;
      endZ += (last.pts[i].z - first.pts[i].z) / common.length;
    }
  }
  const fixed = shift.map((sft, k) => v(sft.x - (endX * k) / n, 0, sft.z - (endZ * k) / n));
  const mx = fixed.reduce((a, p) => a + p.x, 0) / n;
  const mz = fixed.reduce((a, p) => a + p.z, 0) / n;

  // В оси build-ghost: y вниз, вперёд — −z, левая сторона — знак body.side (в спецификации слева — −X).
  return raw.map(({ pts }, k) =>
    pts.map((p) => ({
      x: -(p.x + fixed[k].x - mx) * body.side,
      y: -p.y,
      z: -(p.z + fixed[k].z - mz),
    })),
  );
}
