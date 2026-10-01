// ИИ-конструктор плана: каталог упражнений глазами тренера, анкета, жёсткие ограничения и проверка ответа модели.
// Общий для сервера (промпт, фильтр, нормализация) и UI (анкета, показ плана). Без внешних импортов,
// кроме соседних общих модулей: сервер запускает файл прямо в Node (--experimental-strip-types).

import { RATED_EXERCISES, type RatedExercise } from './rating.ts';

export type CoachExercise = RatedExercise;
/** Программа — 4 недели: каждую неделю цели подходов растут (weekTarget). */
export const PROGRAM_WEEKS = 4;
export const COACH_EXERCISES: readonly CoachExercise[] = RATED_EXERCISES;

/** Что нагружает упражнение — по этим меткам работают ограничения. */
export type LoadTag =
  | 'jump' // прыжки, ударная нагрузка на суставы и позвоночник
  | 'deep_knee' // глубокое сгибание колена под весом тела
  | 'hands_support' // упор на кисти / предплечья
  | 'lying' // лёжа на полу / в упоре
  | 'overhead' // руки над головой
  | 'spine_flex' // сгибание, скручивание или боковой наклон корпуса
  | 'both_arms' // нужны обе руки
  | 'both_legs' // нужны обе ноги (стойка, шаги, прыжки)
  | 'balance' // стойка на одной ноге или быстрые смены опоры
  | 'intense'; // высокий пульс

export interface CoachInfo {
  /** Метаболический эквивалент — для оценки калорий. */
  met: number;
  title: string;
  /** Главные мышцы — по-русски, для модели и для UI. */
  muscles: string[];
  tags: LoadTag[];
  /** Секунд на одно повторение в среднем темпе (для планки — 1: цель в секундах). */
  secPerRep: number;
  /** Диапазон цели за подход. */
  min: number;
  max: number;
  unit: 'reps' | 'sec';
  /** Одна строка для модели: что это и чем полезно. */
  about: string;
}

