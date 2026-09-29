import { RenderSmoother } from '../src/engine/filter';
import type { Landmark } from '../src/engine/types';
import { gaussian } from './helpers/synth';

/** Длина корпуса в кадре (доли высоты): плечи 0,30 → таз 0,55. */
const TORSO = 0.25;
const ASPECT = 4 / 3;

/** 33 точки; точка 15 (левое запястье) — в (x, y), остальные стоят. */
const pose = (x: number, y: number, z = 0): Landmark[] =>
  Array.from({ length: 33 }, (_, i) => (i === 15 ? { x, y, z, v: 0.9 } : { x: 0.5, y: 0.5, z: 0, v: 1 }));

function track(
  xs: (t: number) => number,
  opts: { fps?: number; noise?: number; ms?: number } = {},
): { t: number; raw: number; shown: number }[] {
  const { fps = 30, noise = 0, ms = 3000 } = opts;
  const n = gaussian(noise, 7);
  const s = new RenderSmoother();
  const out: { t: number; raw: number; shown: number }[] = [];
  for (let t = 0; t <= ms; t += 1000 / fps) {
    const raw = xs(t) + (noise ? n() : 0);
    const l = pose(raw, 0.5);
    out.push({ t, raw, shown: s.apply(l, l, t, ASPECT, TORSO)[15]!.x });
  }
  return out;
}

/** Медиана |x(k+1) − 2x(k) + x(k−1)| — дрожание, которое видно глазом. */
const jitter = (xs: number[]) => {
  const d = xs.slice(1, -1).map((x, i) => Math.abs(xs[i + 2]! - 2 * x + xs[i]!));
  return d.sort((a, b) => a - b)[d.length >> 1]!;
};

describe('сглаживание скелета на экране (E-23)', () => {
  it('человек стоит — дрожание модели гасится в разы', () => {
    // Шум 0,002 кадра ≈ 2 пикселя на экране Full HD.
    const r = track(() => 0.4, { noise: 0.002 });
    expect(jitter(r.map((p) => p.shown))).toBeLessThan(jitter(r.map((p) => p.raw)) / 2);
  });

  it('резкое движение (сдвиг больше motion) — точка на месте сразу, без догоняния', () => {
    const r = track((t) => (t < 1000 ? 0.4 : 0.55));
    const after = r.find((p) => p.t >= 1000)!;
    expect(after.shown).toBeCloseTo(0.55, 6);
  });

  it('быстрый взмах (3 корпуса в секунду) — отстаёт меньше чем на 0,05 корпуса (~2,5 см)', () => {
    const v = (3 * TORSO) / ASPECT / 1000;
    const r = track((t) => 0.2 + v * t, { ms: 400 });
    const lag = Math.max(...r.slice(5).map((p) => ((p.raw - p.shown) * ASPECT) / TORSO));
    expect(lag).toBeLessThan(0.05);
  });

  it('медленное движение (0,3 корпуса в секунду) — тоже не больше 0,05 корпуса', () => {
    const v = (0.3 * TORSO) / ASPECT / 1000;
    const r = track((t) => 0.2 + v * t, { ms: 3000 });
    const lag = Math.max(...r.slice(30).map((p) => ((p.raw - p.shown) * ASPECT) / TORSO));
    expect(lag).toBeLessThan(0.05);
  });

  it('на 15 FPS покой сглаживается так же, отставание на движении не растёт', () => {
    const still30 = track(() => 0.4, { noise: 0.002 });
    const still15 = track(() => 0.4, { noise: 0.002, fps: 15 });
    expect(jitter(still15.map((p) => p.shown))).toBeLessThan(jitter(still15.map((p) => p.raw)) / 2);
    expect(still30.length).toBeGreaterThan(still15.length);
    const v = (3 * TORSO) / ASPECT / 1000;
    const r = track((t) => 0.2 + v * t, { ms: 400, fps: 15 });
    const lag = Math.max(...r.slice(3).map((p) => ((p.raw - p.shown) * ASPECT) / TORSO));
    expect(lag).toBeLessThan(0.05);
  });

  it('человек пропал и вернулся (пауза больше 0,5 с) — скелет сразу там, где тело', () => {
    const s = new RenderSmoother();
    const a = pose(0.2, 0.5);
    s.apply(a, a, 0, ASPECT, TORSO);
    s.apply(a, a, 33, ASPECT, TORSO);
    const b = pose(0.21, 0.5);
    // Сдвиг мелкий — без паузы он бы сгладился, после паузы — нет.
    expect(s.apply(b, b, 1000, ASPECT, TORSO)[15]!.x).toBeCloseTo(0.21, 6);
  });

  it('глубина и видимость — из точек движка, координаты — свои; битая точка не ломает скелет', () => {
    const s = new RenderSmoother();
    const raw = pose(0.3, 0.5);
    const base = pose(0.31, 0.49, -0.2);
    const out = s.apply(raw, base, 0, ASPECT, TORSO);
    expect(out[15]).toMatchObject({ x: 0.3, y: 0.5, z: -0.2, v: 0.9 });
    const bad = pose(Number.NaN, 0.5);
    const next = s.apply(bad, bad, 33, ASPECT, TORSO);
    expect(next[15]!.x).toBeCloseTo(0.3, 6);
  });
});
