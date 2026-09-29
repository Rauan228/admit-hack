// Счёт дуэли (E-24): отсчёт → бой → итог. Чистая логика со временем снаружи — без DOM и таймеров.
// Соперник задан функцией «сколько у него повторов на такой-то миллисекунде боя»: сейчас это бот,
// потом так же подключится живой соперник по сети.

import { DUEL_MIN_GAP_MS } from '../shared/duel';

export type DuelPhase = 'countdown' | 'battle' | 'over';
export type Outcome = 'win' | 'lose' | 'draw';

export interface DuelOptions {
  opponentReps: (elapsedMs: number) => number;
  countdownMs: number;
  durationMs: number;
}

export interface DuelSnapshot {
  phase: DuelPhase;
  countdownLeftMs: number;
  timeLeftMs: number;
  me: number;
  opp: number;
  /** Доля полосы-перетягивания за мной, 0..1. */
  share: number;
  /** Исход — только когда бой окончен. */
  outcome: Outcome | null;
  gaveUp: boolean;
}

export class DuelMatch {
  /** Мои повторы: мс от начала боя. Из них делается вызов другу. */
  private readonly mine: number[] = [];
  private gaveUpAt: number | null = null;
  private readonly battleStart: number;
  private readonly battleEnd: number;

  /** startedAt — момент начала отсчёта. */
  constructor(
    private readonly opts: DuelOptions,
    startedAt: number,
  ) {
    this.battleStart = startedAt + opts.countdownMs;
    this.battleEnd = this.battleStart + opts.durationMs;
  }

  phase(now: number): DuelPhase {
    if (this.gaveUpAt !== null || now >= this.battleEnd) return 'over';
    return now < this.battleStart ? 'countdown' : 'battle';
  }

  /** Мой повтор: засчитан только в бою. */
  addRep(now: number): boolean {
    if (this.phase(now) !== 'battle') return false;
    // Два события движка чаще 0,3 с (дрожание таймера страницы) — сдвигаем, чтобы запись прошла проверку.
    const last = this.mine.at(-1) ?? -Infinity;
    this.mine.push(Math.max(now - this.battleStart, last + DUEL_MIN_GAP_MS));
    return true;
  }

  myTimeline(): number[] {
    return [...this.mine];
  }

  /** Сдаться: бой окончен поражением, счёт соперника замирает на этом моменте. */
  giveUp(now: number): void {
    if (this.phase(now) !== 'over') this.gaveUpAt = now;
  }

  snapshot(now: number): DuelSnapshot {
    const phase = this.phase(now);
    const until = Math.min(now, this.gaveUpAt ?? Infinity);
    const elapsed = Math.min(this.opts.durationMs, Math.max(0, until - this.battleStart));
    const opp = this.opts.opponentReps(elapsed);
    const gaveUp = this.gaveUpAt !== null;
    const me = this.mine.length;
    return {
      phase,
      countdownLeftMs: Math.max(0, this.battleStart - now),
      timeLeftMs: this.opts.durationMs - elapsed,
      me,
      opp,
      share: tugShare(me, opp),
      outcome: phase === 'over' ? (gaveUp ? 'lose' : outcome(me, opp)) : null,
      gaveUp,
    };
  }
}

export function outcome(me: number, opp: number): Outcome {
  return me > opp ? 'win' : me < opp ? 'lose' : 'draw';
}

/** Полоса-перетягивание: моя доля от общего счёта; 0 : 0 — поровну. */
export function tugShare(me: number, opp: number): number {
  return me + opp === 0 ? 0.5 : me / (me + opp);
}

/** Остаток времени «м:сс», секунды округляем вверх: 59,1 с — ещё «1:00». */
export function formatClock(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
