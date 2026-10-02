// Контракт движок ↔ UI. Источник правды: brain/PLAN.md §4.
// Меняем только по согласованию обоих разработчиков.

export type ExerciseId =
  | 'squat'
  | 'jumping_jack'
  | 'lunge'
  | 'arm_raise'
  | 'high_knees'
  | 'knee_to_elbow'
  | 'squat_press'
  | 'side_bend'
  | 'side_leg_raise'
  | 'side_lunge'
  | 'jump_squat'
  | 'calf_raise'
  | 'cross_jack'
  | 'arm_circles'
  | 'boxing'
  | 'push_up'
  | 'plank'
  | 'burpee'
  | 'pull_up';
export type Joint = number; // индекс точки MediaPipe (0..32)

export interface Landmark {
  x: number;
  y: number;
  z: number;
  v: number; // visibility 0..1
}

export type CalibrationStatus = 'no_person' | 'partial' | 'too_close' | 'too_far' | 'dark' | 'ok';
export type Phase = 'start' | 'down' | 'bottom' | 'up';
export type Arrow = 'up' | 'down' | 'left' | 'right' | 'out' | 'in';
export type Severity = 'warn' | 'bad';
export type Side = 'left' | 'right';

export type EngineEvent =
  | {
      type: 'frame';
      landmarks: Landmark[];
      fps: number;
      /**
       * Кадр камеры, на котором посчитаны эти точки (E-23). Рисуй его вместо живого видео — скелет совпадёт
       * с телом кадр в кадр. Действителен до следующего frame. Нет в моке и там, где снимок недоступен.
       */
      image?: CanvasImageSource;
    }
  | { type: 'calibration'; status: CalibrationStatus; hint: string }
  | { type: 'pointer'; x: number; y: number; hand: 'left' | 'right' }
  | { type: 'pointer_lost' }
  | { type: 'gesture'; name: 'both_hands_up' }
  | { type: 'phase'; exercise: ExerciseId; phase: Phase }
  | { type: 'rep'; exercise: ExerciseId; count: number; score: number; errors: string[] }
  /**
   * Упражнения на две стороны (выпады): одна сторона сделана. Повтор (rep) — только когда сделаны обе:
   * правая нога вперёд + левая нога вперёд = 1 повтор. errors — ошибки этой половины.
   */
  | { type: 'half_rep'; exercise: ExerciseId; side: Side; errors: string[] }
  | {
      type: 'form_error';
      exercise: ExerciseId;
      code: string;
      message: string;
      joints: Joint[];
      arrow?: Arrow;
      severity: Severity;
    }
  | { type: 'form_ok'; exercise: ExerciseId }
  | { type: 'set_complete'; exercise: ExerciseId; stats: SetStats };

export interface SetStats {
  reps: number;
  cleanReps: number;
  avgScore: number;
  durationSec: number;
  errorCounts: Record<string, number>;
  perRep: number[];
}

export type EngineMode = 'calibration' | 'menu' | { exercise: ExerciseId; targetReps: number };

export interface Engine {
  start(video: HTMLVideoElement): Promise<void>;
  stop(): void;
  setMode(mode: EngineMode): void;
  on(cb: (e: EngineEvent) => void): () => void;
}

export const EXERCISES: readonly ExerciseId[] = [
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
  'pull_up',
];
