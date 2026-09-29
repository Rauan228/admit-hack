// Общее описание упражнения: чем его мерить, какие суставы нужны, какие пороги у счётчика.
// Упражнение = измеритель (кадр → метрики и прогресс) + пороги автомата + правила ошибок.

import type { PoseFrame } from '../geometry';
import type { RuleDef } from '../rules';
import type { ExerciseId, Phase, Side } from '../types';
import type { FsmThresholds } from './fsm';

export interface BaseMetrics {
  /** 0 — исходное положение, 1 — полная амплитуда, больше 1 — ещё глубже/выше. */
  progress: number;
}

export interface ExerciseMeter<M extends BaseMetrics> {
  /**
   * Метрики кадра или null, если нужные суставы не видны.
   * phase — текущая фаза счётчика: в исходном положении измеритель обновляет эталон «стоя».
   */
  measure(frame: PoseFrame, phase: Phase): M | null;
  reset(): void;
}

export interface ExerciseDef<M extends BaseMetrics = BaseMetrics> {
  id: ExerciseId;
  /** Суставы, без которых упражнение не измерить: пропали — пауза и подсказка вернуться в кадр. */
  requiredJoints: readonly number[];
  /** Руки над головой — часть упражнения: жест «обе руки вверх» на подходе отключается. */
  armsOverhead: boolean;
  fsm: FsmThresholds;
  createMeter(): ExerciseMeter<M>;
  /** Правила ошибок: код из каталога hints.ts + проверка. Текст, суставы, фазы, важность — из каталога. */
  rules: readonly RuleDef<M>[];
  /**
   * Упражнение на две стороны: какая сторона работала в этом движении (по метрикам нижней точки).
   * Если задано, повтор засчитывается парой — левая + правая сторона; одна сторона — событие half_rep.
   */
  sideOf?(bottom: M): Side | null;
}