export const COACH_CATALOG: Record<CoachExercise, CoachInfo> = {
  squat: {
    met: 5,
    title: 'Приседания',
    muscles: ['квадрицепсы', 'ягодицы', 'бицепс бедра'],
    tags: ['deep_knee', 'both_legs'],
    secPerRep: 3,
    min: 6,
    max: 30,
    unit: 'reps',
    about: 'Базовое упражнение на ноги и ягодицы, без прыжков.',
  },
  jumping_jack: {
    met: 8,
    title: 'Прыжки «звёздочка»',
    muscles: ['икры', 'дельты', 'ягодицы'],
    tags: ['jump', 'overhead', 'both_arms', 'both_legs', 'intense'],
    secPerRep: 1.2,
    min: 10,
    max: 50,
    unit: 'reps',
    about: 'Кардио с прыжками, разогрев и жиросжигание.',
  },
  lunge: {
    met: 4,
    title: 'Выпады',
    muscles: ['квадрицепсы', 'ягодицы'],
    tags: ['deep_knee', 'both_legs', 'balance'],
    secPerRep: 5,
    min: 4,
    max: 15,
    unit: 'reps',
    about: 'Выпады вперёд поочерёдно, цель — в парах ног (правая + левая = 1).',
  },
  arm_raise: {
    met: 3,
    title: 'Подъём рук',
    muscles: ['дельты', 'трапеции'],
    tags: ['overhead', 'both_arms'],
    secPerRep: 2.5,
    min: 8,
    max: 25,
    unit: 'reps',
    about: 'Руки через стороны вверх стоя, мягкая нагрузка на плечи, подходит для разминки.',
  },
  high_knees: {
    met: 8,
    title: 'Высокие колени',
    muscles: ['сгибатели бедра', 'пресс', 'икры'],
    tags: ['jump', 'both_legs', 'balance', 'intense'],
    secPerRep: 0.8,
    min: 16,
    max: 60,
    unit: 'reps',
    about: 'Бег на месте с высоким подниманием колен, интенсивное кардио.',
  },
  knee_to_elbow: {
    met: 4,
    title: 'Локоть к колену',
    muscles: ['косые мышцы живота', 'пресс'],
    tags: ['spine_flex', 'both_legs', 'balance'],
    secPerRep: 2,
    min: 8,
    max: 30,
    unit: 'reps',
    about: 'Стоя, руки за головой, локоть к противоположному колену со скручиванием.',
  },
  squat_press: {
    met: 5.5,
    title: 'Присед + руки вверх',
    muscles: ['квадрицепсы', 'ягодицы', 'дельты'],
    tags: ['deep_knee', 'overhead', 'both_arms', 'both_legs'],
    secPerRep: 3.5,
    min: 6,
    max: 20,
    unit: 'reps',
    about: 'Присед, вставая — руки вверх. Всё тело, чуть выше пульс.',
  },
  side_bend: {
    met: 2.5,
    title: 'Наклоны в стороны',
    muscles: ['косые мышцы живота', 'квадратная мышца поясницы'],
    tags: ['spine_flex'],
    secPerRep: 2.5,
    min: 8,
    max: 24,
    unit: 'reps',
    about: 'Боковые наклоны корпуса стоя, мобильность и косые мышцы.',
  },
  side_leg_raise: {
    met: 3,
    title: 'Отведение ноги',
    muscles: ['средняя ягодичная', 'отводящие мышцы бедра'],
    tags: ['balance', 'both_legs'],
    secPerRep: 2.5,
    min: 8,
    max: 24,
    unit: 'reps',
    about: 'Стоя, прямая нога в сторону. Бережно для коленей, укрепляет таз.',
  },
  side_lunge: {
    met: 4,
    title: 'Боковые выпады',
    muscles: ['приводящие мышцы', 'квадрицепсы', 'ягодицы'],
    tags: ['deep_knee', 'both_legs', 'balance'],
    secPerRep: 4,
    min: 6,
    max: 20,
    unit: 'reps',
    about: 'Широкий шаг в сторону с приседом на одну ногу.',
  },
  jump_squat: {
    met: 8,
    title: 'Присед с выпрыгиванием',
    muscles: ['квадрицепсы', 'ягодицы', 'икры'],
    tags: ['jump', 'deep_knee', 'both_legs', 'intense'],
    secPerRep: 2.5,
    min: 5,
    max: 20,
    unit: 'reps',
    about: 'Взрывной присед с прыжком, мощность и кардио. Высокая ударная нагрузка.',
  },
  calf_raise: {
    met: 3,
    title: 'Подъём на носки',
    muscles: ['икры'],
    tags: ['both_legs'],
    secPerRep: 2,
    min: 10,
    max: 30,
    unit: 'reps',
    about: 'Подъём на носки стоя, щадящее упражнение на икры и стопы.',
  },
  cross_jack: {
    met: 8,
    title: '«Звёздочка» с перекрёстом',
    muscles: ['икры', 'дельты', 'приводящие мышцы'],
    tags: ['jump', 'overhead', 'both_arms', 'both_legs', 'intense'],
    secPerRep: 1.3,
    min: 10,
    max: 40,
    unit: 'reps',
    about: 'Прыжки: руки и ноги в стороны, затем крест-накрест. Кардио и координация.',
  },
  arm_circles: {
    met: 3,
    title: 'Круги руками',
    muscles: ['дельты', 'вращательная манжета плеча'],
    tags: ['both_arms'],
    secPerRep: 1.5,
    min: 10,
    max: 30,
    unit: 'reps',
    about: 'Круги прямыми руками в стороны, мобильность плеч и разминка.',
  },
  boxing: {
    met: 7,
    title: 'Бокс: джеб и кросс',
    muscles: ['дельты', 'грудные', 'косые мышцы живота'],
    tags: ['both_arms', 'intense'],
    secPerRep: 0.8,
    min: 16,
    max: 60,
    unit: 'reps',
    about: 'Удары руками стоя, без прыжков. Кардио для верха тела.',
  },
  push_up: {
    met: 6,
    title: 'Отжимания',
    muscles: ['грудные', 'трицепсы', 'передние дельты', 'пресс'],
    tags: ['hands_support', 'lying', 'both_arms'],
    secPerRep: 2.5,
    min: 4,
    max: 25,
    unit: 'reps',
    about: 'Отжимания от пола, сила верха тела. Упор на кисти.',
  },
  plank: {
    met: 4,
    title: 'Планка',
    muscles: ['пресс', 'мышцы кора', 'плечи'],
    tags: ['hands_support', 'lying', 'both_arms'],
    secPerRep: 1,
    min: 15,
    max: 120,
    unit: 'sec',
    about: 'Статическое удержание на локтях, цель в секундах. Кор и осанка.',
  },
  burpee: {
    met: 10,
    title: 'Бёрпи',
    muscles: ['всё тело', 'квадрицепсы', 'грудные', 'пресс'],
    tags: ['jump', 'deep_knee', 'hands_support', 'lying', 'spine_flex', 'both_arms', 'both_legs', 'intense'],
    secPerRep: 4,
    min: 3,
    max: 15,
    unit: 'reps',
    about: 'Присед — упор лёжа — прыжок. Самое интенсивное, всё тело.',
  },
};

