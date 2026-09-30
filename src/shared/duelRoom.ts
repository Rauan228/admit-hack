// Онлайн-дуэль (E-26): комната на двоих — лобби → общий отсчёт → минута боя → итог → реванш.
// Судья — сервер: время старта/финиша, приём повторов, итог. Чистая логика со временем снаружи;
// сеть и таймеры — в server/duelLive.ts. Сообщения клиент ↔ сервер — здесь же (их видит и страница).
// Импорты — только из src/shared/ и с расширением .ts: на VPS копируются лишь server/ и src/shared/,
// а Node там только стирает типы.

import { ARENA_DURATIONS, type AwardView } from './arena.ts';
import { DEFAULT_DUEL_EXERCISE, minGapMs, paceAllows, type DuelExercise } from './duel.ts';

export type RoomPhase = 'lobby' | 'countdown' | 'battle' | 'over';

export interface RoomPlayer {
  /** Секрет игрока в комнате (гостю — чтобы вернуться после обрыва). Наружу не отдаётся. */
  key: string;
  name: string;
  userId: number | null;
  ready: boolean;
  /** Повторы: мс от начала боя. */
  reps: number[];
  gaveUp: boolean;
  online: boolean;
}

export interface RoomResult {
  winner: string | null;
  reason: 'reps' | 'draw' | 'giveup';
}

/** Что видит игрок: без ключей и id аккаунтов, время — по часам сервера. */
export interface RoomView {
  id: string;
  /** E-29: во что соревнуемся. */
  exercise: DuelExercise;
  phase: RoomPhase;
  /** Комнату собрал подбор соперника (а не приглашение или ссылка). Старый сервер поля не шлёт. */
  matched?: boolean;
  round: number;
  durationMs: number;
  countdownMs: number;
  startsAt: number;
  endsAt: number;
  now: number;
  you: number;
  players: {
    name: string;
    ready: boolean;
    reps: number;
    online: boolean;
    gaveUp: boolean;
    /** Титул по сумме кубков. null — ещё без титула, рамки нет. */
    title: string | null;
    frame: string | null;
    /** Кубки на доске этой комнаты (упражнение × разряд); null — не знаем (гость, короткий бой). */
    cups?: number | null;
  }[];
  result: { winner: number | null; reason: RoomResult['reason'] } | null;
}

/** Время соревновательного боя: пуля 30 с, блиц 1 мин, рапид 3 мин. У каждого свой рейтинг. */
export const ROOM_DURATIONS: readonly number[] = ARENA_DURATIONS;

/** Клиент → сервер. */
export type ClientMsg =
  | { t: 'create'; exercise?: string; durationMs?: number }
  | { t: 'join'; room: string; name?: string; key?: string }
  | { t: 'ready'; ready: boolean }
  | { t: 'rep' }
  | { t: 'giveup' }
  | { t: 'leave' }
  | { t: 'invite'; nick: string }
  | { t: 'decline'; room: string; from: string }
  /** Подбор соперника: встать в очередь на доску (упражнение × время) и выйти из неё. */
  | { t: 'seek'; exercise?: string; durationMs?: number }
  | { t: 'cancel_seek' };

/** Сервер → клиент. */
export type ServerMsg =
  | { t: 'hello'; me: string | null; online: string[] }
  | { t: 'presence'; online: string[] }
  | { t: 'room'; room: RoomView; key: string }
  | { t: 'left' }
  | { t: 'invited'; room: string; from: string; exercise: DuelExercise; durationMs: number }
  /** Приглашение ушло: online — сразу, иначе дождётся, когда игрок откроет дуэль. */
  | { t: 'invite_sent'; nick: string; online: boolean }
  | { t: 'declined'; by: string }
  | ({ t: 'award'; room: string; round: number } & AwardView)
  /** Ищем соперника: с какого момента (часы сервера) и сколько ещё ищут на этой доске, кроме тебя. */
  | { t: 'seeking'; exercise: DuelExercise; durationMs: number; since: number; now: number; queue: number }
  /** Поиск снят: отменил сам, начал его в другой вкладке или вошёл в комнату. */
  | { t: 'seek_cancelled' }
  /** Сколько людей на арене и сколько ищут бой по доскам: «упражнение:мс» → число. */
  | { t: 'stats'; online: number; seeking: Record<string, number> }
  | { t: 'error'; message: string };

/** Повтор, досчитанный движком чуть позже финиша (задержка сети и распознавания), ещё засчитываем. */
const LATE_MS = 500;

export class DuelRoom {
  phase: RoomPhase = 'lobby';
  round = 1;
  startsAt = 0;
  endsAt = 0;
  players: RoomPlayer[] = [];
  /** Последняя активность — для уборки брошенных комнат. */
  touched = 0;
  private endedBy: 'time' | 'giveup' | null = null;
  readonly id: string;
  readonly exercise: DuelExercise;
  readonly durationMs: number;
  readonly countdownMs: number;
  readonly matched: boolean;

