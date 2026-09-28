import { createSquat } from '../src/engine/exercises/squat';
import type { PoseFrame } from '../src/engine/geometry';
import { LM } from '../src/engine/hints';
import { loadFixture } from './helpers/replay';
import { fixtureFrames, runSession } from './helpers/session';
import { gaussian, squatPose, squatTrack, synthFrame, type SynthParams } from './helpers/synth';

/** Подход из n приседаний с заданными особенностями техники. */
function set(
  opts: Partial<Parameters<typeof squatTrack>[0]>,
  extra: (thigh: number) => Partial<SynthParams> = () => ({}),
  seed = 3,
): PoseFrame[] {
  const noise = gaussian(0.003, seed);
  return squatTrack({ reps: 5, depth: 100, ...opts }).map(({ t, thigh }) =>
    synthFrame(squatPose(thigh, extra(thigh)), t, noise),
  );
}

const squat = createSquat();
/** Доля повторов, в которых есть ошибка code. */
const share = (res: ReturnType<typeof runSession>, code: string) =>
  res.reps.filter((r) => r.errors.includes(code)).length / Math.max(1, res.reps.length);

describe('ошибки приседа (PLAN §3): чистый подход — без ошибок', () => {
  it('5 правильных приседаний до параллели — ни одной ошибки и ни одной подсказки', () => {
    const res = runSession(set({}), squat);
    expect(res.reps).toHaveLength(5);
    expect(res.reps.every((r) => r.errors.length === 0)).toBe(true);
    expect(res.shown).toEqual([]);
  });

  it.each([
    'squat-front-goblet.json',
    'squat-rear-barbell.json',
    'squat-side-goblet.json',
    'squat-side-backlit.json',
  ])('реальная запись с хорошей техникой %s — ни одной ложной ошибки в повторах', (name) => {
    const res = runSession(fixtureFrames(loadFixture(name)), squat);
    expect(res.reps.length).toBeGreaterThan(0);
    expect(res.reps.flatMap((r) => r.errors)).toEqual([]);
  });
});