// ---- Анкета ----

export const GOALS = {
  lose_weight: { title: 'Похудеть', sub: 'Сжечь жир, больше кардио' },
  build_muscle: { title: 'Набрать мышечную массу', sub: 'Сила и объём, больше повторений с отдыхом' },
  tone: { title: 'Подтянуть тело', sub: 'Рельеф и тонус без лишнего веса' },
  endurance: { title: 'Выносливость', sub: 'Дыхание, пульс, дольше без усталости' },
  health: { title: 'Здоровье и подвижность', sub: 'Мягко, суставы и осанка' },
} as const;
export type Goal = keyof typeof GOALS;

export const LEVELS = {
  beginner: 'Новичок',
  intermediate: 'Тренируюсь иногда',
  advanced: 'Тренируюсь регулярно',
} as const;
export type Level = keyof typeof LEVELS;

/** Частые ограничения — галочками. Их сервер применяет жёстко, до модели. Остальное — свободным текстом. */
export const LIMITS = {
  no_jumps: { title: 'Нельзя прыгать', sub: 'Грыжа, давление, после травмы', drop: ['jump'] },
  back: { title: 'Спина / грыжа', sub: 'Поясница, протрузии', drop: ['jump', 'spine_flex'] },
  knees: { title: 'Колени', sub: 'Боль при приседе, травма', drop: ['jump', 'deep_knee'] },
  wrists: { title: 'Кисти / запястья', sub: 'Больно упираться руками', drop: ['hands_support'] },
  shoulders: { title: 'Плечи', sub: 'Больно поднимать руки', drop: ['overhead', 'hands_support'] },
  one_arm: {
    title: 'Работает одна рука',
    sub: 'Нет руки или она не работает',
    drop: ['both_arms', 'hands_support'],
  },
  one_leg: {
    title: 'Работает одна нога',
    sub: 'Нет ноги, протез, травма',
    drop: ['both_legs', 'jump', 'balance', 'deep_knee'],
  },
  heart: { title: 'Сердце / давление', sub: 'Нельзя высокий пульс', drop: ['intense', 'jump'] },
  balance: { title: 'Плохой баланс', sub: 'Головокружение, возраст', drop: ['balance', 'jump'] },
  pregnancy: {
    title: 'Беременность',
    sub: 'Без прыжков, лёжа и скручиваний',
    drop: ['jump', 'lying', 'spine_flex', 'intense'],
  },
  no_floor: { title: 'Не могу на пол', sub: 'Тяжело лечь и встать', drop: ['lying'] },
} as const satisfies Record<string, { title: string; sub: string; drop: LoadTag[] }>;
export type Limit = keyof typeof LIMITS;

export interface CoachProfile {
  goal: Goal;
  sex: 'male' | 'female';
  age: number;
  heightCm: number;
  weightKg: number;
  /** Желаемый вес — необязательно. */
  targetKg?: number;
  level: Level;
  daysPerWeek: number;
  minutesPerSession: number;
  limits: Limit[];
  /** Свободный текст: травмы, болезни, что нравится и не нравится. */
  notes: string;
}

