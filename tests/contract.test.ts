import { createExercise } from '../src/engine/exercises';
import { EXERCISES, type EngineEvent } from '../src/engine/types';

describe('engine contract', () => {
  it('lists all exercises from PLAN §3', () => {
    expect(EXERCISES).toEqual([
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
    ]);
  });

  it('у каждого упражнения из контракта есть распознавание (реестр не пропустил ни одного)', () => {
    for (const ex of EXERCISES) expect(createExercise(ex), ex).not.toBeNull();
  });

  it('form_error carries a concrete hint and joints', () => {
    const e: EngineEvent = {
      type: 'form_error',
      exercise: 'squat',
      code: 'knees_in',
      message: 'Разведи колени наружу, по линии носков',
      joints: [25, 26],
      arrow: 'out',
      severity: 'bad',
    };
    expect(e.message.length).toBeGreaterThan(10);
  });
});
