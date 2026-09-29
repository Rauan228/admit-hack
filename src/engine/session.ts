// Подход к упражнению (E-14): измеритель → счётчик → правила → оценка → события контракта.
//
// Порядок событий на кадре повторяет мок (E-02), под который собран UI:
// фазы → подсказки покадровых правил → по завершении повтора: подсказка разовых правил,
// form_ok (если повтор чистый), rep, и на целевом числе — set_complete. После set_complete
// подход закрыт: дальше ни фаз, ни повторов, пока UI не начнёт новый.

import { ENGINE_CONFIG } from './config';
import { RepCounter } from './exercises/fsm';
import type { BaseMetrics, ExerciseDef, ExerciseMeter } from './exercises/types';
import type { PoseFrame } from './geometry';
import { formErrorsFor } from './hints';
import { PoseGate } from './person';
import { RuleEngine, type RepContext } from './rules';
import { SetTracker } from './scoring';
import type { EngineEvent, Side } from './types';

const OTHER: Record<Side, Side> = { left: 'right', right: 'left' };
const SIDE_WORD: Record<Side, string> = { left: 'левой', right: 'правой' };
const KNEE: Record<Side, number> = { left: 25, right: 26 };

export class ExerciseSession<M extends BaseMetrics = BaseMetrics> {
  private readonly meter: ExerciseMeter<M>;
  private readonly counter: RepCounter;
  private readonly rules: RuleEngine<M>;
  private readonly set: SetTracker;
  private readonly gate = new PoseGate();
  private repFrames: M[] = [];
  private atBottom: M | null = null;
  private recent: { t: number; m: M }[] = [];
  private count = 0;
  /**
   * Упражнения на две стороны: первая сделанная сторона пары, ждём вторую. guessed — сторону по нижней
   * точке определить не удалось, она угадана. Паузу (interrupt) половина переживает намеренно: UI уже
   * показал «правая ✓ — теперь левая», а событие «половина сброшена» в контракте нет.
   */
  private pending: { side: Side; guessed: boolean; errors: string[]; startT: number } | null = null;
  private finished = false;
  /** Когда последний раз удалось измерить позу для этого упражнения. */
  private lastMeasuredAt: number;

  constructor(
    readonly def: ExerciseDef<M>,
    readonly targetReps: number,
    startT: number,
  ) {
    this.meter = def.createMeter();
    this.counter = new RepCounter(def.fsm);
    this.rules = new RuleEngine<M>(def.id, def.rules, formErrorsFor(def.id));
    this.set = new SetTracker(def.id, formErrorsFor(def.id));
    this.lastMeasuredAt = startT;
  }

  /** Подход закрыт (набрано targetReps): дальше события не идут. */
  get done(): boolean {
    return this.finished;
  }

  get reps(): number {
    return this.count;
  }

  /** Сколько мс подряд позу не удаётся измерить (человек вышел, нужные суставы не видны). */
  unmeasuredFor(t: number): number {
    return t - this.lastMeasuredAt;
  }

  /** Первое событие подхода — исходная фаза, как у мока. */
  begin(): EngineEvent[] {
    return [{ type: 'phase', exercise: this.def.id, phase: 'start' }];
  }

  /**
   * Человека долго не было в кадре: незаконченное движение сбрасываем без засчёта,
   * чтобы возвращение в кадр не выглядело «подъёмом» и не дало ложный повтор.
   */
  interrupt(): EngineEvent[] {
    if (this.finished || this.counter.phase === 'start') return [];
    this.counter.reset();
    this.meter.reset();
    this.gate.reset();
    this.repFrames = [];
    this.atBottom = null;
    this.recent = [];
    return [{ type: 'phase', exercise: this.def.id, phase: 'start' }];
  }

