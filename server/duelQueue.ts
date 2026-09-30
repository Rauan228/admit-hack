// Подбор соперника (арена): очередь «ищу бой» по доске — упражнение × время боя.
// Пара — с ближайшими кубками этой доски; окно по кубкам растёт с ожиданием: ±50, после 10 с — ±150,
// после 20 с — кто угодно. Чистая логика со временем снаружи; сеть и таймеры — в server/duelLive.ts.
// Без параметров-свойств: на VPS Node только стирает типы.

export interface Seeker<T> {
  /** Кто ищет (соединение). */
  ref: T;
  userId: number;
  exercise: string;
  durationMs: number;
  /** Кубки на этой доске в момент поиска. */
  cups: number;
  since: number;
}

/** Окна по кубкам: [с какого ожидания, ширина]. */
export const SEEK_WINDOWS: readonly (readonly [number, number])[] = [
  [0, 50],
  [10_000, 150],
  [20_000, Infinity],
];

/** Насколько далеко по кубкам готов искать тот, кто ждёт waitMs. */
export function seekWindow(waitMs: number): number {
  let w = SEEK_WINDOWS[0]![1];
  for (const [from, width] of SEEK_WINDOWS) if (waitMs >= from) w = width;
  return w;
}

export function boardKey(exercise: string, durationMs: number): string {
  return `${exercise}:${durationMs}`;
}

export class SeekQueue<T> {
  private list: Seeker<T>[] = [];

  get size(): number {
    return this.list.length;
  }

  /** Встать в очередь. Один поиск на аккаунт: прошлые поиски того же игрока (другая вкладка) снимаются. */
  add(s: Seeker<T>): Seeker<T>[] {
    const replaced = this.list.filter((x) => x.ref === s.ref || x.userId === s.userId);
    this.list = this.list.filter((x) => !replaced.includes(x));
    this.list.push(s);
    return replaced.filter((x) => x.ref !== s.ref);
  }

  remove(ref: T): boolean {
    const before = this.list.length;
    this.list = this.list.filter((x) => x.ref !== ref);
    return this.list.length !== before;
  }

  get(ref: T): Seeker<T> | undefined {
    return this.list.find((x) => x.ref === ref);
  }

  all(): readonly Seeker<T>[] {
    return this.list;
  }

  /** Сколько ищут бой на этой доске. */
  count(exercise: string, durationMs: number): number {
    return this.list.filter((x) => x.exercise === exercise && x.durationMs === durationMs).length;
  }

  /** Сколько ищут по доскам: «упражнение:мс» → число. */
  stats(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const x of this.list) {
      const k = boardKey(x.exercise, x.durationMs);
      out[k] = (out[k] ?? 0) + 1;
    }
    return out;
  }

  /**
   * Собрать пары и убрать их из очереди. Первым выбирает тот, кто ждёт дольше; из подходящих — ближайший
   * по кубкам (при равенстве — тоже дольше ждущий). Подходит, если разница в пределах окна хотя бы одного.
   */
  pairs(now: number): [Seeker<T>, Seeker<T>][] {
    const out: [Seeker<T>, Seeker<T>][] = [];
    const taken = new Set<Seeker<T>>();
    const byAge = [...this.list].sort((a, b) => a.since - b.since);
    for (const a of byAge) {
      if (taken.has(a)) continue;
      let best: Seeker<T> | null = null;
      for (const b of byAge) {
        if (b === a || taken.has(b) || b.userId === a.userId) continue;
        if (b.exercise !== a.exercise || b.durationMs !== a.durationMs) continue;
        const diff = Math.abs(a.cups - b.cups);
        if (diff > Math.max(seekWindow(now - a.since), seekWindow(now - b.since))) continue;
        if (!best || diff < Math.abs(a.cups - best.cups)) best = b;
      }
      if (!best) continue;
      taken.add(a);
      taken.add(best);
      out.push([a, best]);
    }
    this.list = this.list.filter((x) => !taken.has(x));
    return out;
  }
}
