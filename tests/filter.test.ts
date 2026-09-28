import { ENGINE_CONFIG } from '../src/engine/config';
import { LandmarkSmoother, OneEuroFilter } from '../src/engine/filter';
import type { Landmark } from '../src/engine/types';

/** Детерминированный «шум модели»: псевдослучайные числа с сидом. */
function noise(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296 - 0.5;
  };
}

const std = (xs: number[]) => {
  const m = xs.reduce((a, b) => a + b, 0) / xs.length;
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length);
};

const PARAMS = ENGINE_CONFIG.filter.image;
const DT = 1000 / 30;

describe('OneEuroFilter', () => {
  it('первый кадр проходит без изменений', () => {
    expect(new OneEuroFilter(PARAMS).filter(0.42, 0)).toBe(0.42);
  });

  it('гасит дрожание неподвижной точки минимум в 3 раза', () => {
    const f = new OneEuroFilter(PARAMS);
    const rnd = noise(1);
    const raw: number[] = [];
    const out: number[] = [];
    for (let i = 0; i < 300; i++) {
      const v = 0.5 + rnd() * 0.01; // дрожание ±0,5 % кадра, как у MediaPipe в покое
      raw.push(v);
      out.push(f.filter(v, i * DT, 0.3));
    }
    expect(std(out.slice(30))).toBeLessThan(std(raw.slice(30)) / 3);
  });

  it('быстрое движение догоняет почти без задержки', () => {
    const f = new OneEuroFilter(PARAMS);
    // Рука за 0,3 с пролетает полкадра (взмах в «звёздочке»).
    let lagAtEnd = 0;
    for (let i = 0; i <= 9; i++) {
      const v = 0.2 + (0.5 * i) / 9;
      lagAtEnd = v - f.filter(v, i * DT, 0.3);
    }
    expect(lagAtEnd).toBeLessThan(0.06);
  });

  it('медленный присед отстаёт меньше чем на 2 % кадра', () => {
    const f = new OneEuroFilter(PARAMS);
    let worst = 0;
    for (let i = 0; i < 60; i++) {
      const v = 0.5 + 0.15 * Math.sin((i / 60) * Math.PI);
      worst = Math.max(worst, Math.abs(v - f.filter(v, i * DT, 0.3)));
    }
    expect(worst).toBeLessThan(0.02);
  });

  it('при большой скорости срез выше: beta уменьшает задержку', () => {
    const lag = (beta: number) => {
      const f = new OneEuroFilter({ ...PARAMS, beta });
      let last = 0;
      for (let i = 0; i <= 10; i++) last = 0.1 * i - f.filter(0.1 * i, i * DT, 0.3);
      return last;
    };
    expect(lag(PARAMS.beta)).toBeLessThan(lag(0));
  });

  it('повтор того же времени не ломает фильтр', () => {
    const f = new OneEuroFilter(PARAMS);
    f.filter(0.5, 0);
    const a = f.filter(0.6, DT);
    expect(f.filter(0.9, DT)).toBe(a);
    expect(Number.isFinite(f.filter(0.7, 2 * DT))).toBe(true);
  });

  it('после пропажи человека история сбрасывается, а не тянет точку из старого места', () => {
    const f = new OneEuroFilter(PARAMS, 500);
    for (let i = 0; i < 30; i++) f.filter(0.2, i * DT);
    // Через 2 с человек появился в другом конце кадра.
    expect(f.filter(0.8, 30 * DT + 2000)).toBe(0.8);
  });

  it('NaN не отравляет фильтр', () => {
    const f = new OneEuroFilter(PARAMS);
    f.filter(0.5, 0);
    expect(f.filter(NaN, DT)).toBeNaN();
    expect(f.filter(0.5, 2 * DT)).toBeCloseTo(0.5);
  });
});

describe('LandmarkSmoother', () => {
  const pose = (dx: number, v = 0.9): Landmark[] =>
    Array.from({ length: 33 }, (_, i) => ({ x: 0.3 + i * 0.01 + dx, y: 0.5, z: -0.1, v }));

  it('сглаживает все 33 точки и не трогает видимость', () => {
    const s = new LandmarkSmoother();
    s.smoothImage(pose(0), 0, 0.3);
    const out = s.smoothImage(pose(0.01, 0.4), DT, 0.3);
    expect(out).toHaveLength(33);
    expect(out[0]?.v).toBe(0.4);
    expect(out[0]?.x).toBeGreaterThan(0.3);
    expect(out[0]?.x).toBeLessThan(0.31);
  });

  it('мировые точки сглаживаются отдельным банком', () => {
    const s = new LandmarkSmoother();
    const w = (z: number) => Array.from({ length: 33 }, () => ({ x: 0, y: 0, z }));
    s.smoothWorld(w(0), 0);
    const out = s.smoothWorld(w(0.1), DT);
    expect(out[5]?.z).toBeGreaterThan(0);
    expect(out[5]?.z).toBeLessThan(0.1);
  });

  it('reset забывает прошлое', () => {
    const s = new LandmarkSmoother();
    s.smoothImage(pose(0), 0, 0.3);
    s.reset();
    expect(s.smoothImage(pose(0.2), DT, 0.3)[0]?.x).toBeCloseTo(0.5);
  });
});
