// Извлечение поз из видеофайла для фикстур (E-15).
// Видео проматывается покадрово (seek), каждый кадр идёт через тот же pose.ts, что и в движке.
// Покадровая промотка, а не воспроизведение: результат не зависит от скорости машины.
//
// Параметры в адресе: src (URL видео), fps (частота выборки), from/to (секунды),
// model (lite|full), delegate (CPU|GPU). Результат кладётся в window.__fixture.

import { createPoseDetector } from '../src/engine/pose';
import { encodeFrame, type FixtureFile } from '../src/engine/recorder';
import type { PoseModel } from '../src/engine/config';

const q = new URLSearchParams(location.search);
const src = q.get('src') ?? '';
const fps = Number(q.get('fps') ?? 30);
const from = Number(q.get('from') ?? 0);
const toParam = Number(q.get('to') ?? Infinity);
const model = (q.get('model') ?? 'full') as PoseModel;
const delegate = (q.get('delegate') ?? 'CPU') as 'CPU' | 'GPU';
const numPoses = Number(q.get('numPoses') ?? 1);
const log = document.querySelector('#log')!;

declare global {
  interface Window {
    __fixture?: FixtureFile;
    __error?: string;
    __detectMs?: number[];
  }
}

function once(target: EventTarget, name: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const ok = () => {
      target.removeEventListener('error', fail);
      resolve();
    };
    const fail = () => {
      target.removeEventListener(name, ok);
      reject(new Error(`video error on ${name}`));
    };
    target.addEventListener(name, ok, { once: true });
    target.addEventListener('error', fail, { once: true });
  });
}

async function main(): Promise<void> {
  const video = document.createElement('video');
  video.muted = true;
  video.preload = 'auto';
  video.src = src;
  await once(video, 'loadeddata');

  const detector = await createPoseDetector({ model, delegate, numPoses });
  const to = Math.min(toParam, video.duration);
  const frames: FixtureFile['frames'] = [];
  /** Время детекции каждого кадра, мс — для сравнения моделей и настроек (window.__detectMs). */
  const detectMs: number[] = [];
  window.__detectMs = detectMs;
  const step = 1 / fps;
  // Середина кадра, а не его начало: seek на границу кадра иногда попадает в предыдущий.
  for (let i = 0, t = from + step / 2; t < to; i++, t = from + step / 2 + i * step) {
    video.currentTime = t;
    await once(video, 'seeked');
    const tMs = Math.round(i * step * 1000);
    const t0 = performance.now();
    const detection = detector.detect(video, tMs);
    detectMs.push(performance.now() - t0);
    frames.push(encodeFrame(tMs, detection));
    if (i % 30 === 0) log.textContent = `${t.toFixed(1)} / ${to.toFixed(1)} с`;
  }
  detector.close();
  window.__fixture = {
    version: 1,
    fps,
    aspect: video.videoWidth / video.videoHeight,
    model: detector.model,
    frames,
  };
  log.textContent = `готово: ${frames.length} кадров`;
}

main().catch((err: unknown) => {
  window.__error = String(err instanceof Error ? err.stack : err);
  log.textContent = window.__error;
});
