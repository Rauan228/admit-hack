// Бокс, отжимания, планка, бёрпи (E-22; отжимания и планка лицом к камере — E-31). Правильная техника —
// ровно N повторов без ошибок (и на 15 FPS), каждая ошибка ловится; планка считает секунды; отжимания и
// бёрпи — на реальных записях людей.

import { createExercise } from '../src/engine/exercises';
import type { BaseMetrics, ExerciseDef } from '../src/engine/exercises/types';
import type { PoseFrame } from '../src/engine/geometry';
import { ExerciseSession } from '../src/engine/session';
import { blendFrames, floorFrame, frontPlankFrame, type FloorParams } from '../src/engine/skeleton';
import type { EngineEvent, ExerciseId } from '../src/engine/types';
import { loadFixture } from './helpers/replay';
import { fixtureFrames, runSession } from './helpers/session';
import { gaussian, squatPose, STAND, synthFrame } from './helpers/synth';

const def = (id: ExerciseId) => createExercise(id) as ExerciseDef<BaseMetrics>;
const wave = (x: number) => 0.5 - 0.5 * Math.cos(2 * Math.PI * x);
const shown = (res: ReturnType<typeof runSession>) => res.shown.map((e) => e.code);
const clean = (frames: PoseFrame[], id: ExerciseId, n: number) => {
  const res = runSession(frames, def(id));
  expect(res.reps).toHaveLength(n);
  expect(res.reps.flatMap((r) => r.errors)).toEqual([]);
  expect(res.shown).toEqual([]);
};

describe('бокс: прямые удары', () => {
  const punches = (o: { reach?: number; guardDrop?: boolean; fps?: number } = {}) => {
    const noise = gaussian(0.003, 21);
    const frames: PoseFrame[] = [];
    const period = 800;
    for (let t = 0; t <= 1500 + 10 * period + 1000; t += 1000 / (o.fps ?? 30)) {
      const u = t - 1500;
      const inSet = u >= 0 && u < 10 * period;
      const rep = inSet ? Math.floor(u / period) : 0;
      const k = inSet ? (o.reach ?? 1) * wave((u % period) / period) : 0;
      const left = rep % 2 === 0;
      // Вторая рука в защите — или опущена вдоль тела (ошибка).
      const other = o.guardDrop && inSet ? { [left ? 'armsL' : 'arms']: 10 } : {};
      frames.push(
        synthFrame(
          {
            ...STAND,
            ...(left
              ? { punchL: k, ...(o.guardDrop && inSet ? {} : { punchR: 0 }) }
              : { punchR: k, ...(o.guardDrop && inSet ? {} : { punchL: 0 }) }),
            ...other,
          },
          t,
          noise,
        ),
      );
    }
    return frames;
  };
  it('10 ударов по очереди — 10, без ошибок; на 15 FPS тоже', () => {
    clean(punches(), 'boxing', 10);
    clean(punches({ fps: 15 }), 'boxing', 10);
  });
  it('рука не до конца — «выпрямляй руку до конца»', () => {
    const res = runSession(punches({ reach: 0.6 }), def('boxing'));
    expect(res.reps.length + res.attempts.length).toBe(10);
    expect([...res.reps, ...res.attempts].every((r) => r.errors.includes('short_punch'))).toBe(true);
  });
  it('вторая рука опущена — «держи вторую руку у подбородка»', () => {
    expect(shown(runSession(punches({ guardDrop: true }), def('boxing')))).toContain('guard_down');
  });
  it('стоит в защите — ничего', () => {
    const noise = gaussian(0.003, 2);
    const frames = Array.from({ length: 200 }, (_, i) =>
      synthFrame({ ...STAND, punchL: 0, punchR: 0 }, i * 33, noise),
    );
    const res = runSession(frames, def('boxing'));
    expect(res.reps).toHaveLength(0);
    expect(res.shown).toEqual([]);
  });
});

