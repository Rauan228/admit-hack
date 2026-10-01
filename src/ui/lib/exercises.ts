// Что UI знает об упражнениях и программах: названия, короткие подсказки для интро, цели повторов.
// Тексты ошибок техники здесь не дублируем — они в engine/hints.ts.

import { findFormError } from '../../engine/hints';
import type { ExerciseId } from '../../engine/types';
import { SINGLE_TARGET } from '../../shared/rating';
import type { PlanKind } from '../store/progress';
import type { IconName } from '../components/Icon';

export interface ExerciseMeta {
  title: string;
  /** Одно слово для бейджа. */
  short: string;
  icon: IconName;
  /** Три коротких правила для экрана интро. */
  cues: [string, string, string];
  /** Чем меряем подход: повторения (по умолчанию) или секунды удержания (планка). */
  unit?: 'sec';
  /** Особая установка камеры — крупная плашка в интро. */
  setup?: string;
}

/** Категории для экрана выбора: по 2–6 крупных плиток, чтобы рукой попадать с 2–3 метров. */
export const CATEGORIES: { id: string; title: string; icon: IconName; items: ExerciseId[] }[] = [
  {
    id: 'legs',
    title: 'Ноги',
    icon: 'zap',
    items: ['squat', 'lunge', 'side_lunge', 'jump_squat', 'calf_raise', 'side_leg_raise'],
  },
  {
    id: 'cardio',
    title: 'Кардио',
    icon: 'timer',
    items: ['jumping_jack', 'cross_jack', 'high_knees', 'burpee', 'boxing'],
  },
  {
    id: 'upper',
    title: 'Руки и кор',
    icon: 'arms',
    items: ['arm_raise', 'arm_circles', 'squat_press', 'side_bend', 'knee_to_elbow'],
  },
  { id: 'floor', title: 'На полу', icon: 'flag', items: ['push_up', 'plank'] },
];

export const EXERCISE_META: Record<ExerciseId, ExerciseMeta> = {
  squat: {
    title: 'Приседания',
    short: 'Присед',
    icon: 'zap',
    cues: ['Ноги на ширине плеч', 'Таз назад и вниз — до параллели', 'Колени по линии носков'],
  },
  jumping_jack: {
    title: 'Прыжки «звёздочка»',
    short: 'Звёздочка',
    icon: 'arms',
    cues: ['Руки над головой', 'Ноги шире плеч', 'Руки и ноги — одновременно'],
  },
  lunge: {
    title: 'Выпады',
    short: 'Выпад',
    icon: 'flag',
    cues: [
      'Лицом к камере, руки на поясе',
      'Шаг вперёд, заднее колено к полу',
      'Правой, затем левой — 1 повтор',
    ],
  },
  arm_raise: {
    title: 'Подъём рук',
    short: 'Руки',
    icon: 'arms',
    cues: ['Руки через стороны вверх', 'Локти прямые', 'Обе руки одновременно'],
  },
  // E-22: базовые записи для 14 новых упражнений (тексты и иконки — черновик, дизайн за U-20).
  high_knees: {
    title: 'Высокие колени',
    short: 'Колени',
    icon: 'zap',
    cues: ['Лицом к камере', 'Колено до уровня таза', 'Корпус прямо'],
  },
  knee_to_elbow: {
    title: 'Локоть к колену',
    short: 'Локоть',
    icon: 'zap',
    cues: ['Руки за головой', 'Локоть к противоположному колену', 'Поочерёдно в обе стороны'],
  },
  squat_press: {
    title: 'Присед + руки вверх',
    short: 'Присед+жим',
    icon: 'arms',
    cues: ['Присед до параллели', 'Вставая — руки вверх', 'Локти прямые наверху'],
  },
  side_bend: {
    title: 'Наклоны в стороны',
    short: 'Наклоны',
    icon: 'arms',
    cues: ['Лицом к камере', 'Наклон строго в сторону', 'Таз на месте'],
  },
  side_leg_raise: {
    title: 'Отведение ноги',
    short: 'Отведение',
    icon: 'flag',
    cues: ['Руки на поясе', 'Прямая нога в сторону', 'Корпус не заваливай'],
  },
  side_lunge: {
    title: 'Боковые выпады',
    short: 'Бок. выпад',
    icon: 'flag',
    cues: ['Широкий шаг в сторону', 'Колено над стопой', 'Вторая нога прямая'],
  },
  jump_squat: {
    title: 'Присед с выпрыгиванием',
    short: 'Прыжок',
    icon: 'zap',
    cues: ['Присед до параллели', 'Мощно вверх — прыжок', 'Мягкое приземление'],
  },
  calf_raise: {
    title: 'Подъём на носки',
    short: 'Носки',
    icon: 'zap',
    cues: ['Стопы на ширине таза', 'Высоко на носки', 'Медленно вниз'],
  },
  cross_jack: {
    title: '«Звёздочка» с перекрёстом',
    short: 'Перекрёст',
    icon: 'arms',
    cues: ['Прыжок — руки и ноги в стороны', 'Назад — руки и ноги крест-накрест', 'В одном ритме'],
  },
  arm_circles: {
    title: 'Круги руками',
    short: 'Круги',
    icon: 'arms',
    cues: ['Руки в стороны', 'Полный круг', 'Локти прямые'],
  },
  boxing: {
    title: 'Бокс: джеб и кросс',
    short: 'Бокс',
    icon: 'hand',
    cues: ['Кулаки у подбородка', 'Удар до прямой руки', 'Сразу назад в защиту'],
  },
  push_up: {
    title: 'Отжимания',
    short: 'Отжим.',
    icon: 'arms',
    cues: ['Руки чуть шире плеч', 'Тело — прямая линия', 'Грудь к полу, локти назад'],
    setup: 'Положи телефон на пол перед собой, в полуметре от рук, и отжимайся лицом к камере',
  },
  plank: {
    title: 'Планка',
    short: 'Планка',
    icon: 'timer',
    cues: ['Локти под плечами', 'Тело — прямая линия', 'Таз не проваливается'],
    unit: 'sec',
    setup: 'Положи телефон на пол перед собой и встань в планку лицом к камере',
  },
  burpee: {
    title: 'Бёрпи',
    short: 'Бёрпи',
    icon: 'zap',
    cues: ['Лицом к камере', 'Упор лёжа — тело прямо', 'Встал и прыжок'],
  },
};

