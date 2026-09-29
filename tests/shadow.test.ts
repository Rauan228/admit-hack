import { darkLuma, gammaTable, liftGamma } from '../src/engine/shadow';

describe('подсветка теней перед моделью', () => {
  it('когда подсвечивать: силуэт против света и тёмный кадр — да; тёмная одежда при нормальном свете — нет', () => {
    // Замеры на реальных роликах: силуэт против неба — тело 0,07 при кадре 0,41.
    expect(darkLuma(0.07, 0.41)).toBe(0.07);
    // Тёмная одежда в нормальном зале — тело 0,21–0,28 при кадре 0,27: не контровой свет.
    expect(darkLuma(0.22, 0.27)).toBeNull();
    expect(darkLuma(0.35, 0.34)).toBeNull();
    // Весь кадр тёмный — подсвечиваем и без силуэта.
    expect(darkLuma(0.15, 0.15)).toBe(0.15);
    expect(darkLuma(null, 0.1)).toBe(0.1);
  });

  it('нормальная яркость — гамма 1', () => {
    expect(liftGamma(0.5)).toBe(1);
    expect(liftGamma(0.45)).toBe(1);
  });

  it('человек в тени — поднимаем тени, и тем сильнее, чем он темнее', () => {
    const dim = liftGamma(0.25);
    const dark = liftGamma(0.1);
    expect(dim).toBeLessThan(1);
    expect(dark).toBeLessThan(dim);
    // Средняя яркость человека после подсветки — около цели 0,45.
    expect(Math.pow(0.25, dim)).toBeCloseTo(0.45, 2);
  });

  it('совсем тёмный кадр — не сильнее предела (шум камеры не превращаем в «детали»)', () => {
    expect(liftGamma(0.02)).toBe(0.45);
    expect(liftGamma(0)).toBe(1);
    expect(liftGamma(NaN)).toBe(1);
  });

  it('таблица гаммы: чёрное и белое на месте, тени поднимаются, порядок яркостей сохраняется', () => {
    const t = gammaTable(0.6);
    expect(t[0]).toBe(0);
    expect(t[255]).toBe(255);
    expect(t[40]).toBeGreaterThan(40);
    for (let i = 1; i < 256; i++) expect(t[i]).toBeGreaterThanOrEqual(t[i - 1] as number);
  });
});