/** Проверка анкеты. Возвращает текст ошибки или null. */
export function checkProfile(p: unknown): string | null {
  const v = p as Partial<CoachProfile> | null;
  if (!v || typeof v !== 'object') return 'Нет анкеты';
  if (!v.goal || !(v.goal in GOALS)) return 'Выбери цель';
  if (v.sex !== 'male' && v.sex !== 'female') return 'Укажи пол';
  if (!num(v.age, 10, 100)) return 'Возраст — от 10 до 100';
  if (!num(v.heightCm, 100, 230)) return 'Рост — от 100 до 230 см';
  if (!num(v.weightKg, 25, 300)) return 'Вес — от 25 до 300 кг';
  if (v.targetKg !== undefined && v.targetKg !== null && !num(v.targetKg, 25, 300))
    return 'Желаемый вес — от 25 до 300 кг';
  if (!v.level || !(v.level in LEVELS)) return 'Укажи уровень подготовки';
  if (!num(v.daysPerWeek, 1, 7)) return 'Дней в неделю — от 1 до 7';
  if (!num(v.minutesPerSession, 5, 60)) return 'Минут на тренировку — от 5 до 60';
  if (!Array.isArray(v.limits) || v.limits.some((l) => !(l in LIMITS))) return 'Неизвестное ограничение';
  if (typeof v.notes !== 'string' || v.notes.length > 1500) return 'Комментарий — до 1500 символов';
  return null;
}

function num(v: unknown, min: number, max: number): boolean {
  return typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;
}

export function bmi(p: Pick<CoachProfile, 'heightCm' | 'weightKg'>): number {
  const m = p.heightCm / 100;
  return Math.round((p.weightKg / (m * m)) * 10) / 10;
}

/** Упражнения, которые убирают галочки, — с причиной. Остальные доступны модели. */
export function hardExclusions(limits: readonly Limit[]): Map<CoachExercise, string> {
  const out = new Map<CoachExercise, string>();
  for (const ex of COACH_EXERCISES) {
    const tags = COACH_CATALOG[ex].tags;
    for (const l of limits) {
      const drop = LIMITS[l].drop as readonly LoadTag[];
      if (tags.some((t) => drop.includes(t))) {
        out.set(ex, `Ограничение: ${LIMITS[l].title.toLowerCase()}`);
        break;
      }
    }
  }
  return out;
}

// ---- План ----

export interface PlanExercise {
  exercise: CoachExercise;
  sets: number;
  /** Повторов (или секунд для планки) в подходе. */
  target: number;
  restSec: number;
  /** Почему это упражнение и на что обратить внимание. */
  note: string;
}

export interface PlanSession {
  day: string;
  title: string;
  focus: string;
  items: PlanExercise[];
  /** Оценка длительности — считает сервер, не модель. */
  minutes: number;
}

export interface CoachPlan {
  title: string;
  summary: string;
  /** Что модель учла из анкеты. */
  insights: string[];
  warnings: string[];
  excluded: { exercise: CoachExercise; reason: string }[];
  sessions: PlanSession[];
  progression: string;
  tips: string[];
  createdAt: number;
  model: string;
}

/** JSON Schema ответа модели (strict structured output). */
export function planSchema(allowed: readonly CoachExercise[]) {
  const ex = { type: 'string', enum: allowed.length ? [...allowed] : ['squat'] };
  const str = { type: 'string' };
  const strs = { type: 'array', items: str };
  return {
    type: 'object',
    additionalProperties: false,
    required: ['title', 'summary', 'insights', 'warnings', 'excluded', 'sessions', 'progression', 'tips'],
    properties: {
      title: str,
      summary: str,
      insights: strs,
      warnings: strs,
      excluded: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['exercise', 'reason'],
          properties: { exercise: { type: 'string', enum: [...COACH_EXERCISES] }, reason: str },
        },
      },
      sessions: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['day', 'title', 'focus', 'items'],
          properties: {
            day: str,
            title: str,
            focus: str,
            items: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['exercise', 'sets', 'target', 'restSec', 'note'],
                properties: {
                  exercise: ex,
                  sets: { type: 'integer' },
                  target: { type: 'integer' },
                  restSec: { type: 'integer' },
                  note: str,
                },
              },
            },
          },
        },
      },
      progression: str,
      tips: strs,
    },
  };
}

