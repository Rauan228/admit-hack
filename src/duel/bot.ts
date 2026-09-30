// Соперник-бот для дуэли (E-24): заранее расписанные моменты повторов за время боя.
// Темп как у живого человека — к концу боя устаёт, между повторами небольшой разброс.
// Темп у каждого упражнения свой (E-29): 50 отжиманий в минуту — это атлет, 50 ударов — новичок.

import type { DuelExercise } from '../shared/duel';

export type BotId = 'novice' | 'athlete' | 'machine';

export interface Bot {
  id: BotId;
  name: string;
  /** Уровень 1–3 — шкала рядом с именем. */
  level: 1 | 2 | 3;
  /** Отжиманий за минуту. */
  total: number;
}

export const BOTS: readonly Bot[] = [
  { id: 'novice', name: 'Новичок', level: 1, total: 25 },
  { id: 'athlete', name: 'Атлет', level: 2, total: 50 },
  // Как «Гоггинс» из ролика-референса: 117 за минуту — почти без шансов.
  { id: 'machine', name: 'Машина', level: 3, total: 117 },
];

/** Повторов за минуту у новичка, атлета и машины по упражнениям (выпады — пары ног). */
const PACE: Record<DuelExercise, readonly [number, number, number]> = {
  push_up: [25, 50, 117],
  squat: [22, 40, 70],
  jumping_jack: [40, 70, 120],
  lunge: [10, 18, 32],
  high_knees: [80, 140, 230],
  burpee: [8, 15, 28],
  squat_press: [12, 22, 36],
  knee_to_elbow: [24, 44, 76],
  arm_raise: [24, 44, 80],
  boxing: [70, 130, 230],
};

/** Сколько бот сделает за бой: темп упражнения × длительность (устаёт — уже внутри botTimeline). */
export function botTotal(bot: Bot, exercise: DuelExercise, durationMs: number): number {
  const perMin = PACE[exercise]?.[bot.level - 1] ?? bot.total;
  return Math.max(1, Math.round((perMin * durationMs) / 60_000));
}

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
