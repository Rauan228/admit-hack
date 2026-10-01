import type { Landmark } from '../src/engine/types';
import { STANCE, StanceTracker } from '../src/fight/stance';

const ASPECT = 16 / 9;

/** Человек анфас по пояс в кадре 16:9: плечи на 0,45 высоты, ширина плеч 0,2 высоты. */
function pose(o: {
  cx?: number;
  cy?: number;
  lw?: [number, number];
  rw?: [number, number];
  wristV?: number;
  shoulderV?: number;
}): Landmark[] {
  const cx = o.cx ?? 0.5; // в долях высоты
  const cy = o.cy ?? 0.45;
  const sw = 0.2;
  const lms: Landmark[] = Array.from({ length: 33 }, () => ({ x: 0, y: 0, z: 0, v: 0 }));
  const put = (i: number, xh: number, y: number, v = 1) => (lms[i] = { x: xh / ASPECT, y, z: 0, v });
  put(0, cx, cy - 0.16); // нос
  put(11, cx + sw / 2, cy, o.shoulderV ?? 1);
  put(12, cx - sw / 2, cy, o.shoulderV ?? 1);
  // Кисти задаются относительно носа: [вбок (ширин плеч), вниз от носа (ширин плеч)].
  const [lx, ly] = o.lw ?? [0.4, 0.4];
  const [rx, ry] = o.rw ?? [-0.4, 0.4];
  put(15, cx + lx * sw, cy - 0.16 + ly * sw, o.wristV ?? 1);
  put(16, cx + rx * sw, cy - 0.16 + ry * sw, o.wristV ?? 1);
  put(23, cx + sw / 2, cy + 0.4);
  put(24, cx - sw / 2, cy + 0.4);
  return lms;
}

describe('стойка бойца: защита', () => {
  it('оба кулака у подбородка — защита', () => {
    const s = new StanceTracker();
    expect(s.update(pose({}), 0, ASPECT)).toEqual({ guard: true, dodge: false });
  });

  it('руки опущены ниже плеч — защиты нет', () => {
    const s = new StanceTracker();
    expect(s.update(pose({ lw: [0.5, 1.6], rw: [-0.5, 1.6] }), 0, ASPECT).guard).toBe(false);
  });

  it('одна рука у подбородка, вторая опущена — защиты нет (бьёшь или открылся)', () => {
    const s = new StanceTracker();
    expect(s.update(pose({ rw: [-0.5, 1.6] }), 0, ASPECT).guard).toBe(false);
  });

  it('руки над головой — это жест «руки вверх», не защита', () => {
    const s = new StanceTracker();
    expect(s.update(pose({ lw: [0.3, -1.5], rw: [-0.3, -1.5] }), 0, ASPECT).guard).toBe(false);
  });

  it('руки разведены в стороны — не защита', () => {
    const s = new StanceTracker();
    expect(s.update(pose({ lw: [1.6, 0.4], rw: [-1.6, 0.4] }), 0, ASPECT).guard).toBe(false);
  });

  it('кисти не видны — не защита; плечи не видны — ничего', () => {
    const s = new StanceTracker();
    expect(s.update(pose({ wristV: 0.2 }), 0, ASPECT).guard).toBe(false);
    expect(s.update(pose({ shoulderV: 0.1 }), 0, ASPECT)).toEqual({ guard: false, dodge: false });
  });
});

describe('стойка бойца: уклон', () => {
  it('стоишь ровно — уклона нет; резко ушёл в сторону на полширины плеч — уклон', () => {
    const s = new StanceTracker();
    for (let t = 0; t < 2000; t += 33) expect(s.update(pose({}), t, ASPECT).dodge).toBe(false);
    expect(s.update(pose({ cx: 0.5 + 0.2 * (STANCE.dodgeSide + 0.1) }), 2033, ASPECT).dodge).toBe(true);
  });

  it('нырок — плечи вниз — уклон; подпрыгнул — нет', () => {
    const s = new StanceTracker();
    for (let t = 0; t < 2000; t += 33) s.update(pose({}), t, ASPECT);
    expect(s.update(pose({ cy: 0.45 + 0.2 * (STANCE.dodgeDuck + 0.1) }), 2033, ASPECT).dodge).toBe(true);
    const s2 = new StanceTracker();
    for (let t = 0; t < 2000; t += 33) s2.update(pose({}), t, ASPECT);
    expect(s2.update(pose({ cy: 0.45 - 0.2 * (STANCE.dodgeDuck + 0.1) }), 2033, ASPECT).dodge).toBe(false);
  });

  it('долго стоишь в наклоне — среднее догоняет, уклон перестаёт считаться', () => {
    const s = new StanceTracker();
    for (let t = 0; t < 2000; t += 33) s.update(pose({}), t, ASPECT);
    const leaned = pose({ cx: 0.5 + 0.2 * (STANCE.dodgeSide + 0.1) });
    expect(s.update(leaned, 2033, ASPECT).dodge).toBe(true);
    let last = true;
    for (let t = 2066; t < 8000; t += 33) last = s.update(leaned, t, ASPECT).dodge;
    expect(last).toBe(false);
  });

  it('первый кадр после потери тела — не уклон (среднее берётся заново)', () => {
    const s = new StanceTracker();
    for (let t = 0; t < 1000; t += 33) s.update(pose({}), t, ASPECT);
    s.update(pose({ shoulderV: 0.1 }), 1033, ASPECT);
    expect(s.update(pose({ cx: 0.9 }), 1066, ASPECT).dodge).toBe(false);
  });
});