export interface PlanItem {
  exercise: ExerciseId;
  target: number;
  /** Подход n из of — в ИИ-плане одно упражнение идёт несколькими подходами подряд. */
  set?: { n: number; of: number; restSec: number };
}

export interface Plan {
  kind: PlanKind;
  label: string;
  items: PlanItem[];
  /** Ограничение по времени на подход (челлендж), секунды. */
  timeLimitSec?: number;
  /** День ИИ-плана: после итогов отмечаем его выполненным. */
  coachDay?: { createdAt: number; index: number; week: number };
}

export const QUICK_PLAN: Plan = {
  kind: 'quick',
  label: 'Быстрая тренировка',
  items: [
    { exercise: 'squat', target: 10 },
    { exercise: 'push_up', target: 8 },
    { exercise: 'burpee', target: 6 },
  ],
};

/** Короткий план демо-тура: в моке 1-е повторение чистое, 2-е и 3-е — с ошибками. */
export const DEMO_PLAN: Plan = {
  kind: 'quick',
  label: 'Демо-тренировка',
  items: [
    { exercise: 'squat', target: 3 },
    { exercise: 'jumping_jack', target: 3 },
  ],
};

/** Челлендж 60 с на выбранном упражнении: максимум чистых повторений за минуту. */
export function challengePlan(exercise: ExerciseId): Plan {
  return {
    kind: 'challenge',
    label: exercise === 'squat' ? 'Челлендж 60 с' : `Челлендж 60 с · ${EXERCISE_META[exercise].title}`,
    // Цель заведомо недостижима: подход заканчивает таймер, а не движок.
    items: [{ exercise, target: 999 }],
    timeLimitSec: 60,
  };
}

export const CHALLENGE_PLAN: Plan = challengePlan('squat');

/** Выпады — в парах ног: 6 = шесть раз правой и шесть раз левой. */
// Цели — в общем модуле рейтинга: сервер проверяет по ним «Одно упражнение».

export function singlePlan(exercise: ExerciseId): Plan {
  return {
    kind: 'single',
    label: EXERCISE_META[exercise].title,
    items: [{ exercise, target: SINGLE_TARGET[exercise] }],
  };
}

export function errorMessage(exercise: ExerciseId, code: string): string {
  return findFormError(exercise, code)?.message ?? code;
}
