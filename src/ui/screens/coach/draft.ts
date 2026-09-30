// Анкета ИИ-тренера в UI: черновик полей (строки, пока человек печатает) ↔ профиль для сервера, подписи.

import type { CoachProfile, Goal } from '../../../shared/coach';
import type { IconName } from '../../components/Icon';

export const FLOW = ['Цель', 'Данные', 'Ограничения', 'Анализ', 'План'] as const;

export type Draft = Omit<CoachProfile, 'age' | 'heightCm' | 'weightKg' | 'targetKg'> & {
  age: string;
  heightCm: string;
  weightKg: string;
  targetKg: string;
};

export const EMPTY_DRAFT: Draft = {
  goal: 'lose_weight',
  sex: 'male',
  age: '',
  heightCm: '',
  weightKg: '',
  targetKg: '',
  level: 'beginner',
  daysPerWeek: 3,
  minutesPerSession: 20,
  limits: [],
  notes: '',
};

export function toDraft(p: CoachProfile | null): Draft {
  if (!p) return EMPTY_DRAFT;
  return {
    ...p,
    age: String(p.age),
    heightCm: String(p.heightCm),
    weightKg: String(p.weightKg),
    targetKg: p.targetKg ? String(p.targetKg) : '',
  };
}

export function toProfile(d: Draft): CoachProfile {
  const n = (s: string) => (s.trim() === '' ? NaN : Number(s.replace(',', '.')));
  return {
    ...d,
    age: n(d.age),
    heightCm: n(d.heightCm),
    weightKg: n(d.weightKg),
    targetKg: d.targetKg.trim() ? n(d.targetKg) : undefined,
    notes: d.notes.trim(),
  };
}

export const GOAL_ICON: Record<Goal, IconName> = {
  lose_weight: 'flame',
  build_muscle: 'dumbbell',
  tone: 'zap',
  endurance: 'heart',
  health: 'leaf',
};

export function bmiInfo(v: number): { label: string; tone: 'good' | 'warn' | 'bad'; text: string } {
  if (v < 18.5)
    return { label: 'Ниже нормы', tone: 'warn', text: 'Вес ниже нормы — упор на силу, без жёсткого кардио.' };
  if (v < 25) return { label: 'Норма', tone: 'good', text: 'У тебя нормальный вес для твоего роста.' };
  if (v < 30)
    return {
      label: 'Выше нормы',
      tone: 'warn',
      text: 'Чуть выше нормы — добавим кардио, бережно к суставам.',
    };
  return { label: 'Ожирение', tone: 'bad', text: 'Начнём бережно: без прыжков, пока не окрепнут суставы.' };
}

export function plural(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}
