// Рейтинг FORMA: одни и те же формулы на сервере (server/app.ts) и в итогах тренировки (UI).
// Во всех режимах в рейтинг идут только ЧИСТЫЕ повторения — техника важнее количества.
// Файл без импортов: сервер запускает его прямо в Node (--experimental-strip-types).

/** Упражнения, у которых есть своя доска «Одно упражнение». Совпадает с ExerciseId (проверяет тест). */
export const RATED_EXERCISES = [
  'squat',
  'jumping_jack',
  'lunge',
  'arm_raise',
  'high_knees',
  'knee_to_elbow',
  'squat_press',
  'side_bend',
  'side_leg_raise',
  'side_lunge',
  'jump_squat',
  'calf_raise',
  'cross_jack',
  'arm_circles',
  'boxing',
  'push_up',
  'plank',
  'burpee',
] as const;
export type RatedExercise = (typeof RATED_EXERCISES)[number];

/** Упражнения челленджа 60 с — все, кроме планки (она на время, а не на повторы). */
export type ChallengeExercise = Exclude<RatedExercise, 'plank'>;
export const CHALLENGE_EXERCISES = RATED_EXERCISES.filter((e) => e !== 'plank') as ChallengeExercise[];

/** Доски: 'challenge' — челлендж приседаний (исторически первый), остальные — challenge:<упражнение>. */
export type Board =
  'quick' | 'challenge' | `challenge:${Exclude<ChallengeExercise, 'squat'>}` | `single:${RatedExercise}`;

/** Цель подхода в режиме «Одно упражнение» (выпады — в парах ног). */
export const SINGLE_TARGET: Record<RatedExercise, number> = {
  squat: 10,
  jumping_jack: 15,
  lunge: 6,
  arm_raise: 10,
  high_knees: 20,
  knee_to_elbow: 12,
  squat_press: 8,
  side_bend: 12,
  side_leg_raise: 12,
  side_lunge: 10,
  jump_squat: 8,
  calf_raise: 15,
  cross_jack: 15,
  arm_circles: 15,
  boxing: 20,
  push_up: 10,
  plank: 30, // секунды
  burpee: 6,
};
/** Длительность челленджа, секунды. */
export const CHALLENGE_SEC = 60;
/** Быстрая тренировка: сколько повторений в плане всего (10 приседаний + 8 отжиманий + 6 бёрпи). */
export const QUICK_TOTAL_REPS = 24;
/** Бонус за темп в быстрой тренировке: полный — если уложился в эту длительность, к 0 — за QUICK_SLOW_SEC. */
const QUICK_FAST_SEC = 120;
const QUICK_SLOW_SEC = 300;
const QUICK_TEMPO_MAX = 40;

export interface ResultInput {
  board: Board;
  reps: number;
  cleanReps: number;
  /** Средняя оценка техники 0–100. */
  avgScore: number;
  durationSec: number;
  /** Цель подхода (для «Одного упражнения»). */
  target?: number;
  errorCounts?: Record<string, number>;
}

export interface Rated {
  /** Главное число доски: больше — лучше. */
  rating: number;
  /** При равном рейтинге: больше — лучше. */
  tiebreak: number;
}

export const BOARD_INFO: Record<
  'quick' | 'single' | 'challenge',
  { title: string; unit: string; rule: string }
> = {
  quick: {
    title: 'Быстрая тренировка',
    unit: 'очков',
    rule: 'Чистые повторения × средняя оценка ÷ 10 + бонус за темп (до 40). При равенстве — выше % чистых.',
  },
  single: {
    title: 'Одно упражнение',
    unit: 'из 100',
    rule: 'Индекс техники: 60% — средняя оценка, 40% — доля чистых повторений от цели. При равенстве — быстрее.',
  },
  challenge: {
    title: 'Челлендж 60 с',
    unit: 'чистых',
    rule: 'Сколько чистых повторений за минуту. При равенстве — выше средняя оценка.',
  },
};

export function boardKind(board: Board): 'quick' | 'single' | 'challenge' {
  if (board === 'quick') return 'quick';
  return board.startsWith('challenge') ? 'challenge' : 'single';
}

