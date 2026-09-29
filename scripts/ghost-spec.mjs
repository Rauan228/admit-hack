// Движение «призрака» из спецификации motion-specs/<id>.json (углы суставов по ключевым кадрам,
// см. промпт для Grok в плане). Прямая кинематика в сагиттальной плоскости на каноническом теле:
// корпус наклоняется вокруг таза, бедро/голень/стопа и плечо/предплечье — цепочками углов.
// Опора: на стопах, а пока ладони на полу — на ладонях (ноги «отпрыгивают» назад, руки стоят на месте).
//
// Оси — как в build-ghost.mjs: y вниз (пол — y = 0), лицом к зрителю — −z.

const rad = (d) => (d * Math.PI) / 180;
/** Направление под углом a от «вниз» (вперёд — положительно): (0, cos a, −sin a). */
const dir = (a) => ({ x: 0, y: Math.cos(rad(a)), z: -Math.sin(rad(a)) });
const add = (p, d, k = 1) => ({ x: p.x + d.x * k, y: p.y + d.y * k, z: p.z + d.z * k });
/** Поворот вектора в сагиттальной плоскости на δ° (вперёд — положительно). */
function rot(v, deg) {
  const c = Math.cos(rad(deg));
  const s = Math.sin(rad(deg));
  return { x: v.x, y: v.y * c + v.z * s, z: v.z * c - v.y * s };
}

const EASE = {
  linear: (u) => u,
  ease_in: (u) => u * u,
  ease_out: (u) => 1 - (1 - u) * (1 - u),
  ease_in_out: (u) => u * u * (3 - 2 * u),
};

/** Значения ключевых кадров в момент u (0..1) с плавностью фазы, в которую попадает u. */
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
    else if (Array.isArray(a) && Array.isArray(b)) out[key] = a.map((v, j) => v + (b[j] - v) * k);
    else out[key] = k < 0.5 ? a : b;
  }
  out.contact = phase?.ground_contact ?? 'both';
  return out;
}