export const SYSTEM_PROMPT = `Ты — опытный персональный тренер и спортивный врач в веб-приложении FORMA.
Тренировки идут дома перед камерой: камера считает повторения и проверяет технику, инвентаря нет.
Составь персональный недельный план ТОЛЬКО из упражнений каталога, который тебе дан.

Как думать:
1. Внимательно изучи анкету: цель, пол, возраст, рост, вес, ИМТ, уровень, дни и минуты, ограничения и комментарий.
2. Комментарий пользователя важнее всего. Найди в нём травмы, болезни, отсутствие конечностей, боли, беременность,
   предпочтения. Убери всё, что может навредить: при грыже — прыжки, скручивания и ударную нагрузку; нет руки —
   всё, где нужны обе руки или упор; больные колени — глубокие приседы и прыжки; и так далее. Сомневаешься — убирай.
   Каждое убранное тобой упражнение с понятной причиной положи в excluded.
3. Под цель: похудение — больше кардио и круговой формат, короткий отдых; масса — силовые, больше подходов,
   отдых 60–90 с, постепенный рост повторов; тонус — смешанно; выносливость — длинные подходы и короткий отдых;
   здоровье — мягкие упражнения, мобильность, без высокого пульса.
4. Под уровень: новичку — меньше подходов и повторов (ближе к нижней границе), продвинутому — ближе к верхней.
   Цель подхода держи в диапазоне min–max из каталога. Для планки цель — секунды. Для выпадов — пары ног.
5. Ровно столько тренировок, сколько дней в неделю указано. Распредели дни по неделе с отдыхом между
   тяжёлыми днями (day — «Пн», «Ср» и т. п.). Каждая тренировка должна укладываться в указанные минуты:
   считай подходы × повторы × secPerRep + отдых — и используй время почти полностью (не меньше 80%):
   если упражнений осталось мало, добавь подходы (до 5) и круги. Начинай с разминочного упражнения.
6. Не повторяй одно и то же упражнение в тренировке дважды — используй sets. 3–6 упражнений на тренировку.
7. Пиши по-русски, на «ты», коротко и по делу. В текстах называй упражнения по-русски (title), не id. title — 3–6 слов, суть плана без чисел недель (например, «Сильные ноги без прыжков»).
   summary — 2–3 предложения: почему план такой.
   insights — 3–5 пунктов, что ты учёл из анкеты (конкретно: «ИМТ 31 — начнём без прыжков…»).
   warnings — медицинские предупреждения, если есть поводы (советуй врача при серьёзных состояниях); иначе пусто.
   note к упражнению — одна фраза, зачем оно и на что смотреть. progression — как усложнять неделя за неделей.
   tips — 2–4 совета по питанию, сну, восстановлению под цель.
8. Если безопасных упражнений почти нет — сделай мягкий план из оставшихся и честно объясни в warnings.
Ты не ставишь диагнозы и не заменяешь врача.`;

/** Сообщение пользователя для модели: анкета + доступный каталог + что уже убрано. */
export function userPrompt(
  p: CoachProfile,
  allowed: readonly CoachExercise[],
  hard: Map<CoachExercise, string>,
) {
  const catalog = allowed.map((id) => {
    const c = COACH_CATALOG[id];
    return {
      id,
      title: c.title,
      muscles: c.muscles,
      load: c.tags,
      unit: c.unit,
      min: c.min,
      max: c.max,
      secPerRep: c.secPerRep,
      about: c.about,
    };
  });
  const profile = {
    goal: GOALS[p.goal].title,
    sex: p.sex === 'male' ? 'мужской' : 'женский',
    age: p.age,
    heightCm: p.heightCm,
    weightKg: p.weightKg,
    targetKg: p.targetKg ?? null,
    bmi: bmi(p),
    level: LEVELS[p.level],
    daysPerWeek: p.daysPerWeek,
    minutesPerSession: p.minutesPerSession,
    limits: p.limits.map((l) => LIMITS[l].title),
    notes: p.notes.trim() || '—',
  };
  return [
    `Анкета:\n${JSON.stringify(profile, null, 1)}`,
    `Каталог (только эти упражнения можно ставить в план):\n${JSON.stringify(catalog)}`,
    hard.size
      ? `Уже исключены по ограничениям (в план не ставь, в excluded не дублируй): ${[...hard.keys()].join(', ')}`
      : '',
  ]
    .filter(Boolean)
    .join('\n\n');
}

