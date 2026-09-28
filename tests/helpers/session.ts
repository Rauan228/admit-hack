// Прогон подхода: сглаживание → измеритель → счётчик → правила. Повторяет порядок движка:
// сначала счётчик (фаза), потом покадровые правила в новой фазе, потом разовые проверки моментов.

import { RepCounter, type FsmEvent } from '../../src/engine/exercises/fsm';
import type { BaseMetrics, ExerciseDef } from '../../src/engine/exercises/types';
import { LandmarkSmoother, smoothPose } from '../../src/engine/filter';
import type { PoseFrame } from '../../src/engine/geometry';
import { formErrorsFor } from '../../src/engine/hints';
import { decodeDetection, type FixtureFile } from '../../src/engine/recorder';
import { RuleEngine, type FormErrorEvent, type RepContext } from '../../src/engine/rules';

export interface SessionRep<M> {
  errors: string[];
  ctx: RepContext<M>;
}

export interface SessionResult<M> {
  reps: SessionRep<M>[];
  attempts: { errors: string[]; ctx: RepContext<M> }[];
  shown: FormErrorEvent[];
  events: FsmEvent[];
}

export function runSession<M extends BaseMetrics>(
  frames: (PoseFrame | null)[],
  def: ExerciseDef<M>,
): SessionResult<M> {
  const meter = def.createMeter();
  const counter = new RepCounter(def.fsm);
  const rules = new RuleEngine<M>(def.id, def.rules, formErrorsFor(def.id));
  const res: SessionResult<M> = { reps: [], attempts: [], shown: [], events: [] };
  let repFrames: M[] = [];
  let atBottom: M | null = null;
  const show = (ev: FormErrorEvent | null) => ev && res.shown.push(ev);

  for (const frame of frames) {
    if (!frame) continue;
    const m = meter.measure(frame, counter.phase);
    if (!m) continue;
    const evs = counter.update(m.progress, frame.t);
    res.events.push(...evs);
    if (evs.some((e) => e.kind === 'phase' && e.phase === 'down') && repFrames.length === 0) {
      rules.beginRep();
    }
    if (counter.phase !== 'start' || evs.length > 0) {
      repFrames.push(m);
      if (!atBottom || m.progress >= atBottom.progress) atBottom = m;
    }
    show(rules.onFrame(m, counter.phase, frame.t));
    for (const e of evs) {
      if (e.kind === 'phase' && e.phase === 'up' && atBottom) {
        show(
          rules.onRepMoment(
            'bottom',
            {
              summary: { startT: 0, bottomT: 0, endT: frame.t, pMax: atBottom.progress, durationMs: 0 },
              frames: repFrames,
              atBottom,
            },
            frame.t,
          ),
        );
      }
      if ((e.kind === 'rep' || e.kind === 'attempt') && atBottom) {
        const ctx: RepContext<M> = { summary: e.summary, frames: repFrames, atBottom };
        show(rules.onRepMoment(e.kind, ctx, frame.t));
        if (e.kind === 'rep') res.reps.push({ errors: rules.repErrors, ctx });
        else res.attempts.push({ errors: rules.repErrors, ctx });
      }
      if (
        e.kind === 'rep' ||
        e.kind === 'attempt' ||
        e.kind === 'timeout' ||
        (e.kind === 'phase' && e.phase === 'start')
      ) {
        repFrames = [];
        atBottom = null;
      }
    }
  }
  return res;
}

/** Сглаженные кадры записи. */
export function fixtureFrames(file: FixtureFile, every = 1): (PoseFrame | null)[] {
  const smoother = new LandmarkSmoother();
  return file.frames
    .filter((_, i) => i % every === 0)
    .map((f) => {
      const d = decodeDetection(f);
      return d ? smoothPose(smoother, d.image, d.world, f.t, file.aspect) : null;
    });
}