  // Без параметров-свойств: на VPS Node только стирает типы (см. tests/server-strip.test.ts).
  constructor(
    id: string,
    opts: { durationMs?: number; countdownMs?: number; exercise?: DuelExercise; matched?: boolean } = {},
  ) {
    this.id = id;
    this.matched = opts.matched ?? false;
    this.exercise = opts.exercise ?? DEFAULT_DUEL_EXERCISE;
    this.durationMs = opts.durationMs ?? 60_000;
    this.countdownMs = opts.countdownMs ?? 5000;
  }

  /** Войти (или вернуться: тот же ключ или тот же аккаунт). Строка — отказ. */
  join(p: { key: string; name: string; userId: number | null }, now: number): RoomPlayer | string {
    this.touched = now;
    const back = this.players.find((x) => x.key === p.key || (p.userId !== null && x.userId === p.userId));
    if (back) {
      back.online = true;
      return back;
    }
    if (this.players.length >= 2) return 'В дуэли уже двое';
    if (this.phase === 'countdown' || this.phase === 'battle') return 'Бой уже идёт';
    const player: RoomPlayer = { ...p, ready: false, reps: [], gaveUp: false, online: true };
    this.players.push(player);
    return player;
  }

  setReady(key: string, ready: boolean, now: number): void {
    const p = this.find(key);
    if (!p || this.phase === 'countdown' || this.phase === 'battle') return;
    this.touched = now;
    if (this.phase === 'over') this.newRound();
    p.ready = ready;
    if (this.players.length === 2 && this.players.every((x) => x.ready)) {
      this.phase = 'countdown';
      this.startsAt = now + this.countdownMs;
      this.endsAt = this.startsAt + this.durationMs;
    }
  }

  /** Ход часов: отсчёт → бой → итог. true — фаза сменилась. */
  tick(now: number): boolean {
    const before = this.phase;
    if (this.phase === 'countdown' && now >= this.startsAt) this.phase = 'battle';
    if (this.phase === 'battle' && now >= this.endsAt) this.finish('time');
    return this.phase !== before;
  }

  /** Повтор игрока. Только в бою (и чуть после финиша по времени), не чаще и не быстрее, чем позволяет упражнение. */
  rep(key: string, now: number): boolean {
    this.tick(now);
    const p = this.find(key);
    const inTime =
      this.phase === 'battle' ||
      (this.phase === 'over' && this.endedBy === 'time' && now <= this.endsAt + LATE_MS);
    if (!p || !inTime || p.gaveUp) return false;
    const t = now - this.startsAt;
    if (t - (p.reps.at(-1) ?? -Infinity) < minGapMs(this.exercise)) return false;
    // Темп выше живого (скрипт шлёт повторы) — не засчитываем.
    if (!paceAllows(p.reps, t, this.exercise)) return false;
    p.reps.push(t);
    this.touched = now;
    return true;
  }

  giveUp(key: string, now: number): void {
    this.tick(now);
    const p = this.find(key);
    if (!p || (this.phase !== 'countdown' && this.phase !== 'battle')) return;
    p.gaveUp = true;
    this.touched = now;
    this.finish('giveup');
  }

  /** Ушёл: из лобби — освобождает место, посреди боя — сдаётся. */
  leave(key: string, now: number): void {
    this.tick(now);
    if (this.phase === 'countdown' || this.phase === 'battle') return this.giveUp(key, now);
    this.players = this.players.filter((p) => p.key !== key);
    this.touched = now;
  }

  setOnline(key: string, online: boolean): void {
    const p = this.find(key);
    if (p) p.online = online;
  }

  result(): RoomResult | null {
    if (this.phase !== 'over') return null;
    const quitter = this.players.find((p) => p.gaveUp);
    if (quitter) return { winner: this.players.find((p) => p !== quitter)?.key ?? null, reason: 'giveup' };
    const [a, b] = this.players;
    if (!a || !b || a.reps.length === b.reps.length) return { winner: null, reason: 'draw' };
    return { winner: (a.reps.length > b.reps.length ? a : b).key, reason: 'reps' };
  }

  view(key: string, now: number): RoomView {
    const r = this.result();
    return {
      id: this.id,
      exercise: this.exercise,
      phase: this.phase,
      matched: this.matched,
      round: this.round,
      durationMs: this.durationMs,
      countdownMs: this.countdownMs,
      startsAt: this.startsAt,
      endsAt: this.endsAt,
      now,
      you: this.players.findIndex((p) => p.key === key),
      players: this.players.map((p) => ({
        name: p.name,
        ready: p.ready,
        reps: p.reps.length,
        online: p.online,
        gaveUp: p.gaveUp,
        title: null,
        frame: null,
        cups: null,
      })),
      result: r && {
        winner: r.winner === null ? null : this.players.findIndex((p) => p.key === r.winner),
        reason: r.reason,
      },
    };
  }

  find(key: string): RoomPlayer | undefined {
    return this.players.find((p) => p.key === key);
  }

  private finish(by: 'time' | 'giveup'): void {
    this.phase = 'over';
    this.endedBy = by;
    for (const p of this.players) p.ready = false;
  }

  private newRound(): void {
    this.phase = 'lobby';
    this.round += 1;
    this.endedBy = null;
    for (const p of this.players) {
      p.reps = [];
      p.gaveUp = false;
      p.ready = false;
    }
  }
}