/** Подход в упоре лёжа лицом к камере: 1,5 с в упоре на прямых руках, reps циклов, 1 с в упоре. */
function floorSet(
  reps: number,
  pose: (k: number) => Partial<FloorParams>,
  fps = 30,
  base: Partial<FloorParams> = {},
): PoseFrame[] {
  const noise = gaussian(0.003, 31);
  const frames: PoseFrame[] = [];
  const period = 2000;
  for (let t = 0; t <= 1500 + reps * period + 1000; t += 1000 / fps) {
    const u = t - 1500;
    const extra = u >= 0 && u < reps * period ? pose((u % period) / period) : {};
    frames.push(floorFrame({ down: 0, ...base, ...extra }, t, noise));
  }
  return frames;
}

describe('отжимания (лицом к камере, камера на полу)', () => {
  it('8 отжиманий грудью к полу — 8, без ошибок; на 15 FPS тоже', () => {
    clean(
      floorSet(8, (k) => ({ down: wave(k) })),
      'push_up',
      8,
    );
    clean(
      floorSet(8, (k) => ({ down: wave(k) }), 15),
      'push_up',
      8,
    );
  });
  it('телефон ближе или дальше (человек в кадре крупнее или мельче) — счёт тот же', () => {
    for (const height of [0.5, 1])
      clean(
        floorSet(6, (k) => ({ down: wave(k) }), 30, { height }),
        'push_up',
        6,
      );
  });
  it('неглубоко (на полпути) — «опускайся ниже»', () => {
    const res = runSession(
      floorSet(8, (k) => ({ down: 0.55 * wave(k) })),
      def('push_up'),
    );
    expect(res.reps.length + res.attempts.length).toBe(8);
    expect([...res.reps, ...res.attempts].every((r) => r.errors.includes('shallow_pushup'))).toBe(true);
  });
  it('заваливается на одну руку — «не заваливайся»; локти «буквой Т» — «локти не в стороны»', () => {
    expect(
      shown(
        runSession(
          floorSet(6, (k) => ({ down: wave(k), tilt: 0.5 * wave(k) })),
          def('push_up'),
        ),
      ),
    ).toContain('shoulders_uneven');
    expect(
      shown(
        runSession(
          floorSet(6, (k) => ({ down: wave(k), elbowsOut: 0.8 * wave(k) })),
          def('push_up'),
        ),
      ),
    ).toContain('elbows_wide');
  });
  it('стоя (не в упоре) сгибает руки — не отжимания', () => {
    const noise = gaussian(0.003, 4);
    const frames = Array.from({ length: 300 }, (_, i) =>
      synthFrame({ ...STAND, arms: 20, elbow: 90 * wave((i * 33) / 2000) }, i * 33, noise),
    );
    const res = runSession(frames, def('push_up'));
    expect(res.reps).toHaveLength(0);
    expect(res.shown).toEqual([]);
  });
  it('приседает лицом к камере — плечи ходят вниз, но это не отжимания', () => {
    const noise = gaussian(0.003, 5);
    const frames = Array.from({ length: 400 }, (_, i) =>
      synthFrame({ ...squatPose(100 * wave((i * 33) / 2000)), arms: 10 }, i * 33, noise),
    );
    const res = runSession(frames, def('push_up'));
    expect(res.reps).toHaveLength(0);
    expect(res.shown).toEqual([]);
  });
  it('реальная запись (RepChamp «Push Up Battle», лицом к камере): 31 отжимание, как насчитало приложение', () => {
    const res = runSession(fixtureFrames(loadFixture('push-up-front.json')), def('push_up'));
    expect(res.reps).toHaveLength(31);
    // Запись начинается внизу первого отжимания — верхней точки ещё не было, первое чуть «неглубокое».
    expect(res.reps.slice(1).flatMap((r) => r.errors)).toEqual([]);
    // Техника правильная — ни перекоса, ни локтей в стороны.
    expect(res.shown.map((e) => e.code).filter((c) => c !== 'shallow_pushup')).toEqual([]);
  });
  it('записи стоя (присеты, выпады, присед с жимом) — ни одного отжимания', () => {
    for (const name of [
      'squat-front-goblet.json',
      'squat-rear-barbell.json',
      'squat-side-goblet.json',
      'squat-side-backlit.json',
      'squat-press-kettlebell.json',
      // jumping-jack-front.json не здесь: в нём бёрпи с настоящим упором лёжа и опусканием к полу.
      'lunge-front-hold.json',
      'lunge-front-backlit.json',
    ])
      expect(runSession(fixtureFrames(loadFixture(name)), def('push_up')).reps).toHaveLength(0);
  });
});