/** Упражнение доски челленджа: 'challenge' — приседания. Не челлендж — null. */
export function challengeExercise(board: Board): ChallengeExercise | null {
  if (board === 'challenge') return 'squat';
  return board.startsWith('challenge:') ? (board.slice(10) as ChallengeExercise) : null;
}

/** Доска челленджа для упражнения (приседания — прежняя 'challenge', чтобы рекорды не потерялись). */
export function challengeBoard(exercise: ChallengeExercise): Board {
  return exercise === 'squat' ? 'challenge' : (`challenge:${exercise}` as Board);
}

export function boardExercise(board: Board): RatedExercise | null {
  return board.startsWith('single:') ? (board.slice(7) as RatedExercise) : null;
}

export function isBoard(v: unknown): v is Board {
  if (v === 'quick' || v === 'challenge') return true;
  if (typeof v === 'string' && v.startsWith('challenge:'))
    return v !== 'challenge:squat' && (CHALLENGE_EXERCISES as readonly string[]).includes(v.slice(10));
  return (
    typeof v === 'string' &&
    v.startsWith('single:') &&
    (RATED_EXERCISES as readonly string[]).includes(v.slice(7))
  );
}

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

/** Рейтинг результата на его доске. */
export function rate(r: ResultInput): Rated {
  const avg = clamp(r.avgScore, 0, 100);
  switch (boardKind(r.board)) {
    case 'quick': {
      const tempo =
        r.cleanReps > 0
          ? QUICK_TEMPO_MAX *
            clamp((QUICK_SLOW_SEC - r.durationSec) / (QUICK_SLOW_SEC - QUICK_FAST_SEC), 0, 1)
          : 0;
      // Бонус за темп — только за полностью пройденный план: иначе быстрее всех был бы тот, кто бросил.
      const full = r.reps >= QUICK_TOTAL_REPS;
      return {
        rating: Math.round((r.cleanReps * avg) / 10 + (full ? tempo : 0)),
        tiebreak: r.reps ? Math.round((100 * r.cleanReps) / r.reps) : 0,
      };
    }
    case 'single': {
      const ex = boardExercise(r.board);
      const target = ex ? SINGLE_TARGET[ex] : Math.max(1, r.target ?? r.reps);
      const cleanPct = clamp((100 * r.cleanReps) / target, 0, 100);
      return { rating: Math.round(avg * 0.6 + cleanPct * 0.4), tiebreak: -Math.round(r.durationSec) };
    }
    case 'challenge':
      return { rating: Math.round(r.cleanReps), tiebreak: Math.round(avg) };
  }
}

/** Проверка правдоподобия: null — всё в порядке, иначе текст причины. */
export function validate(r: ResultInput): string | null {
  const nums = [r.reps, r.cleanReps, r.avgScore, r.durationSec];
  if (!isBoard(r.board)) return 'Неизвестный режим';
  if (nums.some((n) => typeof n !== 'number' || !Number.isFinite(n) || n < 0)) return 'Некорректные числа';
  if (!Number.isInteger(r.reps) || !Number.isInteger(r.cleanReps)) return 'Повторения — целые числа';
  if (r.cleanReps > r.reps) return 'Чистых повторений больше, чем всего';
  if (r.avgScore > 100) return 'Оценка больше 100';
  if (r.reps === 0) return 'Нет ни одного повторения';
  // Быстрее ~1,5 повтора в секунду человек не двигается (у выпадов пара ног — ещё медленнее).
  if (r.reps > r.durationSec * 1.5 + 2) return 'Слишком много повторений за это время';
  if (r.durationSec > 60 * 30) return 'Слишком долгий подход';
  const kind = boardKind(r.board);
  if (kind === 'challenge' && r.durationSec > CHALLENGE_SEC + 5) return 'Челлендж длится 60 секунд';
  const ex = boardExercise(r.board);
  if (ex && r.reps > SINGLE_TARGET[ex] + 2) return 'Повторений больше цели';
  if (kind === 'quick' && r.reps > QUICK_TOTAL_REPS + 3) return 'Повторений больше плана';
  return null;
}
