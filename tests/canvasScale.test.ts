import { RENDER_MAX_SIDE, canvasScale, wantsLiteModel } from '../src/engine/perf';

const withDpr = (dpr: number, fn: () => void) => {
  const g = globalThis as { devicePixelRatio?: number };
  const was = g.devicePixelRatio;
  g.devicePixelRatio = dpr;
  try {
    fn();
  } finally {
    g.devicePixelRatio = was;
  }
};

describe('чёткость холстов 3D', () => {
  it('телефон 3×: небольшой холст — в плотности экрана (до 2,5×), а не 1×', () => {
    withDpr(3, () => expect(canvasScale(300, 300, true)).toBe(2.5));
  });

  it('большой холст на телефоне — по бюджету пикселей', () => {
    withDpr(3, () => {
      const s = canvasScale(1000, 800, true);
      expect(1000 * 800 * s * s).toBeLessThanOrEqual(2_200_000 + 1);
      expect(s).toBeGreaterThan(1.5);
    });
  });

  it('увеличение страницы на компьютере поднимает чёткость; холст не больше общего буфера', () => {
    withDpr(2, () => expect(canvasScale(400, 300, false)).toBe(2));
    withDpr(3, () =>
      expect(canvasScale(1400, 500, false) * 1400).toBeLessThanOrEqual(RENDER_MAX_SIDE + 1e-6),
    );
  });

  it('облегчённая модель — только слабым устройствам', () => {
    const nav = (o: object) => o as Navigator;
    expect(wantsLiteModel(nav({ deviceMemory: 2, hardwareConcurrency: 8 }))).toBe(true);
    expect(wantsLiteModel(nav({ hardwareConcurrency: 2 }))).toBe(true);
    expect(wantsLiteModel(nav({ deviceMemory: 8, hardwareConcurrency: 8 }))).toBe(false);
    expect(wantsLiteModel(nav({ hardwareConcurrency: 6 }))).toBe(false);
  });
});

describe('чёткость анимированных холстов', () => {
  it('анимация на телефоне — до 1,75× и меньший бюджет, превью — до 2,5×', () => {
    withDpr(3, () => {
      expect(canvasScale(300, 300, true, undefined, true)).toBe(1.75);
      const s = canvasScale(900, 700, true, undefined, true);
      expect(900 * 700 * s * s).toBeLessThanOrEqual(1_200_000 + 1);
    });
  });
});
