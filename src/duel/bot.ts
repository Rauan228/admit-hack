// Соперник-бот для дуэли на отжиманиях (E-24): заранее расписанные моменты повторов за минуту.
// Темп как у живого человека — к концу минуты устаёт, между повторами небольшой разброс.
// Позже вместо бота встанет живой соперник по сети: матчу нужен только счёт соперника на момент боя.

export type BotId = 'novice' | 'athlete' | 'machine';

export interface Bot {
  id: BotId;
  name: string;
  avatar: string;
  /** Повторов за минуту. */
  total: number;
}

export const BOTS: readonly Bot[] = [
  { id: 'novice', name: 'Новичок', avatar: '🐢', total: 25 },
  { id: 'athlete', name: 'Атлет', avatar: '💪', total: 50 },
  // Как «Гоггинс» из ролика-референса: 117 за минуту — почти без шансов.
  { id: 'machine', name: 'Машина', avatar: '🤖', total: 117 },
];

/** Бот по id; неизвестный id — средний соперник. */
export function findBot(id: string | null): Bot {
  return BOTS.find((b) => b.id === id) ?? BOTS[1]!;
}

/** Замедление к концу минуты: последний интервал длиннее первого в 1 + FATIGUE раз. */
const FATIGUE = 0.6;
/** Разброс интервала ±, доля. */
const JITTER = 0.15;
/** Последний повтор — не впритык к концу: бот «доделывает» его за 1,5 % минуты до финиша. */
const FINISH = 0.985;

/** Моменты повторов, мс от начала боя: total штук, строго по возрастанию, внутри (0, durationMs]. */
export function botTimeline(total: number, durationMs: number, seed = 1): number[] {
  const rnd = mulberry32(seed);
  const gaps = Array.from({ length: total }, (_, i) => {
    const fatigue = 1 + FATIGUE * (total > 1 ? i / (total - 1) : 0);
    return fatigue * (1 + (rnd() * 2 - 1) * JITTER);
  });
  const scale = (durationMs * FINISH) / gaps.reduce((s, g) => s + g, 0);
  let t = 0;
  return gaps.map((g) => (t += g * scale));
}

/** Сколько повторов сделано к моменту t (мс от начала боя). */
export function repsAt(timeline: readonly number[], t: number): number {
  let lo = 0;
  let hi = timeline.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (timeline[mid]! <= t) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Маленький детерминированный генератор 0..1: один seed — один и тот же бой. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