describe('ошибки приседа: каждая ловится и даёт свою подсказку', () => {
  it('мало глубины (бедро 65°): shallow_depth в каждом повторе, стрелка вниз, таз и колени', () => {
    const res = runSession(set({ depth: 65 }), squat);
    expect(res.reps).toHaveLength(5);
    expect(share(res, 'shallow_depth')).toBe(1);
    const hint = res.shown.find((e) => e.code === 'shallow_depth');
    expect(hint).toMatchObject({
      message: 'Сядь глубже — бедро до параллели с полом',
      arrow: 'down',
      severity: 'bad',
    });
    expect(hint?.joints).toEqual(expect.arrayContaining([LM.leftKnee, LM.rightKnee]));
  });

  it('совсем неглубоко (бедро 45°): повтор не засчитан, но подсказка «глубже» звучит', () => {
    const res = runSession(set({ depth: 45 }), squat);
    expect(res.reps).toHaveLength(0);
    expect(res.attempts.length).toBe(5);
    expect(res.shown.some((e) => e.code === 'shallow_depth')).toBe(true);
  });

  it('колени внутрь: knees_in, стрелка наружу, подсвечены колени', () => {
    const res = runSession(
      set({}, (thigh) => ({ kneeIn: Math.min(1, thigh / 60) })),
      squat,
    );
    expect(share(res, 'knees_in')).toBe(1);
    const hint = res.shown.find((e) => e.code === 'knees_in');
    expect(hint).toMatchObject({ arrow: 'out', message: 'Разведи колени наружу, по линии носков' });
    expect(hint?.joints).toEqual([LM.leftKnee, LM.rightKnee]);
  });

  it('завалилось одно колено — подсвечено именно оно', () => {
    const frames = set({}, (thigh) => ({ kneeIn: Math.min(1, thigh / 60) })).map((f) => {
      // Возвращаем правое колено на линию: внутрь уходит только левое.
      const clean = synthFrame(squatPose(0), f.t);
      void clean;
      return f;
    });
    // Левое колено (индекс 25) уводим внутрь ещё сильнее, правое — ставим на линию таз–щиколотка.
    for (const f of frames) {
      const hipR = f.image[LM.rightHip]!;
      const ankleR = f.image[LM.rightAnkle]!;
      const kneeR = f.image[LM.rightKnee]!;
      const u = (kneeR.y - hipR.y) / (ankleR.y - hipR.y);
      f.image[LM.rightKnee] = { ...kneeR, x: hipR.x + u * (ankleR.x - hipR.x) - 0.01 };
    }
    const res = runSession(frames, squat);
    const hint = res.shown.find((e) => e.code === 'knees_in');
    expect(hint?.joints).toEqual([LM.leftKnee]);
  });

  it('сильный наклон корпуса (60°): torso_lean, стрелка вверх', () => {
    const res = runSession(
      set({}, (thigh) => ({ lean: (thigh / 100) * 60 })),
      squat,
    );
    expect(share(res, 'torso_lean')).toBe(1);
    expect(res.shown.find((e) => e.code === 'torso_lean')).toMatchObject({
      arrow: 'up',
      message: 'Держи грудь выше, спина ровнее',
    });
  });

  it('наклон 35° — норма для глубокого приседа, не ошибка', () => {
    const res = runSession(
      set({}, (thigh) => ({ lean: (thigh / 100) * 35 })),
      squat,
    );
    expect(share(res, 'torso_lean')).toBe(0);
  });

  it('перенос веса на одну ногу (таз уехал вбок): asymmetry со стрелкой «вернуть таз»', () => {
    const res = runSession(
      set({}, (thigh) => ({ shift: (thigh / 100) * 0.5 })),
      squat,
    );
    expect(share(res, 'asymmetry')).toBe(1);
    const hint = res.shown.find((e) => e.code === 'asymmetry');
    expect(hint?.message).toBe('Распредели вес на обе ноги');
    // Таз уехал вправо по исходной картинке = влево по зеркальному экрану → вернуть вправо.
    expect(hint?.arrow).toBe('right');
  });

  it('одна нога садится глубже другой: asymmetry', () => {
    const res = runSession(
      set({}, (thigh) => ({ tilt: (thigh / 100) * 45 })),
      squat,
    );
    expect(share(res, 'asymmetry')).toBeGreaterThan(0.5);
  });

  it('слишком быстро (повтор ~0,5 с): too_fast', () => {
    const res = runSession(set({ downMs: 250, holdMs: 0, upMs: 250, restMs: 500 }), squat);
    expect(res.reps).toHaveLength(5);
    expect(share(res, 'too_fast')).toBe(1);
    expect(res.shown.find((e) => e.code === 'too_fast')?.message).toBe('Медленнее — опускайся за 2 секунды');
  });

  it('две ошибки сразу — в повторе обе, а голосом сначала важнейшая (глубина раньше наклона)', () => {
    const res = runSession(
      set({ depth: 65 }, (thigh) => ({ lean: (thigh / 65) * 60 })),
      squat,
    );
    expect(res.reps.every((r) => r.errors.includes('shallow_depth') && r.errors.includes('torso_lean'))).toBe(
      true,
    );
    // В повторе ошибки перечислены по важности.
    expect(res.reps[0]?.errors[0]).toBe('shallow_depth');
  });

  it('подсказки не сыплются: между любыми двумя — не меньше 1,5 с или более важная перебила', () => {
    const res = runSession(
      set({ depth: 65, reps: 8 }, (thigh) => ({ lean: (thigh / 65) * 60, kneeIn: thigh / 65 })),
      squat,
    );
    expect(res.shown.length).toBeGreaterThan(2);
    // Одна и та же фраза — не чаще раза в 4 с: в 8 повторах по ~2,7 с каждая звучит не каждый раз.
    const byCode = new Map<string, number>();
    for (const e of res.shown) byCode.set(e.code, (byCode.get(e.code) ?? 0) + 1);
    for (const n of byCode.values()) expect(n).toBeLessThan(8);
  });
});