/** Поза относительно таза: 33 точки. */
function fk(body, s) {
  const pts = body.pts.map((p) => ({ ...p }));
  const up = body.shY - body.hipY; // < 0: плечи выше таза (y вниз)
  const lean = s.trunk_lean;
  const sides = [
    {
      sgn: body.side,
      k: 'l',
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
      sgn: -body.side,
      k: 'r',
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
  // Корпус и голова: смещения стоячего тела от центра таза, повёрнутые на наклон.
  const torsoPt = (x, dy, dz) => {
    const r = rot({ x: 0, y: dy, z: dz }, -lean);
    return { x, y: r.y, z: r.z };
  };
  for (const S of sides) {
    const x = S.sgn;
    pts[S.hp] = { x: x * body.hipHalf, y: 0, z: 0 };
    pts[S.sh] = torsoPt(x * body.shoulderHalf, up, 0);
    pts[S.ear] = torsoPt(x * 0.075, up - 0.2, 0.01);

    // Нога: бедро → голень → стопа.
    const aThigh = s[`hip_flex_${S.k}`] - lean;
    const aShin = aThigh - s[`knee_flex_${S.k}`];
    const aFoot = aShin + 90 - s[`ankle_plantar_${S.k}`];
    const abd = rad(s[`hip_abd_${S.k}`] ?? 0);
    const H = pts[S.hp];
    const K = add(add(H, dir(aThigh), body.thigh), { x: x * Math.sin(abd), y: 0, z: 0 }, body.thigh);
    const A = add(K, dir(aShin), body.shin);
    pts[S.kn] = K;
    pts[S.an] = A;
    pts[S.he] = add(A, rot({ x: 0, y: body.ankleH, z: 0.05 }, aFoot - 90));
    pts[S.to] = add(add(A, rot({ x: 0, y: body.ankleH, z: -0.17 }, aFoot - 90)), { x: x * 0.03, y: 0, z: 0 });

    // Рука: плечо → предплечье (сгибание вперёд), небольшое отведение наружу.
    const aArm = s[`shoulder_flex_${S.k}`] - lean;
    const aFore = aArm + s[`elbow_flex_${S.k}`];
    const out = Math.sin(rad(s[`shoulder_abd_${S.k}`] ?? 0));
    const E = add(add(pts[S.sh], dir(aArm), body.upperArm), { x: x * out, y: 0, z: 0 }, body.upperArm * 0.6);
    const W = add(E, dir(aFore), body.forearm);
    pts[S.el] = E;
    pts[S.wr] = W;
    for (const j of S.fing) pts[j] = add(W, dir(aFore), 0.08);
  }
  pts[0] = torsoPt(0, up - 0.19, -0.1);
  return pts;
}

const FEET = [29, 30, 31, 32];
const HANDS = [17, 18, 19, 20, 21, 22];
const mean = (pts, ids, key) => ids.reduce((a, i) => a + pts[i][key], 0) / ids.length;

/** Поворот тела вокруг кистей в сагиттальной плоскости: стопы опускаются до уровня ладоней. */
function plantFeet(pts) {
  const pivot = { x: 0, y: mean(pts, [15, 16], 'y'), z: mean(pts, [15, 16], 'z') };
  const handFloor = Math.max(...HANDS.map((i) => pts[i].y));
  const turn = (deg) =>
    pts.map((p) => {
      const r = rot({ x: p.x, y: p.y - pivot.y, z: p.z - pivot.z }, deg);
      return { x: p.x, y: r.y + pivot.y, z: r.z + pivot.z };
    });
  const gap = (q) => handFloor - Math.max(...FEET.map((i) => q[i].y)); // > 0 — стопы выше ладоней
  if (gap(pts) <= 0.01) return pts;
  // Стопы позади кистей (+z) и выше их: положительный поворот опускает их к полу.
  let lo = 0;
  let hi = 45;
  for (let i = 0; i < 30; i += 1) {
    const mid = (lo + hi) / 2;
    if (gap(turn(mid)) > 0) lo = mid;
    else hi = mid;
  }
  return turn(hi);
}

/** Кадры одного цикла по спецификации: n кадров, пол, опора, полёт. */
export function specMotion(spec, body, n) {
  const stand = fk(body, sample(spec, 0));
  const standPelvis = Math.max(...FEET.map((i) => stand[i].y)); // высота таза над полом стоя
  const ankleZ0 = mean(stand, [27, 28], 'z');
  // Когда ладони стоят на полу (упор присев → планка → упор).
  const onHands = spec.phases.filter((p) =>
    /^(упор присев|прыжок ногами назад|выход в планку|планка|подбор ног|приход в упор)$/.test(p.name),
  );
  const handsFrom = Math.min(...onHands.map((p) => p.start));
  const handsTo = Math.max(...onHands.map((p) => p.end));
  const handsBlend = 0.08;
  let wristAnchor = null;

  const frames = [];
  for (let k = 0; k < n; k += 1) {
    const u = k / n;
    const s = sample(spec, u);
    let pts = fk(body, s);
    // Упор и планка: ладони и носки — на полу. Углы из разбора видео не всегда сходятся (корпус почти
    // горизонтально, а ноги не дотягиваются), поэтому поворачиваем всё тело вокруг кистей, пока носки не встанут.
    if (u >= handsFrom && u <= handsTo && s.contact !== 'none') pts = plantFeet(pts);
    // Пол: самая низкая точка опоры (стопы, а при упоре — и ладони) — на y = 0.
    const support = u >= handsFrom && u <= handsTo ? [...FEET, ...HANDS] : FEET;
    let dy = -Math.max(...support.map((i) => pts[i].y));
    // Полёт: таз должен быть на standPelvis + pelvis_height — если выше, чем даёт опора, отрываемся от пола.
    if (s.contact === 'none') {
      const want = standPelvis + (s.pelvis_height ?? 0);
      dy = Math.min(dy, -want);
    }
    // Вперёд-назад: стопы на месте; пока ладони на полу — ладони на месте.
    const feetZ = ankleZ0 - mean(pts, [27, 28], 'z');
    let dz = feetZ;
    if (u >= handsFrom && u <= handsTo + handsBlend) {
      const wz = mean(pts, [15, 16], 'z');
      if (wristAnchor === null) wristAnchor = wz + feetZ;
      const handsZ = wristAnchor - wz;
      const w = u <= handsTo ? 1 : 1 - (u - handsTo) / handsBlend;
      dz = handsZ * w + feetZ * (1 - w);
    }
    frames.push(pts.map((p) => ({ x: p.x, y: p.y + dy, z: p.z + dz })));
  }
  return frames;
}
