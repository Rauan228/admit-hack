// Что Stage рисует поверх видео, кроме самого скелета. Экраны пишут сюда, canvas читает каждый кадр.

import type { Arrow, EngineEvent, Severity } from '../../engine/types';

export const overlay = {
  /** Затемнение видео 0..1: меню темнее, тренировка светлее. */
  dim: 0.55,
  /** Прозрачность скелета 0..1. */
  skeleton: 0.9,
  errorJoints: new Set<number>(),
  errorArrow: undefined as Arrow | undefined,
  errorSeverity: 'bad' as Severity,
  errorAt: 0,
  flashAt: 0,
  flashClean: true,
};

/** Сколько живёт подсветка ошибки на скелете, мс. */
export const ERROR_TTL_MS = 2600;

export function showFormError(e: Extract<EngineEvent, { type: 'form_error' }>): void {
  overlay.errorJoints = new Set(e.joints);
  overlay.errorArrow = e.arrow;
  overlay.errorSeverity = e.severity;
  overlay.errorAt = performance.now();
}

export function clearFormError(): void {
  overlay.errorJoints = new Set();
  overlay.errorArrow = undefined;
  overlay.errorAt = 0;
}

export function flashRep(clean: boolean): void {
  overlay.flashAt = performance.now();
  overlay.flashClean = clean;
}

export function setScene(dim: number, skeleton = 0.9): void {
  overlay.dim = dim;
  overlay.skeleton = skeleton;
}
