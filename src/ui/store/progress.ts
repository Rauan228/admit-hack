// U-13: рекорды и прогресс в localStorage. Любой доступ обёрнут в try/catch:
// в приватном режиме или при запрете хранилища приложение работает, просто без памяти.

/** custom — день из ИИ-плана: в рейтинг не идёт. */
export type PlanKind = 'quick' | 'single' | 'challenge' | 'custom';

export interface RecordEntry {
  id: string;
  name: string;
  kind: PlanKind;
  /** Что именно делали: «Быстрая тренировка», «Приседания», «Челлендж 60 с». */
  label: string;
  points: number;
  reps: number;
  cleanReps: number;
  avgScore: number;
  durationSec: number;
  date: number;
}

interface Totals {
  workouts: number;
  reps: number;
  cleanReps: number;
  seconds: number;
}

const KEY = {
  records: 'forma.records.v1',
  totals: 'forma.totals.v1',
  name: 'forma.name.v1',
  muted: 'forma.muted.v1',
  days: 'forma.days.v1',
} as const;

/** Сколько дней тренировок помним (для серии хватает с запасом). */
const MAX_DAYS = 120;

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* хранилище недоступно — не страшно */
  }
}

export const MAX_RECORDS = 10;

export function loadRecords(): RecordEntry[] {
  const list = read<RecordEntry[]>(KEY.records, []);
  return Array.isArray(list) ? list.sort((a, b) => b.points - a.points) : [];
}

/** Попадёт ли результат в топ-10. */
export function qualifies(points: number): boolean {
  if (points <= 0) return false;
  const list = loadRecords();
  return list.length < MAX_RECORDS || points > (list[list.length - 1]?.points ?? 0);
}

export function bestFor(label: string): RecordEntry | null {
  return loadRecords().find((r) => r.label === label) ?? null;
}

export function saveRecord(entry: Omit<RecordEntry, 'id' | 'date'>): RecordEntry {
  const full: RecordEntry = { ...entry, id: Math.random().toString(36).slice(2, 10), date: Date.now() };
  const list = [...loadRecords(), full].sort((a, b) => b.points - a.points).slice(0, MAX_RECORDS);
  write(KEY.records, list);
  write(KEY.name, entry.name);
  return full;
}

export function loadTotals(): Totals {
  return { workouts: 0, reps: 0, cleanReps: 0, seconds: 0, ...read<Partial<Totals>>(KEY.totals, {}) };
}

export function addToTotals(reps: number, cleanReps: number, seconds: number): Totals {
  const t = loadTotals();
  const next = {
    workouts: t.workouts + 1,
    reps: t.reps + reps,
    cleanReps: t.cleanReps + cleanReps,
    seconds: t.seconds + Math.round(seconds),
  };
  write(KEY.totals, next);
  markTrainedToday();
  return next;
}

/** День по местному времени: «2026-10-02». */
export function dayKey(t: number): string {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Дни, в которые была тренировка (и дни рекордов — они были записаны раньше этого списка). */
export function loadTrainedDays(): Set<string> {
  const days = new Set(read<string[]>(KEY.days, []));
  for (const r of loadRecords()) days.add(dayKey(r.date));
  return days;
}

export function markTrainedToday(now = Date.now()): void {
  const days = [...new Set([...read<string[]>(KEY.days, []), dayKey(now)])].sort().slice(-MAX_DAYS);
  write(KEY.days, days);
}

/**
 * Серия: сколько дней подряд с тренировкой, считая сегодня (если сегодня ещё нет — со вчера, серия не
 * сгорает до конца дня), и отметки этой недели с понедельника.
 */
export function trainingStreak(
  days: ReadonlySet<string>,
  now = Date.now(),
): { days: number; week: boolean[] } {
  const DAY = 86_400_000;
  const at = (k: number) => {
    const d = new Date(now);
    d.setHours(12, 0, 0, 0);
    return d.getTime() + k * DAY;
  };
  let k = days.has(dayKey(at(0))) ? 0 : -1;
  let n = 0;
  while (days.has(dayKey(at(k)))) {
    n += 1;
    k -= 1;
  }
  const monday = -((new Date(now).getDay() + 6) % 7);
  const week = Array.from({ length: 7 }, (_, i) => days.has(dayKey(at(monday + i))));
  return { days: n, week };
}

export function lastName(): string | null {
  return read<string | null>(KEY.name, null);
}

export function loadMuted(): boolean {
  return read<boolean>(KEY.muted, false);
}

export function saveMuted(muted: boolean): void {
  write(KEY.muted, muted);
}

// Ник без клавиатуры: выбираем жестом из сгенерированных.
const ADJ = [
  'Быстрый',
  'Стальной',
  'Ловкий',
  'Смелый',
  'Железный',
  'Точный',
  'Бодрый',
  'Мощный',
  'Грозный',
  'Лёгкий',
];
const NOUN = ['Барс', 'Сокол', 'Беркут', 'Тигр', 'Гепард', 'Волк', 'Ястреб', 'Кит', 'Лис', 'Тулпар'];

export function generateNames(count = 3, seed = Date.now()): string[] {
  const out = new Set<string>();
  let s = seed % 2147483647 || 1;
  const rnd = () => (s = (s * 48271) % 2147483647) / 2147483647;
  while (out.size < count) {
    out.add(`${ADJ[Math.floor(rnd() * ADJ.length)]} ${NOUN[Math.floor(rnd() * NOUN.length)]}`);
  }
  return [...out];
}
