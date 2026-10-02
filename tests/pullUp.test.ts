// Подтягивания (E-39): счёт только на турнике. Синтетика: вис → подъём всем телом (стопы отрываются) →
// обратно; и то, что подтягиванием не является: махи руками стоя, прыжки с руками вверх, вис без перекладины
// в кадре. Реальные записи — в tests/fixtures (pull-up-*.json), их проверяет fixtures.test.ts.

import { createExercise } from '../src/engine/exercises';
import type { BaseMetrics, ExerciseDef } from '../src/engine/exercises/types';
import type { PoseFrame } from '../src/engine/geometry';
import { analyzeBar, BAR_H, BAR_W } from '../src/engine/bar';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadFixture } from './helpers/replay';
import { fixtureFrames, runSession } from './helpers/session';
import { gaussian, STAND, synthFrame } from './helpers/synth';

const def = () => createExercise('pull_up') as ExerciseDef<BaseMetrics>;
const wave = (x: number) => 0.5 - 0.5 * Math.cos(2 * Math.PI * x);
const BAR = { y: 0.12, score: 0.8 };

/**
 * n подтягиваний по 2,4 с: кисти на перекладине неподвижны, тело поднимается к ним на lift (доля высоты кадра).
 * feet: false — стопы остаются на полу (тянется на носках). armsOnly — стоит и машет руками вверх-вниз.
 * bar — что камера видит у кистей.
 */
function set(
  n: number,
  o: { lift?: number; feet?: boolean; bar?: typeof BAR | null; fps?: number; armsOnly?: boolean } = {},
): PoseFrame[] {
  const noise = gaussian(0.003, 9);
  const out: PoseFrame[] = [];
  const period = 2400;
  const HANDS = new Set([15, 16, 17, 18, 19, 20, 21, 22]);
  const FEET = new Set([25, 26, 27, 28, 29, 30, 31, 32]);
  for (let t = 0; t <= 1500 + n * period + 1500; t += 1000 / (o.fps ?? 30)) {
    const u = t - 1500;
    const k = u >= 0 && u < n * period ? wave((u % period) / period) : 0;
    const lift = (o.lift ?? 0.2) * k;
    const arms = o.armsOnly ? 20 + 152 * k : 172;
    const f = synthFrame({ ...STAND, height: 0.66, arms, footY: 0.97 }, t, noise);
    if (!o.armsOnly)
      f.image = f.image.map((p, i) =>
        HANDS.has(i) || (o.feet === false && FEET.has(i)) ? p : { ...p, y: p.y - lift },
      );
    if (o.bar !== undefined) f.bar = o.bar;
    out.push(f);
  }
  return out;
}

describe('подтягивания: синтетика', () => {
  it('5 подтягиваний на турнике — 5, и на 15 FPS', () => {
    expect(runSession(set(5, { bar: BAR }), def()).reps).toHaveLength(5);
    expect(runSession(set(5, { bar: BAR, fps: 15 }), def()).reps).toHaveLength(5);
  });

  it('сбоку (перекладины не ищем) — тоже 5', () => {
    expect(runSession(set(5), def()).reps).toHaveLength(5);
  });

  it('махи руками стоя — ни одного', () => {
    expect(runSession(set(6, { armsOnly: true, bar: null }), def()).reps).toHaveLength(0);
    expect(runSession(set(6, { armsOnly: true }), def()).reps).toHaveLength(0);
  });

  it('стопы на полу, плечи «поднимаются» (руки вверх, привстал на носки) — ни одного', () => {
    const r = runSession(set(5, { feet: false, bar: BAR }), def());
    expect(r.reps).toHaveLength(0);
  });

  it('анфас, а перекладины в кадре нет — счёт стоит и подсказка «не вижу турник»', () => {
    const r = runSession(set(5, { bar: null }), def());
    expect(r.reps).toHaveLength(0);
    expect(r.shown.map((e) => e.code)).toContain('no_bar');
  });

  it('подтянулся наполовину — «подтянись выше»', () => {
    const r = runSession(set(4, { bar: BAR, lift: 0.08 }), def());
    expect([...r.reps, ...r.attempts].flatMap((x) => x.errors)).toContain('chin_low');
  });
});

describe('турник по пикселям', () => {
  const region = { x0: 0, y0: 0, x1: 1, y1: 0.25 };
  const img = (draw: (x: number, y: number) => number) => {
    const g = new Uint8Array(BAR_W * BAR_H);
    for (let y = 0; y < BAR_H; y++) for (let x = 0; x < BAR_W; x++) g[y * BAR_W + x] = draw(x, y);
    return g;
  };
  const noise = gaussian(6, 3);

  it('тёмная перекладина на светлом фоне — найдена, на своей высоте', () => {
    const seen = analyzeBar(
      img((_, y) => (Math.abs(y - 20) <= 1 ? 40 : 200) + noise()),
      region,
    );
    expect(seen?.score).toBeGreaterThan(0.8);
    expect(seen!.y).toBeCloseTo(region.y0 + (20 / BAR_H) * (region.y1 - region.y0), 2);
  });

  it('светлая перекладина на тёмном и чуть наклонённая (камера под углом) — найдена', () => {
    const seen = analyzeBar(
      img((x, y) => (Math.abs(y - (14 + (x - BAR_W / 2) * 0.05)) <= 1.5 ? 220 : 60) + noise()),
      region,
    );
    expect(seen?.score).toBeGreaterThan(0.6);
  });

  it('ровная стена, шум, граница света — не перекладина', () => {
    expect(
      analyzeBar(
        img(() => 128 + noise()),
        region,
      )?.score ?? 0,
    ).toBeLessThan(0.2);
    expect(
      analyzeBar(
        img((_, y) => (y < 24 ? 60 : 200) + noise()),
        region,
      )?.score ?? 0,
    ).toBeLessThan(0.2);
  });
});

describe('подтягивания: на записях других упражнений — ни одного', () => {
  const others = readdirSync(fileURLToPath(new URL('./fixtures/', import.meta.url))).filter(
    (f) => f.endsWith('.json') && !f.startsWith('pull-up'),
  );
  for (const name of others) {
    it(name, () => {
      const file = loadFixture(name);
      // Без поиска турника (как сбоку) и как в живой камере — линии у кистей нет.
      for (const bar of [undefined, null] as const) {
        const frames = fixtureFrames(file).map((f) => (f && bar === null ? { ...f, bar } : f));
        expect(runSession(frames, def()).reps, String(bar)).toHaveLength(0);
      }
    });
  }
});