describe('планка — на время', () => {
  const plankEvents = (seconds: number, extra: Partial<FloorParams> = {}, target = 100): EngineEvent[] => {
    const session = new ExerciseSession(def('plank'), target, 0);
    const noise = gaussian(0.003, 8);
    const events: EngineEvent[] = [];
    for (let t = 0; t <= seconds * 1000; t += 33) {
      events.push(...session.update(floorFrame({ down: 0, forearms: true, ...extra }, t, noise), t));
    }
    return events;
  };
  it('10 с в планке на локтях — 10 повторов-секунд без ошибок; на прямых руках тоже', () => {
    for (const forearms of [true, false]) {
      const events = plankEvents(10.05, { forearms });
      const reps = events.filter((e) => e.type === 'rep');
      expect(reps.length).toBeGreaterThanOrEqual(9);
      expect(reps.length).toBeLessThanOrEqual(10);
      expect(reps.flatMap((e) => (e.type === 'rep' ? e.errors : []))).toEqual([]);
    }
  });
  it('завалился на бок или локти далеко от плеч — подсказка и сниженная оценка секунд', () => {
    for (const [extra, code] of [
      [{ tilt: 0.45 }, 'shoulders_uneven'],
      [{ elbowsOut: 0.8 }, 'elbows_wide'],
    ] as const) {
      const events = plankEvents(6, extra);
      expect(events.some((e) => e.type === 'form_error' && e.code === code)).toBe(true);
      const scores = events.flatMap((e) => (e.type === 'rep' ? [e.score] : []));
      expect(scores.length).toBeGreaterThanOrEqual(4);
      expect(Math.max(...scores)).toBeLessThan(100);
    }
  });
  it('цель в секундах: 5 с — подход закрыт', () => {
    const events = plankEvents(8, {}, 5);
    expect(events.filter((e) => e.type === 'set_complete')).toHaveLength(1);
    expect(events.filter((e) => e.type === 'rep')).toHaveLength(5);
  });
  it('встал из планки — секунды сразу перестают идти (без «доводки» после выхода)', () => {
    const session = new ExerciseSession(def('plank'), 100, 0);
    const noise = gaussian(0.003, 9);
    const events: EngineEvent[] = [];
    for (let t = 0; t <= 5000; t += 33)
      events.push(...session.update(floorFrame({ down: 0, forearms: true }, t, noise), t));
    for (let t = 5033; t <= 8000; t += 33)
      events.push(...session.update(synthFrame({ ...STAND }, t, noise), t));
    // 5 с в планке минус 0,8 с на подтверждение — 4 секунды, и ни одной после того, как встал.
    expect(events.filter((e) => e.type === 'rep')).toHaveLength(4);
  });
  it('отжимания в упоре — не планка: секунды идут только за неподвижное удержание', () => {
    const session = new ExerciseSession(def('plank'), 100, 0);
    const events = floorSet(8, (k) => ({ down: wave(k) }), 30, { forearms: false }).flatMap((f) =>
      session.update(f, f.t),
    );
    // Неподвижно — 1,5 с до подхода и 1 с после: секунды только за них.
    expect(events.filter((e) => e.type === 'rep').length).toBeLessThanOrEqual(2);
  });
  it('лёг на пол и замер (кисти под плечами, руки согнуты) — секунды не идут, подсказка «не ложись»; снова встал в планку — идут', () => {
    const session = new ExerciseSession(def('plank'), 100, 0);
    const noise = gaussian(0.003, 12);
    const events: EngineEvent[] = [];
    for (let t = 0; t <= 4000; t += 33) events.push(...session.update(floorFrame({ down: 0 }, t, noise), t));
    const before = events.filter((e) => e.type === 'rep').length;
    for (let t = 4033; t <= 10000; t += 33) events.push(...session.update(floorFrame({ down: 1 }, t, noise), t));
    const lying = events.filter((e) => e.type === 'rep').length - before;
    for (let t = 10033; t <= 14000; t += 33) events.push(...session.update(floorFrame({ down: 0 }, t, noise), t));
    const after = events.filter((e) => e.type === 'rep').length - before - lying;
    expect(before).toBeGreaterThanOrEqual(3);
    // Полсекунды опускания могли ещё тикнуть — но не 6 секунд лёжа.
    expect(lying).toBeLessThanOrEqual(1);
    expect(after).toBeGreaterThanOrEqual(2);
    expect(events.some((e) => e.type === 'form_error' && e.code === 'plank_low')).toBe(true);
  });
  it('низ отжимания с реальных записей, замерший на 6 с (грудь у пола), — не планка', () => {
    for (const name of ['push-up-floor-front.json', 'push-up-front.json', 'push-up-front-three-quarter.json']) {
      const frames = fixtureFrames(loadFixture(name)).filter((f): f is PoseFrame => f !== null);
      // Кадр с самыми низкими плечами — низ отжимания; держим его неподвижно.
      const shY = (f: PoseFrame) => (f.image[11]!.y + f.image[12]!.y) / 2;
      const bottom = frames.reduce((a, b) => (shY(b) > shY(a) ? b : a));
      const session = new ExerciseSession(def('plank'), 100, 0);
      const noise = gaussian(0.002, 13);
      let reps = 0;
      for (let t = 0; t <= 6000; t += 33) {
        const f: PoseFrame = { ...bottom, t, image: bottom.image.map((p) => ({ ...p, x: p.x + noise(), y: p.y + noise() })) };
        reps += session.update(f, t).filter((e) => e.type === 'rep').length;
      }
      expect(reps, name).toBe(0);
    }
  });
  it('стоит — секунды не идут', () => {
    const session = new ExerciseSession(def('plank'), 100, 0);
    const noise = gaussian(0.003, 6);
    const events: EngineEvent[] = [];
    for (let t = 0; t < 5000; t += 33) events.push(...session.update(synthFrame({ ...STAND }, t, noise), t));
    expect(events.filter((e) => e.type === 'rep')).toHaveLength(0);
  });
});

