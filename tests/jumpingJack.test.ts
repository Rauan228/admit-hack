import { createJumpingJack } from '../src/engine/exercises/jumpingJack';
import { LM } from '../src/engine/hints';
import { loadFixture } from './helpers/replay';
import { fixtureFrames, runSession } from './helpers/session';
import { jackFrames } from './helpers/synth';

const jj = createJumpingJack();
const run = (frames: Parameters<typeof runSession>[0]) => runSession(frames, jj);
const share = (res: ReturnType<typeof run>, code: string) =>
  res.reps.filter((r) => r.errors.includes(code)).length / Math.max(1, res.reps.length);

describe('«звёздочка»: счёт', () => {
  it('10 правильных прыжков — 10, без ошибок и подсказок', () => {
    const res = run(jackFrames({ reps: 10 }));
    expect(res.reps).toHaveLength(10);
    expect(res.reps.flatMap((r) => r.errors)).toEqual([]);
    expect(res.shown).toEqual([]);
  });

  it('на 15 FPS — тоже 10', () => {
    expect(run(jackFrames({ reps: 10, fps: 15 })).reps).toHaveLength(10);
  });

  it('быстрые прыжки (0,7 с на прыжок) — 10', () => {
    expect(run(jackFrames({ reps: 10, periodMs: 700 })).reps).toHaveLength(10);
  });

  it('человек стоит на ширине плеч между прыжками — всё равно 10 (ноги считаются от своей стойки)', () => {
    const res = run(jackFrames({ reps: 10, stanceRest: 2.2, stanceTop: 5 }));
    expect(res.reps).toHaveLength(10);
  });

  it('просто стоит — 0', () => {
    expect(run(jackFrames({ reps: 0, leadMs: 5000 })).reps).toHaveLength(0);
  });

  it('руки над головой — упражнение: жест «обе руки вверх» на подходе отключается', () => {
    expect(jj.armsOverhead).toBe(true);
  });
});

describe('«звёздочка»: ошибки', () => {
  it('руки только до плеч: arms_low, подсказка «Подними руки выше головы», стрелка вверх', () => {
    const res = run(jackFrames({ reps: 6, armTop: 95 }));
    expect(res.reps).toHaveLength(6);
    expect(share(res, 'arms_low')).toBe(1);
    const hint = res.shown.find((e) => e.code === 'arms_low');
    expect(hint).toMatchObject({ message: 'Подними руки выше головы', arrow: 'up' });
    expect(hint?.joints).toEqual([LM.leftWrist, LM.rightWrist]);
  });

  it('одна рука ниже — подсвечено именно её запястье', () => {
    const res = run(jackFrames({ reps: 6, armTopL: 100 }));
    expect(share(res, 'arms_low')).toBe(1);
    expect(res.shown.find((e) => e.code === 'arms_low')?.joints).toEqual([LM.leftWrist]);
  });

  it('ноги узко (стопы не шире плеч): feet_narrow', () => {
    const res = run(jackFrames({ reps: 6, stanceTop: 2.0 }));
    expect(res.reps.length).toBeGreaterThan(0);
    expect(share(res, 'feet_narrow')).toBe(1);
    expect(res.shown.find((e) => e.code === 'feet_narrow')?.message).toBe('Шире ноги — шире плеч');
  });

  it('прыгает только руками — повтор засчитан, но с ошибкой «шире ноги»', () => {
    const res = run(jackFrames({ reps: 6, stanceTop: 1.0 }));
    expect(res.reps).toHaveLength(6);
    expect(share(res, 'feet_narrow')).toBe(1);
  });

  it('ноги отстают от рук на 0,3 с: not_synced', () => {
    const res = run(jackFrames({ reps: 6, periodMs: 1200, legLagMs: 300 }));
    expect(res.reps.length).toBeGreaterThanOrEqual(5);
    expect(share(res, 'not_synced')).toBeGreaterThan(0.8);
    expect(res.shown.find((e) => e.code === 'not_synced')?.message).toBe('Руки и ноги — одновременно');
  });

  it('противофаза (руки вверх — ноги вместе, руки вниз — ноги врозь): каждый цикл по рукам, с not_synced, без «шире ноги»', () => {
    for (const fps of [30, 15]) {
      const res = run(jackFrames({ reps: 8, periodMs: 1200, legLagMs: 600, fps }));
      expect(res.reps.length).toBeGreaterThanOrEqual(7);
      expect(share(res, 'not_synced')).toBeGreaterThan(0.8);
      expect(share(res, 'feet_narrow')).toBeLessThan(0.2);
      expect(res.shown.map((e) => e.code)).toContain('not_synced');
    }
  });

  it('небольшое естественное запаздывание (0,1 с) — не ошибка', () => {
    const res = run(jackFrames({ reps: 6, legLagMs: 100 }));
    expect(share(res, 'not_synced')).toBe(0);
  });
});

describe('«звёздочка» на реальной записи (Wikimedia Commons → MediaPipe)', () => {
  const file = loadFixture('jumping-jack-front.json');

  it.each([1, 2])('6 прыжков, бёрпи между ними не считаются (прореживание %i)', (every) => {
    const res = run(fixtureFrames(file, every));
    expect((file.meta as { expected: { reps: number } }).expected.reps).toBe(6);
    expect(res.reps).toHaveLength(6);
    expect(res.attempts).toHaveLength(0);
  });

  it('хорошая техника — ни одной ложной ошибки и подсказки', () => {
    const res = run(fixtureFrames(file));
    expect(res.reps.flatMap((r) => r.errors)).toEqual([]);
    expect(res.shown).toEqual([]);
  });
});
