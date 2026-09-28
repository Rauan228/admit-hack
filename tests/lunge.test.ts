import { createLunge } from '../src/engine/exercises/lunge';
import { createSquat } from '../src/engine/exercises/squat';
import { LM } from '../src/engine/hints';
import { loadFixture } from './helpers/replay';
import { fixtureFrames, runSession } from './helpers/session';
import { gaussian, lungeFrame, lungeSet, squatPose, squatTrack, synthFrame } from './helpers/synth';

const lunge = createLunge();
const run = (frames: Parameters<typeof runSession>[0]) => runSession(frames, lunge);
const share = (res: ReturnType<typeof run>, code: string) =>
  res.reps.filter((r) => r.errors.includes(code)).length / Math.max(1, res.reps.length);

describe('выпады: глубина по заднему колену', () => {
  it('стоя прогресс ~0, внизу выпада > 1, задняя нога определяется сама', () => {
    const meter = lunge.createMeter();
    const stand = meter.measure(lungeFrame({ depth: 0, back: 'right' }, 0), 'start');
    const bottom = meter.measure(lungeFrame({ depth: 1, back: 'right' }, 33), 'bottom');
    expect(stand?.progress).toBeCloseTo(0, 1);
    expect(bottom?.progress).toBeGreaterThan(1);
    expect(bottom?.back).toBe('right');
    const other = lunge.createMeter();
    other.measure(lungeFrame({ depth: 0, back: 'left' }, 0), 'start');
    expect(other.measure(lungeFrame({ depth: 1, back: 'left' }, 33), 'bottom')?.back).toBe('left');
  });
});

describe('выпады: счёт', () => {
  it('10 выпадов со сменой ног — 10, без ошибок', () => {
    const res = run(lungeSet({ reps: 10 }));
    expect(res.reps).toHaveLength(10);
    expect(res.reps.flatMap((r) => r.errors)).toEqual([]);
    expect(res.shown).toEqual([]);
  });

  it('на 15 FPS — 10', () => {
    expect(run(lungeSet({ reps: 10, fps: 15 })).reps).toHaveLength(10);
  });

  it('удержание внизу 13 с (как на реальной записи) — один выпад, не таймаут', () => {
    expect(run(lungeSet({ reps: 1, holdMs: 13000 })).reps).toHaveLength(1);
  });

  it('приседания — не выпады (сгибаются обе ноги)', () => {
    const noise = gaussian(0.003, 4);
    const frames = squatTrack({ reps: 5, depth: 100 }).map(({ t, thigh }) =>
      synthFrame(squatPose(thigh), t, noise),
    );
    expect(run(frames).reps).toHaveLength(0);
    // И наоборот: выпады приседанием не считаются.
    expect(runSession(lungeSet({ reps: 4 }), createSquat()).reps.length).toBeLessThan(4);
  });
});

describe('выпады: ошибки (PLAN §3)', () => {
  it('заднее колено высоко: back_knee_high, подсвечено заднее колено, стрелка вниз', () => {
    // Глубина 0,45: колено останавливается на полпути к полу.
    const res = run(lungeSet({ reps: 4, depth: 0.45 }));
    expect(res.reps).toHaveLength(4);
    expect(share(res, 'back_knee_high')).toBe(1);
    const hint = res.shown.find((e) => e.code === 'back_knee_high');
    expect(hint).toMatchObject({ message: 'Опусти заднее колено ближе к полу', arrow: 'down' });
    // Первый выпад — правая нога сзади.
    expect(hint?.joints).toEqual([LM.rightKnee]);
  });

  it('колено передней ноги далеко за носком (15 см): knee_past_toe, подсвечены колено и носок передней ноги', () => {
    const res = run(lungeSet({ reps: 4, kneeForward: 0.15 }));
    expect(res.reps).toHaveLength(4);
    expect(share(res, 'knee_past_toe')).toBe(1);
    const hint = res.shown.find((e) => e.code === 'knee_past_toe');
    expect(hint?.message).toBe('Колено не дальше носка — шаг длиннее');
    // Первый выпад: сзади правая, значит передняя — левая.
    expect(hint?.joints).toEqual([LM.leftKnee, LM.leftFootIndex]);
  });

  it('колено чуть впереди (4 см) — в пределах погрешности, не ошибка', () => {
    expect(share(run(lungeSet({ reps: 4, kneeForward: 0.04 })), 'knee_past_toe')).toBe(0);
  });

  it('наклон корпуса 35°: torso_lean', () => {
    const res = run(lungeSet({ reps: 4, lean: 35 }));
    expect(share(res, 'torso_lean')).toBe(1);
    expect(res.shown.find((e) => e.code === 'torso_lean')?.message).toBe('Корпус вертикально');
  });

  it('наклон 15° — норма', () => {
    expect(share(run(lungeSet({ reps: 4, lean: 15 })), 'torso_lean')).toBe(0);
  });
});

describe('выпады на реальных записях (Wikimedia Commons → MediaPipe)', () => {
  it.each([1, 2])(
    'анфас, удержание 11–13 с с поворотом корпуса: ровно 2 выпада, без ошибок (прореживание %i)',
    (every) => {
      const res = run(fixtureFrames(loadFixture('lunge-front-hold.json'), every));
      expect(res.reps).toHaveLength(2);
      expect(res.reps.flatMap((r) => r.errors)).toEqual([]);
    },
  );

  it.each([1, 2])(
    'против света, 5 выпадов: насчитано 5 ± 1 (левая нога в силуэте почти не видна) (прореживание %i)',
    (every) => {
      const file = loadFixture('lunge-front-backlit.json');
      const res = run(fixtureFrames(file, every));
      expect((file.meta as { expected: { reps: number } }).expected.reps).toBe(5);
      expect(res.reps.length).toBeGreaterThanOrEqual(4);
      expect(res.reps.length).toBeLessThanOrEqual(6);
      // Выпады с хорошо видимой задней ногой (правой) — глубокие и без ошибок.
      const clean = res.reps.filter((r) => r.ctx.summary.pMax >= 1.5);
      expect(clean.length).toBe(3);
      expect(clean.flatMap((r) => r.errors)).toEqual([]);
    },
  );
});
