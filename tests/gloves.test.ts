import { readFileSync } from 'node:fs';
import { STAND, synthFrame, type SynthParams } from '../src/engine/skeleton';
import type { Landmark } from '../src/engine/types';
import { GLOVES, GloveTracker, framing, punchPulse } from '../src/fight/gloves';

const frame = (p: Partial<SynthParams>) => synthFrame({ ...STAND, ...p }, 0);

/** Подержать позу n кадров по 33 мс, начиная с t0. */
function hold(g: GloveTracker, p: Partial<SynthParams>, t0: number, n = 8) {
  const f = frame(p);
  let r = g.update(f.image, t0, f.aspect);
  for (let i = 1; i < n; i++) r = g.update(f.image, t0 + i * 33, f.aspect);
  return r;
}

describe('перчатки от первого лица', () => {
  it('руки опущены — перчатки не вынесены', () => {
    const r = hold(new GloveTracker(), {}, 0);
    expect(r.left.ext).toBe(0);
    expect(r.right.ext).toBe(0);
  });

  it('кулаки у подбородка — стойка: не вынесены, левая слева, правая справа, выше плеч', () => {
    const g = new GloveTracker();
    hold(g, {}, 0);
    const r = hold(g, { punchL: 0, punchR: 0 }, 1000);
    expect(r.left.ext).toBeLessThan(0.1);
    expect(r.right.ext).toBeLessThan(0.1);
    expect(r.left.x).toBeLessThan(0);
    expect(r.right.x).toBeGreaterThan(0);
    expect(r.left.y).toBeLessThan(0);
  });

  it('прямой левой — выносится только левая', () => {
    const g = new GloveTracker();
    hold(g, { punchL: 0, punchR: 0 }, 0);
    const r = hold(g, { punchL: 1, punchR: 0 }, 1000);
    expect(r.left.ext).toBeGreaterThan(0.8);
    expect(r.right.ext).toBeLessThan(0.1);
  });

  it('засчитанный удар добивает перчатку вперёд и она возвращается', () => {
    const g = new GloveTracker();
    hold(g, { punchL: 0, punchR: 0 }, 0);
    const side = g.punch(1000, 'right');
    expect(side).toBe('right');
    expect(g.read(1000 + GLOVES.punchOutMs).right.ext).toBeCloseTo(1, 5);
    expect(g.read(1000 + GLOVES.punchOutMs + GLOVES.punchBackMs + 1).right.ext).toBeLessThan(0.1);
  });

  it('тела не видно — перчатки уходят в стойку', () => {
    const g = new GloveTracker();
    hold(g, { punchL: 1, punchR: 0 }, 0);
    const empty = Array.from({ length: 33 }, () => ({ x: 0, y: 0, z: 0, v: 0 }));
    let r = g.update(empty, 300, 4 / 3);
    for (let t = 333; t < 2000; t += 33) r = g.update(empty, t, 4 / 3);
    expect(r.left.ext).toBeLessThan(0.05);
    expect(r.left.seen).toBe(false);
  });

  it('удар движка сразу после своего выноса — второй раз перчатку не выбрасываем', () => {
    const g = new GloveTracker();
    hold(g, { punchL: 0, punchR: 0 }, 0);
    hold(g, { punchL: 1, punchR: 0 }, 1000);
    const back = hold(g, { punchL: 0, punchR: 0 }, 1300, 10);
    expect(g.punch(1630)).toBe('left');
    expect(g.read(1630 + GLOVES.punchOutMs).left.ext).toBeLessThanOrEqual(back.left.ext + 0.01);
  });

  it('добивка: 0 до удара, 1 на пике, 0 после', () => {
    expect(punchPulse(-5)).toBe(0);
    expect(punchPulse(GLOVES.punchOutMs)).toBeCloseTo(1, 5);
    expect(punchPulse(10_000)).toBe(0);
  });
});

describe('кадр для боя от первого лица', () => {
  it('стоя по пояс с локтями — хорошо; без человека — none', () => {
    const f = frame({ punchL: 0, punchR: 0 });
    expect(framing(f.image, f.aspect)).toBe('ok');
    expect(framing([], f.aspect)).toBe('none');
  });

  it('локтей не видно — просим отойти', () => {
    const f = frame({ punchL: 0, punchR: 0 });
    const lms = f.image.map((p, i) => (i === 13 ? { ...p, v: 0.1 } : p));
    expect(framing(lms, f.aspect)).toBe('elbows');
  });

  it('плечи у нижнего края — камера слишком высоко или человек близко', () => {
    const f = frame({ punchL: 0, punchR: 0 });
    const lms = f.image.map((p) => ({ ...p, y: p.y + 0.5 }));
    expect(framing(lms, f.aspect)).toBe('low');
  });
});

/** Запись боя с тенью анфас (tests/fixtures/fpv), удары размечены по раскадровке. */
describe('перчатки на записи боксёра', () => {
  const file = JSON.parse(
    readFileSync(new URL('./fixtures/fpv/boxing-pexels-front.json', import.meta.url), 'utf8'),
  ) as {
    aspect: number;
    frames: { t: number; p: number[] }[];
    meta: {
      punches: { side: 'left' | 'right'; from: number; to: number }[];
      guard: { from: number; to: number }[];
    };
  };
  const g = new GloveTracker();
  const trace = file.frames.map((fr) => {
    const p = fr.p;
    const lms: Landmark[] = p.length
      ? Array.from({ length: 33 }, (_, i) => ({
          x: p[i * 4]!,
          y: p[i * 4 + 1]!,
          z: p[i * 4 + 2]!,
          v: p[i * 4 + 3]!,
        }))
      : [];
    return { t: fr.t / 1000, r: g.update(lms, fr.t, file.aspect) };
  });
  const within = (a: number, b: number) => trace.filter((x) => x.t >= a && x.t <= b);

  it.each(file.meta.punches)('удар $side $from–$to с: бьющая перчатка вынесена', ({ side, from, to }) => {
    expect(Math.max(...within(from, to).map((x) => x.r[side].ext))).toBeGreaterThan(0.8);
  });

  it('в стойке правая перчатка стоит', () => {
    for (const { from, to } of file.meta.guard)
      expect(Math.max(...within(from, to).map((x) => x.r.right.ext))).toBeLessThan(0.3);
  });
});
