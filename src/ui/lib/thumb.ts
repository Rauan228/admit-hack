// Превью упражнений: какую позу показывать и какие фигуры не увеличивать.

/** Упор лёжа и бёрпи: фигура вытянута по горизонтали — в превью не увеличиваем, иначе обрежется. */
export const LYING = new Set<string>(['push_up', 'plank', 'burpee']);

/** Самая узнаваемая поза каждого упражнения для превью (доля цикла). */
export const ICON_PHASE: Partial<Record<string, number>> = {
  squat: 0.5,
  lunge: 0.19,
  side_lunge: 0.25,
  jump_squat: 0.4,
  calf_raise: 0.4,
  side_leg_raise: 0.25,
  jumping_jack: 0.26,
  cross_jack: 0.2,
  high_knees: 0.25,
  burpee: 0.5,
  boxing: 0.08,
  arm_raise: 0.26,
  arm_circles: 0.5,
  squat_press: 0.64,
  side_bend: 0.27,
  knee_to_elbow: 0.23,
  push_up: 0.3,
  plank: 0.5,
  pull_up: 0.5,
};
