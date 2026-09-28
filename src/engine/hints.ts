// Все русские тексты подсказок в одном месте: источник правды — brain/PLAN.md §3.
// Отсюда их берёт мок-движок (E-02) и движок правил (E-09…E-12): дублировать тексты нельзя.

import type { Arrow, CalibrationStatus, ExerciseId, Joint, Phase, Severity } from './types';

/** Индексы точек MediaPipe Pose (33 landmark'а), чтобы не писать магические числа. */
export const LM = {
  nose: 0,
  leftShoulder: 11,
  rightShoulder: 12,
  leftElbow: 13,
  rightElbow: 14,
  leftWrist: 15,
  rightWrist: 16,
  leftHip: 23,
  rightHip: 24,
  leftKnee: 25,
  rightKnee: 26,
  leftAnkle: 27,
  rightAnkle: 28,
  leftFootIndex: 31,
  rightFootIndex: 32,
} as const;

export interface FormErrorDef {
  /** Стабильный код ошибки: по нему UI группирует статистику в итогах. */
  code: string;
  /** Конкретная подсказка на русском. «Движение не распознано» недопустимо. */
  message: string;
  /** Суставы, которые UI красит красным. */
  joints: Joint[];
  /** Куда двигать сустав; стрелку рисует UI. */
  arrow?: Arrow;
  severity: Severity;
  /** Фазы движения, на которых правило вообще имеет смысл проверять. */
  phases: Phase[];
  /** 1 — самая важная ошибка: при нескольких одновременно показываем одну. */
  priority: number;
  /** Штраф к оценке повторения (0..100). */
  penalty: number;
}

export const FORM_ERRORS: Record<ExerciseId, FormErrorDef[]> = {
  squat: [
    {
      code: 'shallow_depth',
      message: 'Сядь глубже — бедро до параллели с полом',
      joints: [LM.leftHip, LM.rightHip, LM.leftKnee, LM.rightKnee],
      arrow: 'down',
      severity: 'bad',
      phases: ['bottom'],
      priority: 1,
      penalty: 30,
    },
    {
      code: 'knees_in',
      message: 'Разведи колени наружу, по линии носков',
      joints: [LM.leftKnee, LM.rightKnee],
      arrow: 'out',
      severity: 'bad',
      phases: ['down', 'bottom', 'up'],
      priority: 2,
      penalty: 25,
    },
    {
      code: 'torso_lean',
      message: 'Держи грудь выше, спина ровнее',
      joints: [LM.leftShoulder, LM.rightShoulder, LM.leftHip, LM.rightHip],
      arrow: 'up',
      severity: 'bad',
      phases: ['down', 'bottom', 'up'],
      priority: 3,
      penalty: 20,
    },
    {
      code: 'asymmetry',
      message: 'Распредели вес на обе ноги',
      joints: [LM.leftKnee, LM.rightKnee],
      severity: 'warn',
      phases: ['bottom', 'up'],
      priority: 4,
      penalty: 15,
    },
    {
      code: 'too_fast',
      message: 'Медленнее — опускайся за 2 секунды',
      joints: [LM.leftHip, LM.rightHip],
      severity: 'warn',
      phases: ['up'],
      priority: 5,
      penalty: 10,
    },
  ],
  jumping_jack: [
    {
      code: 'arms_low',
      message: 'Подними руки выше головы',
      joints: [LM.leftWrist, LM.rightWrist],
      arrow: 'up',
      severity: 'bad',
      phases: ['bottom'],
      priority: 1,
      penalty: 25,
    },
    {
      code: 'feet_narrow',
      message: 'Шире ноги — шире плеч',
      joints: [LM.leftAnkle, LM.rightAnkle],
      arrow: 'out',
      severity: 'bad',
      phases: ['bottom'],
      priority: 2,
      penalty: 25,
    },
    {
      code: 'not_synced',
      message: 'Руки и ноги — одновременно',
      joints: [LM.leftWrist, LM.rightWrist, LM.leftAnkle, LM.rightAnkle],
      severity: 'warn',
      phases: ['down', 'up'],
      priority: 3,
      penalty: 15,
    },
  ],
  lunge: [
    {
      code: 'knee_past_toe',
      message: 'Колено не дальше носка — шаг длиннее',
      joints: [LM.leftKnee, LM.leftFootIndex],
      arrow: 'in',
      severity: 'bad',
      phases: ['bottom'],
      priority: 1,
      penalty: 25,
    },
    {
      code: 'back_knee_high',
      message: 'Опусти заднее колено ближе к полу',
      joints: [LM.rightKnee],
      arrow: 'down',
      severity: 'bad',
      phases: ['bottom'],
      priority: 2,
      penalty: 20,
    },
    {
      code: 'torso_lean',
      message: 'Корпус вертикально',
      joints: [LM.leftShoulder, LM.rightShoulder, LM.leftHip, LM.rightHip],
      arrow: 'up',
      severity: 'warn',
      phases: ['down', 'bottom', 'up'],
      priority: 3,
      penalty: 15,
    },
  ],
  arm_raise: [
    {
      code: 'elbows_bent',
      message: 'Выпрями руки полностью',
      joints: [LM.leftElbow, LM.rightElbow],
      arrow: 'up',
      severity: 'bad',
      phases: ['bottom', 'up'],
      priority: 1,
      penalty: 20,
    },
    {
      code: 'one_arm_low',
      message: 'Поднимай руки одновременно',
      joints: [LM.leftWrist, LM.rightWrist],
      arrow: 'up',
      severity: 'warn',
      phases: ['up', 'bottom'],
      priority: 2,
      penalty: 15,
    },
  ],
};

/** Подсказки калибровки: PLAN §2 и «Общие» из §3. */
export const CALIBRATION_HINTS: Record<CalibrationStatus, string> = {
  no_person: 'Повернись лицом к камере — тебя не видно',
  partial: 'Тебя не видно целиком — отойди назад',
  too_close: 'Отойди на шаг назад',
  too_far: 'Подойди ближе и встань в центр',
  dark: 'Слишком темно — добавь света',
  ok: 'Отлично, тебя видно целиком',
};

export function formErrorsFor(exercise: ExerciseId): FormErrorDef[] {
  return FORM_ERRORS[exercise];
}

export function findFormError(exercise: ExerciseId, code: string): FormErrorDef | undefined {
  return FORM_ERRORS[exercise].find((e) => e.code === code);
}