  update(frame: PoseFrame | null, t: number): EngineEvent[] {
    if (this.finished || !frame) return [];
    // Сбой модели (скелет «телепортировался») не должен складываться в повтор.
    if (!this.gate.accept(frame.image, t)) return [];
    const m = this.meter.measure(frame, this.counter.phase);
    if (!m) return [];
    this.lastMeasuredAt = t;

    const out: EngineEvent[] = [];
    const exercise = this.def.id;
    const wasStart = this.counter.phase === 'start';
    const fsm = this.counter.update(m.progress, t);
    if (wasStart && this.counter.phase !== 'start') {
      // Движение началось: новый повтор, в его кадры — предыстория (из какого положения стартовали).
      this.rules.beginRep();
      this.set.markMovement(t);
      this.repFrames = this.recent.map((r) => r.m);
      this.atBottom = null;
      this.recent = [];
    }
    if (this.counter.phase === 'start' && !fsm.some((e) => e.kind === 'rep' || e.kind === 'attempt')) {
      this.recent.push({ t, m });
      const from = t - ENGINE_CONFIG.rules.prerollMs;
      while (this.recent.length > 0 && (this.recent[0] as { t: number }).t < from) this.recent.shift();
    }
    if (!wasStart || this.counter.phase !== 'start') {
      this.repFrames.push(m);
      if (!this.atBottom || m.progress >= this.atBottom.progress) this.atBottom = m;
    }

    for (const e of fsm) if (e.kind === 'phase') out.push({ type: 'phase', exercise, phase: e.phase });
    const hint = this.rules.onFrame(m, this.counter.phase, t);
    if (hint) out.push(hint);

    for (const e of fsm) {
      if (e.kind === 'phase' && e.phase === 'up' && this.atBottom) {
        const ctx = this.context({
          startT: t,
          bottomT: t,
          endT: t,
          pMax: this.atBottom.progress,
          durationMs: 0,
        });
        const h = this.rules.onRepMoment('bottom', ctx, t);
        if (h) out.push(h);
      } else if (e.kind === 'attempt' && this.atBottom) {
        const h = this.rules.onRepMoment('attempt', this.context(e.summary), t);
        if (h) out.push(h);
      } else if (e.kind === 'rep' && this.atBottom) {
        const hinted = out.some((x) => x.type === 'form_error');
        out.push(...this.completeRep(this.context(e.summary), t, hinted));
      }
      if (e.kind === 'rep' || e.kind === 'attempt' || e.kind === 'timeout') {
        this.repFrames = [];
        this.atBottom = null;
      }
    }
    return out;
  }

  /**
   * Одна сторона упражнения на две стороны. Первая — half_rep и ждём вторую; та же сторона ещё раз —
   * подсказка «теперь другой ногой» (засчитываем последнюю попытку этой стороны); другая сторона —
   * повтор с общими ошибками обеих половин.
   *
   * Сторону не определить — считаем её второй половиной пары (или правой, если пара только начинается).
   * «Та же нога» ругаем, только если обе стороны определены: по догадке подсказка была бы ложной.
   * Подсказку техники в этот же момент не перебиваем — одна подсказка за раз, самая важная.
   */
  private completeSide(ctx: RepContext<M>, errors: string[], hinted: boolean): EngineEvent[] {
    const exercise = this.def.id;
    const out: EngineEvent[] = [];
    const known = this.def.sideOf?.(ctx.atBottom) ?? null;
    const side = known ?? (this.pending ? OTHER[this.pending.side] : 'right');
    out.push({ type: 'half_rep', exercise, side, errors });
    if (errors.length === 0) out.push({ type: 'form_ok', exercise });

    const repeat = this.pending?.side === side && known !== null && !this.pending.guessed;
    if (!this.pending || repeat) {
      if (repeat && !hinted) {
        const next = OTHER[side];
        out.push({
          type: 'form_error',
          exercise,
          code: 'switch_side',
          message: `Теперь шагни ${SIDE_WORD[next]} ногой`,
          joints: [KNEE[next]],
          severity: 'warn',
        });
      }
      this.pending = { side, guessed: known === null, errors, startT: ctx.summary.startT };
      return out;
    }

    const all = [...new Set([...this.pending.errors, ...errors])];
    const score = this.set.addRep(all, this.pending.startT, ctx.summary.endT);
    this.pending = null;
    this.count += 1;
    out.push({ type: 'rep', exercise, count: this.count, score, errors: all });
    if (this.count >= this.targetReps) {
      this.finished = true;
      out.push({ type: 'set_complete', exercise, stats: this.set.stats() });
    }
    return out;
  }

  private context(summary: RepContext<M>['summary']): RepContext<M> {
    return { summary, frames: this.repFrames, atBottom: this.atBottom as M };
  }

  private completeRep(ctx: RepContext<M>, t: number, hinted: boolean): EngineEvent[] {
    const out: EngineEvent[] = [];
    const exercise = this.def.id;
    const hint = this.rules.onRepMoment('rep', ctx, t);
    if (hint) out.push(hint);
    const errors = this.rules.repErrors;
    if (this.def.sideOf) return [...out, ...this.completeSide(ctx, [...errors], hinted || hint !== null)];
    const score = this.set.addRep(errors, ctx.summary.startT, ctx.summary.endT);
    this.count += 1;
    if (errors.length === 0) out.push({ type: 'form_ok', exercise });
    out.push({ type: 'rep', exercise, count: this.count, score, errors });
    if (this.count >= this.targetReps) {
      this.finished = true;
      out.push({ type: 'set_complete', exercise, stats: this.set.stats() });
    }
    return out;
  }
}
