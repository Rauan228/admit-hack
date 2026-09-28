import { meanLuma } from '../src/engine/brightness';
import { assessCalibration, assessPresence, CalibrationTracker } from '../src/engine/calibration';
import type { PoseFrame } from '../src/engine/geometry';
import { CALIBRATION_DETAIL_HINTS, CALIBRATION_HINTS, LM } from '../src/engine/hints';
import type { Landmark } from '../src/engine/types';
import { body, buildPose, type BodyParams } from '../src/mocks/poses';

const frameOf = (params: Partial<BodyParams> = {}, edit?: (pts: Landmark[]) => void): PoseFrame => {
  const image = buildPose(body(params));
  edit?.(image);
  return { t: 0, aspect: 4 / 3, image, world: null };
};

describe('калибровка: мгновенная оценка кадра', () => {
  it('человек целиком, в центре, лицом к камере — ok', () => {
    expect(assessCalibration(frameOf(), 120)).toEqual({ status: 'ok', hint: CALIBRATION_HINTS.ok });
  });

  it('никого нет — no_person; никого в полутьме — dark', () => {
    expect(assessCalibration(null, 120).status).toBe('no_person');
    expect(assessCalibration(null, null).status).toBe('no_person');
    expect(assessCalibration(null, 55).status).toBe('dark');
  });

  it('совсем темно — dark, даже если модель кого-то нашла', () => {
    expect(assessCalibration(frameOf(), 25)).toEqual({ status: 'dark', hint: CALIBRATION_HINTS.dark });
  });

  it('полутьма и модель плохо видит суставы — dark', () => {
    expect(assessCalibration(frameOf({ visibility: 0.52, legVisibility: 0.52 }), 60).status).toBe('dark');
    // Та же полутьма, но видно хорошо — это не повод мешать человеку.
    expect(assessCalibration(frameOf(), 60).status).toBe('ok');
  });

  it('человек маленький в кадре — too_far', () => {
    expect(assessCalibration(frameOf({ height: 0.4, groundY: 0.7 }), 120).status).toBe('too_far');
  });

  it('человек занимает весь кадр — too_close', () => {
    expect(assessCalibration(frameOf({ height: 1.1, groundY: 0.99 }), 120).status).toBe('too_close');
  });

  it('ноги за нижним краем и корпус огромный — too_close с подсказкой про ноги', () => {
    expect(assessCalibration(frameOf({ height: 1.05, groundY: 1.08, legVisibility: 0.6 }), 120)).toEqual({
      status: 'too_close',
      hint: CALIBRATION_DETAIL_HINTS.showLegs,
    });
  });

  it('ноги за нижним краем, а корпус обычный (камера смотрит вверх) — partial с подсказкой про ноги', () => {
    expect(assessCalibration(frameOf({ height: 0.8, groundY: 1.25 }), 120)).toEqual({
      status: 'partial',
      hint: CALIBRATION_DETAIL_HINTS.showLegs,
    });
  });

  it('голова за верхним краем — too_close с подсказкой про голову', () => {
    const f = frameOf({}, (pts) => {
      pts[LM.nose] = { ...(pts[LM.nose] as Landmark), y: -0.05, v: 0.2 };
    });
    expect(assessCalibration(f, 120)).toEqual({
      status: 'too_close',
      hint: CALIBRATION_DETAIL_HINTS.showHead,
    });
  });

  it('стоит спиной: лицо в кадре, но не видно — «повернись лицом», а не «голова не помещается»', () => {
    const f = frameOf({}, (pts) => {
      pts[LM.nose] = { ...(pts[LM.nose] as Landmark), v: 0.1 };
    });
    expect(assessCalibration(f, 120)).toEqual({
      status: 'partial',
      hint: CALIBRATION_DETAIL_HINTS.faceCamera,
    });
  });

  it('у бокового края, плечо вышло за кадр — partial «встань в центр», а не «слишком близко»', () => {
    const v = assessCalibration(frameOf({ centerX: 0.04 }), 120);
    expect(v).toEqual({ status: 'partial', hint: CALIBRATION_DETAIL_HINTS.center });
  });

  it('у края, но весь в кадре — всё равно просим встать в центр', () => {
    expect(assessCalibration(frameOf({ centerX: 0.12 }), 120).hint).toBe(CALIBRATION_DETAIL_HINTS.center);
  });

  it('лицо вплотную к камере, корпуса нет — too_close', () => {
    const f = frameOf({}, (pts) => {
      for (const i of [LM.leftShoulder, LM.rightShoulder, LM.leftHip, LM.rightHip]) {
        pts[i] = { ...(pts[i] as Landmark), y: 1.3, v: 0.1 };
      }
    });
    expect(assessCalibration(f, 120).status).toBe('too_close');
  });

  it('стоит боком — partial «повернись лицом»', () => {
    const f = frameOf({}, (pts) => {
      const cx = ((pts[LM.leftShoulder] as Landmark).x + (pts[LM.rightShoulder] as Landmark).x) / 2;
      pts[LM.leftShoulder] = { ...(pts[LM.leftShoulder] as Landmark), x: cx + 0.01 };
      pts[LM.rightShoulder] = { ...(pts[LM.rightShoulder] as Landmark), x: cx - 0.01 };
    });
    expect(assessCalibration(f, 120)).toEqual({
      status: 'partial',
      hint: CALIBRATION_DETAIL_HINTS.faceCamera,
    });
  });

  it('без замера яркости (null) калибровка всё равно работает', () => {
    expect(assessCalibration(frameOf(), null).status).toBe('ok');
  });

  it('у каждого статуса своя подсказка на русском', () => {
    for (const hint of [...Object.values(CALIBRATION_HINTS), ...Object.values(CALIBRATION_DETAIL_HINTS)]) {
      expect(hint).toMatch(/[а-яё]/i);
      expect(hint).not.toMatch(/не распознано/i);
    }
  });
});

