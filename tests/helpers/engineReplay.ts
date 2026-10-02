// Запись поз через весь движок, как в приложении (RealEngine): присутствие, пауза «вернись в кадр», сброс
// незаконченного движения. Тесты одного счётчика этого не видят: выпад с удержанием 11 с проходил в них, а в
// приложении задняя щиколотка в тени давала паузу и сброс — 0 выпадов (E-32).

import { createRealEngine, type EngineDeps } from '../../src/engine/Engine';
import type { PoseDetector } from '../../src/engine/pose';
import { decodeDetection, type FixtureFile } from '../../src/engine/recorder';
import type { EngineEvent, ExerciseId } from '../../src/engine/types';

export async function engineEvents(file: FixtureFile, exercise: ExerciseId): Promise<EngineEvent[]> {
  let clock = 0;
  let k = 0;
  let queued: (() => void) | null = null;
  const h = 480;
  const video = { readyState: 4, currentTime: 0, videoWidth: Math.round(h * file.aspect), videoHeight: h };
  const detector = {
    delegate: 'GPU',
    model: 'full',
    detect: () => {
      const f = file.frames[k];
      return f ? decodeDetection(f) : null;
    },
    close() {},
  } as unknown as PoseDetector;
  const deps: EngineDeps = {
    openCamera: async () => ({}) as MediaStream,
    stopCamera: () => {},
    createPoseDetector: async () => detector,
    requestFrame: (cb) => {
      queued = cb;
      return 1;
    },
    cancelFrame: () => {
      queued = null;
    },
    now: () => clock,
    measureBrightness: () => 120,
    // Турник — тот, что найден по пикселям при записи (подтягивания).
    findBar: () => {
      const b = file.frames[k]?.b;
      return b === undefined ? undefined : b === 0 ? null : { y: b[0], score: b[1] };
    },
  };
  const engine = createRealEngine(deps);
  const events: EngineEvent[] = [];
  engine.on((e) => {
    if (e.type !== 'frame' && e.type !== 'pointer') events.push(e);
  });
  engine.setMode({ exercise, targetReps: 1000 });
  await engine.start(video as unknown as HTMLVideoElement);
  const t0 = file.frames[0]?.t ?? 0;
  for (k = 0; k < file.frames.length; k++) {
    clock = 10_000 + (file.frames[k]!.t - t0);
    video.currentTime += 1 / 30;
    const cb = queued as (() => void) | null;
    queued = null;
    cb?.();
  }
  engine.stop();
  return events;
}
