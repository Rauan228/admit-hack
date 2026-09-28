import { BOTH_HANDS_UP, body, buildPose, easeInOut, lerpBody, pointingBody } from '../src/mocks/poses';
import { LM } from '../src/engine/hints';

const at = (pose: ReturnType<typeof buildPose>, i: number) => {
  const p = pose[i];
  if (!p) throw new Error(`нет точки ${i}`);
  return p;
};

describe('синтетические позы мока', () => {
  it('отдаёт 33 точки в пределах кадра', () => {
    const pose = buildPose(body());
    expect(pose).toHaveLength(33);
    for (const p of pose) {
      expect(p.x).toBeGreaterThan(-0.2);
      expect(p.x).toBeLessThan(1.2);
      expect(p.y).toBeGreaterThan(-0.2);
      expect(p.y).toBeLessThan(1.2);
      expect(p.v).toBeGreaterThan(0.5);
    }
  });

  it('в приседе таз ниже, чем стоя, а стопы на месте', () => {
    const up = buildPose(body({ squat: 0 }));
    const down = buildPose(body({ squat: 1 }));
    expect(at(down, LM.leftHip).y).toBeGreaterThan(at(up, LM.leftHip).y);
    expect(at(down, LM.leftAnkle).y).toBeCloseTo(at(up, LM.leftAnkle).y, 5);
    // Бедро ниже параллели: таз опускается ниже уровня колена «стоя».
    expect(at(down, LM.leftHip).y).toBeGreaterThan(at(up, LM.leftKnee).y * 0.9);
  });

  it('колени внутрь сближают точки колен', () => {
    const okStance = buildPose(body({ squat: 0.9, kneeIn: 0 }));
    const bad = buildPose(body({ squat: 0.9, kneeIn: 1 }));
    const width = (p: ReturnType<typeof buildPose>) => Math.abs(at(p, LM.leftKnee).x - at(p, LM.rightKnee).x);
    expect(width(bad)).toBeLessThan(width(okStance));
  });

  it('обе руки вверх поднимают запястья выше носа', () => {
    const pose = buildPose(BOTH_HANDS_UP);
    expect(at(pose, LM.leftWrist).y).toBeLessThan(at(pose, LM.nose).y);
    expect(at(pose, LM.rightWrist).y).toBeLessThan(at(pose, LM.nose).y);
  });

  it('указывающая рука поднимается выше плеча', () => {
    const pose = buildPose(pointingBody(0.7, 0.3, 'left'));
    expect(at(pose, LM.leftWrist).y).toBeLessThan(at(pose, LM.leftShoulder).y);
  });

  it('интерполяция и сглаживание не выходят за границы', () => {
    const mid = lerpBody(body({ squat: 0 }), body({ squat: 1 }), 0.5);
    expect(mid.squat).toBeCloseTo(0.5, 6);
    expect(lerpBody(body(), body({ squat: 1 }), 5).squat).toBe(1);
    expect(easeInOut(0)).toBe(0);
    expect(easeInOut(1)).toBe(1);
    expect(easeInOut(0.5)).toBeCloseTo(0.5, 6);
  });
});
