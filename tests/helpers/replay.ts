// Прогон записи позы через тот же конвейер, что в движке: сглаживание → измеритель → счётчик.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { RepCounter, type FsmEvent } from '../../src/engine/exercises/fsm';
import type { BaseMetrics, ExerciseDef } from '../../src/engine/exercises/types';
import { LandmarkSmoother, smoothPose } from '../../src/engine/filter';
import type { PoseFrame } from '../../src/engine/geometry';
import { decodeDetection, type FixtureFile } from '../../src/engine/recorder';

export function loadFixture(name: string): FixtureFile {
  const path = fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url));
  return JSON.parse(readFileSync(path, 'utf8')) as FixtureFile;
}

/** Сглаженные кадры записи (null — в кадре никого). every = 2 — прореживание до 15 FPS. */
export function smoothedFrames(file: FixtureFile, every = 1): (PoseFrame | null)[] {
  const smoother = new LandmarkSmoother();
  const out: (PoseFrame | null)[] = [];
  file.frames.forEach((f, i) => {
    if (i % every !== 0) return;
    const d = decodeDetection(f);
    out.push(d ? smoothPose(smoother, d.image, d.world, f.t, file.aspect) : null);
  });
  return out;
}

export interface ReplayResult<M extends BaseMetrics> {
  events: FsmEvent[];
  reps: number;
  attempts: number;
  metrics: (M | null)[];
}

export function replay<M extends BaseMetrics>(
  file: FixtureFile,
  def: ExerciseDef<M>,
  every = 1,
): ReplayResult<M> {
  const meter = def.createMeter();
  const counter = new RepCounter(def.fsm);
  const events: FsmEvent[] = [];
  const metrics: (M | null)[] = [];
  for (const frame of smoothedFrames(file, every)) {
    const m = frame ? meter.measure(frame, counter.phase) : null;
    metrics.push(m);
    if (m && frame) events.push(...counter.update(m.progress, frame.t));
  }
  return {
    events,
    reps: events.filter((e) => e.kind === 'rep').length,
    attempts: events.filter((e) => e.kind === 'attempt').length,
    metrics,
  };
}
