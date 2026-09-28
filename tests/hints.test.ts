import { CALIBRATION_HINTS, FORM_ERRORS, findFormError } from '../src/engine/hints';
import { EXERCISES } from '../src/engine/types';

describe('каталог подсказок (PLAN §3)', () => {
  it('у каждого упражнения есть свои ошибки', () => {
    for (const ex of EXERCISES) {
      expect(FORM_ERRORS[ex].length).toBeGreaterThanOrEqual(2);
    }
    // Твист на 20 баллов: 12+ конкретных ошибок.
    const total = EXERCISES.reduce((n, ex) => n + FORM_ERRORS[ex].length, 0);
    expect(total).toBeGreaterThanOrEqual(12);
  });

  it('каждая подсказка конкретная, на русском, с суставами и фазой', () => {
    for (const ex of EXERCISES) {
      for (const def of FORM_ERRORS[ex]) {
        expect(def.message).toMatch(/[а-яё]/i);
        expect(def.message).not.toMatch(/не распознан/i);
        expect(def.message.length).toBeGreaterThan(10);
        expect(def.joints.length).toBeGreaterThan(0);
        expect(def.phases.length).toBeGreaterThan(0);
        expect(def.penalty).toBeGreaterThan(0);
      }
    }
  });

  it('коды ошибок внутри упражнения уникальны, приоритеты не совпадают', () => {
    for (const ex of EXERCISES) {
      const codes = FORM_ERRORS[ex].map((e) => e.code);
      expect(new Set(codes).size).toBe(codes.length);
      const prios = FORM_ERRORS[ex].map((e) => e.priority);
      expect(new Set(prios).size).toBe(prios.length);
    }
  });

  it('ошибку можно найти по коду', () => {
    expect(findFormError('squat', 'knees_in')?.message).toBe('Разведи колени наружу, по линии носков');
    expect(findFormError('squat', 'nope')).toBeUndefined();
  });

  it('на каждый статус калибровки есть текст', () => {
    for (const hint of Object.values(CALIBRATION_HINTS)) {
      expect(hint.length).toBeGreaterThan(5);
    }
  });
});