type RawPlan = Omit<CoachPlan, 'createdAt' | 'model' | 'sessions'> & {
  sessions: Omit<PlanSession, 'minutes'>[];
};

const clampInt = (v: unknown, min: number, max: number, dflt: number) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : dflt;
};
const text = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const texts = (v: unknown, n: number, max: number) =>
  Array.isArray(v)
    ? v
        .map((s) => text(s, max))
        .filter(Boolean)
        .slice(0, n)
    : [];

/** Минут на тренировку: подходы × цель × темп + отдых между подходами. */
export function sessionMinutes(items: readonly PlanExercise[]): number {
  let sec = 0;
  for (const it of items) {
    const c = COACH_CATALOG[it.exercise];
    sec += it.sets * (it.target * c.secPerRep + 10) + Math.max(0, it.sets - 1) * it.restSec + 20;
  }
  return Math.max(1, Math.round(sec / 60));
}

/**
 * Ответ модели → план, которому можно доверять: только разрешённые упражнения, цели в диапазоне,
 * без повторов в тренировке, жёсткие исключения — всегда в списке. Модели не верим на слово.
 */
export function normalizePlan(
  raw: unknown,
  p: Pick<CoachProfile, 'daysPerWeek'>,
  hard: Map<CoachExercise, string>,
  meta: { now: number; model: string },
): CoachPlan {
  const r = (raw ?? {}) as Partial<RawPlan>;
  const allowed = new Set(COACH_EXERCISES.filter((e) => !hard.has(e)));
  const excluded = new Map<CoachExercise, string>(hard);
  for (const e of Array.isArray(r.excluded) ? r.excluded : []) {
    if (e && COACH_EXERCISES.includes(e.exercise) && !excluded.has(e.exercise))
      excluded.set(e.exercise, text(e.reason, 160) || 'Не подходит под твои ограничения');
  }
  const sessions: PlanSession[] = [];
  for (const s of (Array.isArray(r.sessions) ? r.sessions : []).slice(0, p.daysPerWeek)) {
    const seen = new Set<CoachExercise>();
    const items: PlanExercise[] = [];
    for (const it of Array.isArray(s?.items) ? s.items : []) {
      const ex = it?.exercise;
      // Модель сама решила убрать упражнение — в план его не пускаем, даже если поставила.
      if (!ex || !allowed.has(ex) || excluded.has(ex) || seen.has(ex)) continue;
      seen.add(ex);
      const c = COACH_CATALOG[ex];
      items.push({
        exercise: ex,
        sets: clampInt(it.sets, 1, 5, 2),
        target: clampInt(it.target, c.min, c.max, c.min),
        restSec: clampInt(it.restSec, 15, 180, 45),
        note: text(it.note, 200),
      });
      if (items.length >= 8) break;
    }
    if (!items.length) continue;
    sessions.push({
      day: text(s.day, 12) || `День ${sessions.length + 1}`,
      title: text(s.title, 60) || `Тренировка ${sessions.length + 1}`,
      focus: text(s.focus, 120),
      items,
      minutes: sessionMinutes(items),
    });
  }
  return {
    title: text(r.title, 80) || 'Твой план',
    summary: text(r.summary, 600),
    insights: texts(r.insights, 6, 220),
    warnings: texts(r.warnings, 5, 260),
    excluded: [...excluded].map(([exercise, reason]) => ({ exercise, reason })),
    sessions,
    progression: text(r.progression, 500),
    tips: texts(r.tips, 5, 220),
    createdAt: meta.now,
    model: meta.model,
  };
}