describe('бёрпи', () => {
  /** Стойка → присед → упор лёжа лицом к камере → присед → встал → прыжок (если jump). */
  const burpees = (o: { jump?: boolean; plank?: boolean; fps?: number } = {}) => {
    const noise = gaussian(0.003, 41);
    const stand = synthFrame({ ...STAND, arms: 10 }, 0);
    // Присед с руками к полу — плечи опускаются лишь наполовину; упор лёжа — до ~0,3 высоты стоя.
    const crouch = synthFrame({ ...squatPose(90), lean: 30, arms: 10 }, 0);
    const low =
      o.plank === false ? synthFrame({ ...squatPose(100), lean: 30, arms: 10 }, 0) : frontPlankFrame({}, 0);
    const jump = synthFrame(
      { ...STAND, arms: o.jump === false ? 10 : 175, footY: o.jump === false ? 0.92 : 0.85 },
      0,
    );
    const keys: [number, PoseFrame][] = [
      [0, stand],
      [0.15, crouch],
      [0.3, low],
      [0.5, low],
      [0.65, crouch],
      [0.76, stand],
      [0.88, jump],
      [1, stand],
    ];
    const period = 3600;
    const frames: PoseFrame[] = [];
    for (let t = 0; t <= 1500 + 5 * period + 1500; t += 1000 / (o.fps ?? 30)) {
      const u = t - 1500;
      let f = stand;
      if (u >= 0 && u < 5 * period) {
        const k = (u % period) / period;
        for (let i = 1; i < keys.length; i++) {
          const [k0, a] = keys[i - 1]!;
          const [k1, b] = keys[i]!;
          if (k <= k1) {
            f = blendFrames(a, b, 0.5 - 0.5 * Math.cos((Math.PI * (k - k0)) / (k1 - k0)), t);
            break;
          }
        }
      }
      frames.push({
        ...f,
        t,
        image: f.image.map((p) => ({ ...p, x: p.x + noise(), y: p.y + noise() })),
      });
    }
    return frames;
  };
  it('5 бёрпи с прыжком — 5, без ошибок; на 15 FPS тоже', () => {
    clean(burpees(), 'burpee', 5);
    clean(burpees({ fps: 15 }), 'burpee', 5);
  });
  it('без прыжка в конце — «выпрыгни вверх»', () => {
    const res = runSession(burpees({ jump: false }), def('burpee'));
    expect(res.reps).toHaveLength(5);
    expect(res.reps.every((r) => r.errors.includes('no_jump'))).toBe(true);
  });
  it('подряд без прыжка, встал и сразу вниз — каждое бёрпи отдельно, а не два в одно', () => {
    const noise = gaussian(0.003, 43);
    const stand = synthFrame({ ...STAND, arms: 10 }, 0);
    const crouch = synthFrame({ ...squatPose(90), lean: 30, arms: 10 }, 0);
    const low = frontPlankFrame({}, 0);
    const keys: [number, PoseFrame][] = [
      [0, stand],
      [0.2, crouch],
      [0.35, low],
      [0.5, low],
      [0.75, crouch],
      [0.95, stand],
      [1, stand],
    ];
    const period = 2400;
    const frames: PoseFrame[] = [];
    for (let t = 0; t <= 1500 + 5 * period + 1500; t += 1000 / 30) {
      const u = t - 1500;
      let f = stand;
      if (u >= 0 && u < 5 * period) {
        const k = (u % period) / period;
        for (let i = 1; i < keys.length; i++) {
          const [k0, a] = keys[i - 1]!;
          const [k1, b] = keys[i]!;
          if (k <= k1) {
            f = blendFrames(a, b, 0.5 - 0.5 * Math.cos((Math.PI * (k - k0)) / (k1 - k0)), t);
            break;
          }
        }
      }
      frames.push({ ...f, t, image: f.image.map((p) => ({ ...p, x: p.x + noise(), y: p.y + noise() })) });
    }
    const res = runSession(frames, def('burpee'));
    expect(res.reps).toHaveLength(5);
    for (const r of res.reps) expect(r.errors).toEqual(['no_jump']);
  });
  it('только присед вместо упора лёжа — не бёрпи, но подсказка «до упора лёжа»', () => {
    const res = runSession(burpees({ plank: false }), def('burpee'));
    expect(res.reps.every((r) => r.errors.includes('not_low'))).toBe(true);
    expect(shown(res)).toContain('not_low');
  });
  it('реальная запись: 3 бёрпи между «звёздочками», сами «звёздочки» — не бёрпи', () => {
    for (const every of [1, 2]) {
      const res = runSession(fixtureFrames(loadFixture('jumping-jack-front.json'), every), def('burpee'));
      expect(res.reps).toHaveLength(3);
      // В записи человек встаёт без прыжка — это честная ошибка, и других нет (упор лёжа — до конца).
      for (const r of res.reps) expect(r.errors).toEqual(['no_jump']);
    }
  });
});
