// Движок правил ошибок техники (E-09) — это и есть «твист» кейса.
//
// Правило — одна запись: код из каталога подсказок (hints.ts) + проверка. Всё остальное —
// текст, суставы, стрелка, важность, фазы, штраф — берётся из каталога. Новое правило = одна
// строка в описании упражнения.
//
// Два вида правил:
// - покадровое: нарушение должно продержаться holdMs и minFrames подряд (антидребезг по времени,
//   а не по кадрам — одинаково на 15 и 30 FPS) и только в фазах, к которым правило привязано;
// - разовое: проверка итога нижней точки / повтора / неглубокой попытки (глубина, скорость).
//
// Показ: одновременно одна подсказка, самая важная (priority 1 — главная). Одна и та же фраза —
// не чаще раза в cooldownMs (4 с по PLAN), между разными — не меньше minGapMs, чтобы голос не
// перебивал сам себя; более важная ошибка может перебить менее важную. Нарушение, которое не
// удалось показать, всё равно записывается в ошибки повтора и снижает оценку.

import { ENGINE_CONFIG, type Widen } from './config';
import type { RepSummary } from './exercises/fsm';
import type { FormErrorDef } from './hints';
import type { Arrow, EngineEvent, ExerciseId, Joint, Phase } from './types';

export type FormErrorEvent = Extract<EngineEvent, { type: 'form_error' }>;

/** Результат проверки: нарушение есть; можно уточнить суставы и стрелку (например, какое колено). */
export interface RuleHit {
  joints?: Joint[];
  arrow?: Arrow;
}

export interface FrameRule<M> {
  code: string;
  kind: 'frame';
  check(m: M): RuleHit | null;
  /** Антидребезг для этого правила, мс (по умолчанию — из конфига). */
  holdMs?: number;
}

/** Моменты, на которых проверяются разовые правила. */
export type RepMoment = 'bottom' | 'rep' | 'attempt';

export interface RepContext<M> {
  summary: RepSummary;
  /** Метрики кадров движения — с предысторией prerollMs до выхода из исходного положения. */
  frames: M[];
  /** Метрики в момент наибольшей амплитуды. */
  atBottom: M;
}

export interface RepRule<M> {
  code: string;
  kind: 'rep';
  on: RepMoment[];
  check(ctx: RepContext<M>): RuleHit | null;
}

export type RuleDef<M> = FrameRule<M> | RepRule<M>;

type RulesConfig = Widen<typeof ENGINE_CONFIG.rules>;

interface Streak {
  since: number;
  frames: number;
  hit: RuleHit;
}

export class RuleEngine<M> {
  private readonly catalog = new Map<string, FormErrorDef>();
  private readonly streaks = new Map<string, Streak>();
  /** Ошибки текущего повтора (для rep.errors и оценки). */
  private readonly errors = new Set<string>();
  /** Подтверждённые, но ещё не показанные в этом повторе (ждут окна). */
  private readonly pending = new Map<string, RuleHit>();
  /** Показанные в этом повторе: второй раз за повтор одно и то же не говорим. */
  private readonly shownThisRep = new Set<string>();
  private readonly lastShown = new Map<string, number>();
  private lastAnyAt = -Infinity;
  private lastAnyPriority = Infinity;

  constructor(
    private readonly exercise: ExerciseId,
    private readonly rules: readonly RuleDef<M>[],
    catalog: readonly FormErrorDef[],
    private readonly cfg: RulesConfig = ENGINE_CONFIG.rules,
  ) {
    for (const def of catalog) this.catalog.set(def.code, def);
    for (const rule of rules) {
      if (!this.catalog.has(rule.code))
        throw new Error(`Правило ${rule.code}: нет подсказки в каталоге hints.ts`);
    }
  }

  /** Коды ошибок текущего повтора в порядке важности. */
  get repErrors(): string[] {
    return [...this.errors].sort((a, b) => this.priority(a) - this.priority(b));
  }

  /** Новый повтор: ошибки и «уже сказанное» обнуляются, кулдауны фраз — нет. */
  beginRep(): void {
    this.errors.clear();
    this.pending.clear();
    this.shownThisRep.clear();
    this.streaks.clear();
  }

  /** Кадр в фазе phase. Возвращает подсказку, если её пора показать. */
  onFrame(m: M, phase: Phase, t: number): FormErrorEvent | null {
    for (const rule of this.rules) {
      if (rule.kind !== 'frame') continue;
      const def = this.catalog.get(rule.code) as FormErrorDef;
      const hit = def.phases.includes(phase) ? rule.check(m) : null;
      if (!hit) {
        this.streaks.delete(rule.code);
        // Исправился до показа — показывать уже нечего (в ошибках повтора оно остаётся).
        this.pending.delete(rule.code);
        continue;
      }
      const streak = this.streaks.get(rule.code) ?? { since: t, frames: 0, hit };
      streak.frames += 1;
      streak.hit = hit;
      this.streaks.set(rule.code, streak);
      const hold = rule.holdMs ?? this.cfg.holdMs;
      if (t - streak.since >= hold && streak.frames >= this.cfg.minFrames) this.confirm(rule.code, hit);
    }
    return this.pickToShow(t);
  }

  /** Итог момента движения (нижняя точка, засчитанный повтор, неглубокая попытка). */
  onRepMoment(moment: RepMoment, ctx: RepContext<M>, t: number): FormErrorEvent | null {
    for (const rule of this.rules) {
      if (rule.kind !== 'rep' || !rule.on.includes(moment)) continue;
      const hit = rule.check(ctx);
      if (hit) this.confirm(rule.code, hit);
    }
    return this.pickToShow(t);
  }

  reset(): void {
    this.beginRep();
    this.lastShown.clear();
    this.lastAnyAt = -Infinity;
    this.lastAnyPriority = Infinity;
  }

  private confirm(code: string, hit: RuleHit): void {
    this.errors.add(code);
    if (!this.shownThisRep.has(code)) this.pending.set(code, hit);
  }

  private pickToShow(t: number): FormErrorEvent | null {
    let best: { code: string; hit: RuleHit; def: FormErrorDef } | null = null;
    for (const [code, hit] of this.pending) {
      const def = this.catalog.get(code) as FormErrorDef;
      if (t - (this.lastShown.get(code) ?? -Infinity) < this.cfg.cooldownMs) continue;
      if (!best || def.priority < best.def.priority) best = { code, hit, def };
    }
    if (!best) return null;
    // Между разными подсказками — пауза; перебить её может только более важная ошибка.
    const tooSoon = t - this.lastAnyAt < this.cfg.minGapMs;
    if (tooSoon && best.def.priority >= this.lastAnyPriority) return null;

    this.pending.delete(best.code);
    this.shownThisRep.add(best.code);
    this.lastShown.set(best.code, t);
    this.lastAnyAt = t;
    this.lastAnyPriority = best.def.priority;
    const arrow = best.hit.arrow ?? best.def.arrow;
    return {
      type: 'form_error',
      exercise: this.exercise,
      code: best.code,
      message: best.def.message,
      joints: best.hit.joints ?? best.def.joints,
      ...(arrow ? { arrow } : {}),
      severity: best.def.severity,
    };
  }

  private priority(code: string): number {
    return this.catalog.get(code)?.priority ?? 99;
  }
}
