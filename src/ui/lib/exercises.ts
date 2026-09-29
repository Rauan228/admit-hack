// Что UI знает об упражнениях и программах: названия, короткие подсказки для интро, цели повторов.
// Тексты ошибок техники здесь не дублируем — они в engine/hints.ts.

import { findFormError } from '../../engine/hints';
import type { ExerciseId } from '../../engine/types';
import type { PlanKind } from '../store/progress';
import type { IconName } from '../components/Icon';

export interface ExerciseMeta {
  title: string;
  /** Одно слово для бейджа. */
  short: string;
  icon: IconName;
  /** Три коротких правила для экрана интро. */
  cues: [string, string, string];
  /** «Обе руки вверх» завершает подход досрочно; в «звёздочке» и подъёме рук руки вверху — само движение. */
  handsUpToFinish: boolean;
}

export const EXERCISE_META: Record<ExerciseId, ExerciseMeta> = {
  squat: {
    title: 'Приседания',
    short: 'Присед',
    icon: 'zap',
    cues: ['Ноги на ширине плеч', 'Таз назад и вниз — до параллели', 'Колени по линии носков'],
    handsUpToFinish: true,
  },
  jumping_jack: {
    title: 'Прыжки «звёздочка»',
    short: 'Звёздочка',
    icon: 'arms',
    cues: ['Руки над головой', 'Ноги шире плеч', 'Руки и ноги — одновременно'],
    handsUpToFinish: false,
  },
  lunge: {
    title: 'Выпады',
    short: 'Выпад',
    icon: 'flag',
    cues: ['Встань лицом к камере', 'Шаг назад, заднее колено к полу', 'Корпус вертикально'],
    handsUpToFinish: true,
  },
  arm_raise: {
    title: 'Подъём рук',
    short: 'Руки',
    icon: 'arms',
    cues: ['Руки через стороны вверх', 'Локти прямые', 'Обе руки одновременно'],
    handsUpToFinish: false,
  },
};

export interface PlanItem {
  exercise: ExerciseId;
  target: number;
}

export interface Plan {
  kind: PlanKind;
  label: string;
  items: PlanItem[];
  /** Ограничение по времени на подход (челлендж), секунды. */
  timeLimitSec?: number;
}

export const QUICK_PLAN: Plan = {
  kind: 'quick',
  label: 'Быстрая тренировка',
  items: [
    { exercise: 'squat', target: 8 },
    { exercise: 'jumping_jack', target: 12 },
    { exercise: 'lunge', target: 6 },
  ],
};

export const CHALLENGE_PLAN: Plan = {
  kind: 'challenge',
  label: 'Челлендж 60 с',
  // Цель заведомо недостижима: подход заканчивает таймер, а не движок.
  items: [{ exercise: 'squat', target: 999 }],
  timeLimitSec: 60,
};

const SINGLE_TARGET: Record<ExerciseId, number> = { squat: 10, jumping_jack: 15, lunge: 8, arm_raise: 10 };

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
