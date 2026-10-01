// Превью упражнения — 3D-атлет в самой узнаваемой позе (один кадр). Общее для выбора упражнения и ИИ-плана.

import type { ExerciseId } from '../../engine/types';
import { hasRecordedMotion } from '../lib/athlete';
import { ICON_PHASE, LYING } from '../lib/thumb';
import { Ghost } from './Ghost';

/** Холст на всю рамку-родителя (position: relative; overflow: hidden). zoom — крупнее для стоячих упражнений. */
export function ExerciseThumb({ exercise, className = '' }: { exercise: ExerciseId; className?: string }) {
  const zoom = hasRecordedMotion(exercise) && !LYING.has(exercise);
  return (
    <Ghost
      exercise={exercise}
      still
      phase={ICON_PHASE[exercise] ?? 0.3}
      className={`thumb ${zoom ? 'thumb--zoom' : ''} ${className}`}
    />
  );
}
