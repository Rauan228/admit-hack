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
    ]);
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
