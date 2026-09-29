import { createHighKnees } from '../src/engine/exercises/highKnees';
import type { PoseFrame } from '../src/engine/geometry';
import { runSession } from './helpers/session';
import { gaussian, STAND, synthFrame } from './helpers/synth';

const highKnees = createHighKnees();

/**
 * Бег на месте: колени по очереди, левое — правое. stepMs — один подъём колена.
 * overlap — ноги сменяются без паузы (одно колено опускается, пока другое поднимается).
 */
function run(opts: {
  steps: number;
  lift?: number;
  stepMs?: number;
  fps?: number;
  lean?: number;
  overlap?: boolean;
  height?: (t: number) => number;
}): PoseFrame[] {
  const { steps, lift = 85, stepMs = 450, fps = 30, lean = 0 } = opts;
  const noise = gaussian(0.003, 11);
  const lead = 1500;
  const frames: PoseFrame[] = [];
  for (let t = 0; t <= lead + steps * stepMs + 1000; t += 1000 / fps) {
    const u = t - lead;
    let liftL = 0;
    let liftR = 0;
    if (u >= 0 && u < steps * stepMs) {
      const step = Math.floor(u / stepMs);
      const k = (u % stepMs) / stepMs;
      // Без перекрытия: колено вверх-вниз за шаг. С перекрытием: синус, ноги сменяются в нуле.
      const a = opts.overlap ? Math.sin(Math.PI * k) : Math.max(0, Math.sin(Math.PI * Math.min(1, k * 1.25)));
      if (step % 2 === 0) liftL = lift * a;
      else liftR = lift * a;
    }
    frames.push(
      synthFrame(
        {
          ...STAND,
          height: opts.height?.(t) ?? STAND.height,
          arms: 15,
          elbow: 95,
          lean: u >= 0 && u < steps * stepMs ? lean : 0,
          liftL,
          liftR,
        },
        t,
        noise,
      ),
    );
  }
  return frames;
}

const shownCodes = (res: ReturnType<typeof runSession>) => res.shown.map((e) => e.code);

describe('высокие колени', () => {
  it('12 подъёмов колен до пояса — 12 повторов без ошибок; на 15 FPS тоже', () => {
    const res = runSession(run({ steps: 12 }), highKnees);
    expect(res.reps).toHaveLength(12);
    expect(res.reps.flatMap((r) => r.errors)).toEqual([]);
    expect(res.shown).toEqual([]);
    expect(runSession(run({ steps: 12, fps: 15 }), highKnees).reps).toHaveLength(12);
  });

  it('быстрый темп без пауз между ногами (3 шага в секунду) — каждое колено отдельно', () => {
    const res = runSession(run({ steps: 18, stepMs: 330, overlap: true }), highKnees);
    expect(res.reps).toHaveLength(18);
    expect(res.reps.flatMap((r) => r.errors)).toEqual([]);
  });

  it('колено до середины (бедро под 58°) — повтор засчитан, но «колени выше»', () => {
    const res = runSession(run({ steps: 8, lift: 58 }), highKnees);
    expect(res.reps).toHaveLength(8);
    expect(res.reps.every((r) => r.errors.includes('knees_low'))).toBe(true);
    expect(shownCodes(res)).toContain('knees_low');
    // Подсвечивается именно то колено, что поднималось.
    expect(res.shown[0]?.joints).toHaveLength(1);
  });

  it('трусца с низкими коленями — не повторы, но подсказка «колени выше»', () => {
    const res = runSession(run({ steps: 8, lift: 47 }), highKnees);
    expect(res.reps).toHaveLength(0);
    expect(res.attempts.length).toBeGreaterThanOrEqual(6);
    expect(shownCodes(res)).toContain('knees_low');
  });

  it('шаг на месте (бедро под 30°) и стойка — ни повторов, ни подсказок', () => {
    const march = runSession(run({ steps: 10, lift: 30 }), highKnees);
    expect(march.reps).toHaveLength(0);
    expect(march.shown).toEqual([]);
    const still = runSession(run({ steps: 0 }), highKnees);
    expect(still.reps).toHaveLength(0);
    expect(still.attempts).toHaveLength(0);
  });

  it('отклонился назад — «не отклоняйся назад»; наклон вперёд так не называем', () => {
    expect(shownCodes(runSession(run({ steps: 10, lean: -35 }), highKnees))).toContain('lean_back');
    expect(shownCodes(runSession(run({ steps: 10, lean: 15 }), highKnees))).not.toContain('lean_back');
  });

  it('подошёл к камере во время подхода — счёт тот же, ложных ошибок нет', () => {
    const res = runSession(run({ steps: 12, height: (t) => 0.62 + 0.18 * Math.min(1, t / 8000) }), highKnees);
    expect(res.reps).toHaveLength(12);
    expect(res.reps.flatMap((r) => r.errors)).toEqual([]);
  });
});
