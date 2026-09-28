import { createArmRaise } from '../src/engine/exercises/armRaise';
import { GHOST_DURATION_MS, ghostPoseAt } from '../src/engine/ghostPoses';
import { LM } from '../src/engine/hints';
import { ExerciseSession } from '../src/engine/session';
import { STAND, synthFrame } from '../src/engine/skeleton';
import { fixtureFrames, runSession } from './helpers/session';
import { gaussian } from './helpers/synth';
import type { PoseFrame } from '../src/engine/geometry';

const armRaise = createArmRaise();

/** Подход подъёмов рук: руки 10° → top → 10°, по косинусу. */
function raises(opts: {
  reps: number;
  top?: number;
  topL?: number;
  elbow?: number;
  periodMs?: number;
  fps?: number;
}) {
  const { reps, top = 170, periodMs = 2000, fps = 30 } = opts;
  const noise = gaussian(0.003, 31);
  const frames: PoseFrame[] = [];
  const lead = 1500;
  for (let t = 0; t <= lead + reps * periodMs + 1000; t += 1000 / fps) {
    const u = t - lead;
    const w =
      u < 0 || u >= reps * periodMs ? 0 : 0.5 - 0.5 * Math.cos((2 * Math.PI * (u % periodMs)) / periodMs);
    frames.push(
      synthFrame(
        {
          ...STAND,
          arms: 10 + w * (top - 10),
          ...(opts.topL !== undefined ? { armsL: 10 + w * (opts.topL - 10) } : {}),
          elbow: (opts.elbow ?? 0) * w,
        },
        t,
        noise,
      ),
    );
  }
  return frames;
}
const share = (res: ReturnType<typeof runSession>, code: string) =>
  res.reps.filter((r) => r.errors.includes(code)).length / Math.max(1, res.reps.length);

describe('подъём рук', () => {
  it('8 правильных подъёмов — 8, без ошибок; на 15 FPS тоже 8', () => {
    const res = runSession(raises({ reps: 8 }), armRaise);
    expect(res.reps).toHaveLength(8);
    expect(res.reps.flatMap((r) => r.errors)).toEqual([]);
    expect(runSession(raises({ reps: 8, fps: 15 }), armRaise).reps).toHaveLength(8);
  });

  it('руки только до плеч — не повтор, а попытка', () => {
    const res = runSession(raises({ reps: 4, top: 80 }), armRaise);
    expect(res.reps).toHaveLength(0);
    expect(res.attempts.length).toBe(4);
  });

  it('локти согнуты наверху: elbows_bent, «Выпрями руки полностью», стрелка вверх', () => {
    const res = runSession(raises({ reps: 4, elbow: 60 }), armRaise);
    expect(res.reps.length).toBeGreaterThanOrEqual(3);
    expect(share(res, 'elbows_bent')).toBe(1);
    expect(res.shown.find((e) => e.code === 'elbows_bent')).toMatchObject({
      message: 'Выпрями руки полностью',
      arrow: 'up',
      joints: [LM.leftElbow, LM.rightElbow],
    });
  });

  it('лёгкий сгиб (15°) — не ошибка', () => {
    expect(share(runSession(raises({ reps: 4, elbow: 15 }), armRaise), 'elbows_bent')).toBe(0);
  });

  it('левая рука поднимается ниже: one_arm_low, подсвечено левое запястье', () => {
    const res = runSession(raises({ reps: 4, topL: 100 }), armRaise);
    expect(share(res, 'one_arm_low')).toBe(1);
    expect(res.shown.find((e) => e.code === 'one_arm_low')).toMatchObject({
      message: 'Поднимай руки одновременно',
      joints: [LM.leftWrist],
    });
  });

  it('руки над головой — упражнение: жест «обе руки вверх» на подходе выключен', () => {
    expect(armRaise.armsOverhead).toBe(true);
  });

  it('«призрак» подъёма рук движок засчитывает как чистые повторы', () => {
    const session = new ExerciseSession(armRaise, 100, 0);
    const d = GHOST_DURATION_MS.arm_raise;
    const reps = [];
    for (let t = 0; t < 1500 + 4 * d; t += 33) {
      const pose = ghostPoseAt('arm_raise', t < 1500 ? 0 : t - 1500);
      reps.push(
        ...session.update({ t, aspect: 1, image: pose, world: null }, t).filter((e) => e.type === 'rep'),
      );
    }
    expect(reps).toHaveLength(4);
    expect(reps.flatMap((e) => (e.type === 'rep' ? e.errors : []))).toEqual([]);
  });

  it('на записи «звёздочки» руки ходят вверх-вниз — подъём рук их тоже видит (6 повторов)', async () => {
    const { loadFixture } = await import('./helpers/replay');
    const res = runSession(fixtureFrames(loadFixture('jumping-jack-front.json')), armRaise);
    expect(res.reps).toHaveLength(6);
  });
});
