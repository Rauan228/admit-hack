// Эталон атлета из записи движения (как присед): позы MediaPipe по ролику упражнения (motion-specs/poses/<id>.json,
// снято scripts/extract-fixtures.mjs), без ручной кинематики. Ролик — один повтор; из него получаем петлю:
//   сглаживание → поворот лицом к зрителю → (боковой ролик) дальняя сторона — зеркало ближней →
//   равномерно по времени → (одна сторона в ролике) вторая половина цикла — зеркальная →
//   пол и опора: опорная стопа/кисть не скользит, прыжок — по высоте таза на картинке → бесшовная петля.
// Мировые координаты MediaPipe: метры, y вниз, начало — центр таза (поэтому перемещение тела берём из опоры).

const avg = (...v) => v.reduce((a, b) => a + b, 0) / v.length;
const PAIRS = [
  [1, 4],
  [2, 5],
  [3, 6],
  [7, 8],
  [9, 10],
  [11, 12],
  [13, 14],
  [15, 16],
  [17, 18],
  [19, 20],
  [21, 22],
  [23, 24],
  [25, 26],
  [27, 28],
  [29, 30],
  [31, 32],
];
const LEFT = [11, 13, 15, 17, 19, 21, 23, 25, 27, 29, 31, 1, 2, 3, 7, 9];
const FEET = [29, 30, 31, 32];
const HANDS = [15, 16, 17, 18, 19, 20];

/** Кадры из файла поз: мировые точки + видимость + высота таза и стоп на картинке (для прыжка). */
export function loadPoses(data) {
  return data.frames
    .filter((f) => f.w && f.w.length === 99 && f.p && f.p.length === 132)
    .map((f) => ({
      t: f.t,
      pts: Array.from({ length: 33 }, (_, i) => ({
        x: f.w[i * 3],
        y: f.w[i * 3 + 1],
        z: f.w[i * 3 + 2],
        v: f.p[i * 4 + 3],
      })),
      img: {
        hipY: avg(f.p[23 * 4 + 1], f.p[24 * 4 + 1]),
        footY: Math.max(...FEET.map((j) => f.p[j * 4 + 1])),
      },
    }));
}

function smooth(frames, k) {
  return frames.map((f, i) => {
    const win = frames.slice(Math.max(0, i - k), i + k + 1);
    return {
      ...f,
      pts: f.pts.map((_, j) => ({
        x: avg(...win.map((w) => w.pts[j].x)),
        y: avg(...win.map((w) => w.pts[j].y)),
        z: avg(...win.map((w) => w.pts[j].z)),
        v: avg(...win.map((w) => w.pts[j].v)),
      })),
      img: { hipY: avg(...win.map((w) => w.img.hipY)), footY: avg(...win.map((w) => w.img.footY)) },
    };
  });
}

/** Поворот вокруг вертикали: линия таза в среднем по ролику — вдоль x (лицом к зрителю, −z). */
function faceViewer(frames) {
  const a = Math.atan2(
    avg(...frames.map((f) => f.pts[24].z - f.pts[23].z)),
    avg(...frames.map((f) => f.pts[24].x - f.pts[23].x)),
  );
  // Правое бедро человека (24) — слева у зрителя: у лица к зрителю x правого < x левого.
  const d = Math.PI - a;
  const c = Math.cos(d);
  const s = Math.sin(d);
  return frames.map((f) => ({
    ...f,
    pts: f.pts.map((p) => ({ ...p, x: p.x * c - p.z * s, z: p.x * s + p.z * c })),
  }));
}

/** Боковой ролик: дальняя сторона видна плохо — берём зеркало ближней относительно середины таза. */
function symmetrize(frames, near) {
  return frames.map((f) => {
    const cx = avg(f.pts[23].x, f.pts[24].x);
    const pts = f.pts.map((p) => ({ ...p }));
    for (const [l, r] of PAIRS) {
      const [src, dst] = near === 'left' ? [l, r] : [r, l];
      const p = f.pts[src];
      pts[dst] = { ...p, x: 2 * cx - p.x };
    }
    return { ...f, pts };
  });
}

/** Зеркало всего тела: левое ↔ правое (вторая сторона для упражнений, снятых на одну сторону). */
function mirror(pts) {
  const out = pts.map((p) => ({ ...p, x: -p.x }));
  for (const [l, r] of PAIRS) {
    const a = out[l];
    out[l] = out[r];
    out[r] = a;
  }
  return out;
}

/** n кадров равномерно по времени от начала до конца отрезка. */
function resampleTime(frames, n) {
  const t0 = frames[0].t;
  const t1 = frames.at(-1).t;
  const out = [];
  let i = 0;
  for (let k = 0; k < n; k += 1) {
    const t = t0 + ((t1 - t0) * k) / n;
    while (i < frames.length - 2 && frames[i + 1].t < t) i += 1;
    const A = frames[i];
    const B = frames[i + 1];
    const w = Math.max(0, Math.min(1, (t - A.t) / Math.max(1e-6, B.t - A.t)));
    out.push({
      pts: A.pts.map((p, j) => ({
        x: p.x + (B.pts[j].x - p.x) * w,
        y: p.y + (B.pts[j].y - p.y) * w,
        z: p.z + (B.pts[j].z - p.z) * w,
      })),
      img: {
        hipY: A.img.hipY + (B.img.hipY - A.img.hipY) * w,
        footY: A.img.footY + (B.img.footY - A.img.footY) * w,
      },
    });
  }
  return out;
}