describe('присутствие во время тренировки', () => {
  const legs = [LM.leftKnee, LM.rightKnee, LM.leftAnkle, LM.rightAnkle];

  it('никого — no_person, нужные суставы не видны — partial, иначе ok', () => {
    expect(assessPresence(null, legs).status).toBe('no_person');
    expect(assessPresence(frameOf({ legVisibility: 0.2 }), legs).status).toBe('partial');
    expect(assessPresence(frameOf(), legs).status).toBe('ok');
  });

  it('человек, который присел и стал «меньше», — всё равно ok (размер не проверяем)', () => {
    expect(assessPresence(frameOf({ squat: 1, height: 0.5, groundY: 0.8 }), legs).status).toBe('ok');
  });

  it('руки над головой вышли за верхний край — не повод прерывать приседания', () => {
    const f = frameOf({ armL: 175, armR: 175, height: 0.9, groundY: 0.97 }, (pts) => {
      for (const i of [LM.leftWrist, LM.rightWrist]) pts[i] = { ...(pts[i] as Landmark), y: -0.05, v: 0.3 };
    });
    expect(assessPresence(f, legs).status).toBe('ok');
  });
});

describe('антидребезг статуса', () => {
  const ok = { status: 'ok' as const, hint: CALIBRATION_HINTS.ok };
  const far = { status: 'too_far' as const, hint: CALIBRATION_HINTS.too_far };

  it('первый статус принимается сразу', () => {
    const t = new CalibrationTracker();
    expect(t.update(far, 0)).toEqual(far);
  });

  it('короткое мигание другого статуса не проходит', () => {
    const t = new CalibrationTracker();
    t.update(ok, 0);
    expect(t.update(far, 100)).toBeNull();
    expect(t.update(far, 300)).toBeNull();
    expect(t.update(ok, 350)).toBeNull();
    expect(t.current).toEqual(ok);
  });

  it('устойчивая смена проходит после выдержки', () => {
    const t = new CalibrationTracker();
    t.update(ok, 0);
    let got = null;
    for (let ms = 100; ms <= 1000 && !got; ms += 33) got = t.update(far, ms);
    expect(got).toEqual(far);
    expect(t.current).toEqual(far);
  });

  it('смена подсказки внутри того же статуса — тоже событие', () => {
    const t = new CalibrationTracker({ no_person: 0, partial: 0, too_close: 0, too_far: 0, dark: 0, ok: 0 });
    t.update({ status: 'partial', hint: CALIBRATION_DETAIL_HINTS.center }, 0);
    expect(t.update({ status: 'partial', hint: CALIBRATION_DETAIL_HINTS.showLegs }, 10)?.hint).toBe(
      CALIBRATION_DETAIL_HINTS.showLegs,
    );
  });

  it('reset забывает статус', () => {
    const t = new CalibrationTracker();
    t.update(ok, 0);
    t.reset();
    expect(t.current).toBeNull();
    expect(t.update(far, 10)).toEqual(far);
  });
});

describe('яркость кадра', () => {
  it('чёрный — 0, белый — 255, зелёный ярче синего', () => {
    expect(meanLuma([0, 0, 0, 255, 0, 0, 0, 255])).toBe(0);
    expect(meanLuma([255, 255, 255, 255])).toBeCloseTo(255);
    expect(meanLuma([0, 255, 0, 255])).toBeGreaterThan(meanLuma([0, 0, 255, 255]));
    expect(meanLuma([])).toBe(0);
  });
});