/** Бесшовная петля: конец плавно сходится к началу. */
function closeLoop(frames, blend) {
  const n = frames.length;
  return frames.map((f, k) => {
    const w = k >= n - blend ? (k - (n - blend) + 1) / (blend + 1) : 0;
    if (!w) return f;
    return {
      ...f,
      pts: f.pts.map((p, j) => {
        const q = frames[0].pts[j];
        return { x: p.x + (q.x - p.x) * w, y: p.y + (q.y - p.y) * w, z: p.z + (q.z - p.z) * w };
      }),
    };
  });
}

/**
 * Опора и пол. По вертикали — самая низкая опорная точка на полу (y = 0); в прыжке (jump) — выше пола
 * на столько, насколько таз поднялся на картинке сверх стойки. По горизонтали — точка опоры, стоявшая
 * на полу в прошлом кадре, остаётся на месте (иначе стопы скользят: в записи таз всегда в начале координат).
 */
function plant(frames, { prone = false, jump = false }) {
  const support = prone ? [...FEET, ...HANDS] : FEET;
  // Масштаб «картинка → метры»: рост в мировых / рост на картинке, по первому кадру.
  let lift = frames.map(() => 0);
  if (jump) {
    const floorImg = Math.max(...frames.map((f) => f.img.footY));
    const hW = avg(...frames.map((f) => Math.max(...FEET.map((j) => f.pts[j].y)) - f.pts[0].y));
    const hI = avg(...frames.map((f) => f.img.footY - f.img.hipY)) * 1.9;
    const k = hW / Math.max(1e-6, hI);
    lift = frames.map((f) => Math.max(0, (floorImg - f.img.footY) * k - 0.015));
  }
  // Упор лёжа: глубина на боковом ролике шумит, и корпус «качается» — поворачиваем тело вокруг кистей
  // (вокруг x: тело вытянуто вдоль z), чтобы носки легли на уровень ладоней.
  if (prone)
    frames = frames.map((f) => {
      const pv = { y: avg(f.pts[15].y, f.pts[16].y), z: avg(f.pts[15].z, f.pts[16].z) };
      const ty = avg(f.pts[31].y, f.pts[32].y) - pv.y;
      const tz = avg(f.pts[31].z, f.pts[32].z) - pv.z;
      const a = -Math.atan2(ty, tz);
      const c = Math.cos(a);
      const s = Math.sin(a);
      return {
        ...f,
        pts: f.pts.map((p) => {
          const y = p.y - pv.y;
          const z = p.z - pv.z;
          return { ...p, y: pv.y + y * c + z * s, z: pv.z - y * s + z * c };
        }),
      };
    });
  const grounded = frames.map((f, i) => {
    // Упор лёжа: лицо и плечи не уходят под пол (внизу отжимания — в паре сантиметров над ним).
    const body = prone ? Math.max(f.pts[0].y + 0.07, f.pts[11].y + 0.1, f.pts[12].y + 0.1) : -Infinity;
    const floor = Math.max(body, ...support.map((j) => f.pts[j].y));
    return f.pts.map((p) => ({ x: p.x, y: p.y - floor - lift[i], z: p.z }));
  });
  // Кто стоит: точки опоры в пределах 3 см от пола.
  const onFloor = grounded.map((pts, i) =>
    lift[i] > 0.02 ? [] : (prone ? [31, 32, 15, 16] : [31, 32, 29, 30]).filter((j) => pts[j].y > -0.03),
  );
  const shift = [{ x: 0, z: 0 }];
  for (let i = 1; i < grounded.length; i += 1) {
    const common = onFloor[i].filter((j) => onFloor[i - 1].includes(j));
    const prev = shift[i - 1];
    if (!common.length) {
      shift.push(prev);
      continue;
    }
    const dx = avg(...common.map((j) => grounded[i - 1][j].x - grounded[i][j].x));
    const dz = avg(...common.map((j) => grounded[i - 1][j].z - grounded[i][j].z));
    shift.push({ x: prev.x + dx, z: prev.z + dz });
  }
  const n = grounded.length;
  const end = shift[n - 1];
  const fixed = shift.map((s, i) => ({ x: s.x - (end.x * i) / n, z: s.z - (end.z * i) / n }));
  const mx = avg(...fixed.map((s) => s.x));
  const mz = avg(...fixed.map((s) => s.z));
  return grounded.map((pts, i) =>
    pts.map((p) => ({ x: p.x + fixed[i].x - mx, y: p.y, z: p.z + fixed[i].z - mz })),
  );
}

/**
 * Петля эталона из ролика. opts: ms — длительность цикла (одна сторона, если mirror), trim — [от, до] доли ролика,
 * smoothK, near — 'left' | 'right' для бокового ролика, mirror — добавить зеркальную вторую сторону,
 * prone — упор лёжа (опора и на кисти), jump — есть полёт, fps — кадров на секунду цикла.
 */
export function videoMotion(data, opts) {
  let frames = loadPoses(data);
  const [a, b] = opts.trim ?? [0, 1];
  frames = frames.slice(
    Math.floor(a * frames.length),
    Math.max(Math.floor(a * frames.length) + 2, Math.ceil(b * frames.length)),
  );
  frames = smooth(frames, opts.smoothK ?? 3);
  frames = faceViewer(frames);
  if (opts.near) frames = symmetrize(frames, opts.near);
  const n = Math.round(((opts.ms ?? 2800) / 1000) * (opts.fps ?? 50));
  let cycle = closeLoop(resampleTime(frames, n), Math.max(4, Math.round(n * 0.08)));
  if (opts.mirror) cycle = [...cycle, ...cycle.map((f) => ({ ...f, pts: mirror(f.pts) }))];
  const pts = plant(cycle, opts);
  return { frames: pts, durationMs: (opts.ms ?? 2800) * (opts.mirror ? 2 : 1) };
}

export { LEFT };
