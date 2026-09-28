import { AdaptivePerf, isMobileDevice } from '../src/engine/perf';

const nav = (ua: string, mobile?: boolean) =>
  ({ userAgent: ua, ...(mobile === undefined ? {} : { userAgentData: { mobile } }) }) as unknown as Navigator;

describe('телефон или компьютер', () => {
  it('по userAgentData, если он есть', () => {
    expect(isMobileDevice(nav('whatever', true))).toBe(true);
    expect(isMobileDevice(nav('Android', false))).toBe(false);
  });

  it('по строке userAgent: Android, iPhone — телефон; Windows — нет', () => {
    expect(isMobileDevice(nav('Mozilla/5.0 (Linux; Android 13; SM-A536B) Mobile Safari/537.36'))).toBe(true);
    expect(isMobileDevice(nav('Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X)'))).toBe(true);
    expect(isMobileDevice(nav('Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/129.0'))).toBe(false);
    expect(isMobileDevice(undefined)).toBe(false);
  });
});

/** Прогон: кадры каждые 33 мс, детекция длится ms(i). */
function feed(perf: AdaptivePerf, n: number, ms: (i: number) => number) {
  const out: { t: number; decision: string | null; processed: boolean }[] = [];
  for (let i = 0; i < n; i++) {
    const t = i * 33;
    const processed = perf.shouldProcess(t);
    out.push({ t, processed, decision: processed ? perf.record(t, ms(i)) : null });
  }
  return out;
}

describe('адаптация под слабое устройство', () => {
  it('быстрое устройство (15 мс) — ни смены модели, ни троттлинга', () => {
    const perf = new AdaptivePerf();
    const run = feed(perf, 300, () => 15);
    expect(run.some((r) => r.decision)).toBe(false);
    expect(perf.isThrottling).toBe(false);
    expect(perf.detectMs).toBeCloseTo(15);
  });

  it('один медленный кадр (прогрев GPU 800 мс) не переключает модель', () => {
    const perf = new AdaptivePerf();
    const run = feed(perf, 300, (i) => (i === 0 ? 800 : 15));
    expect(run.some((r) => r.decision)).toBe(false);
  });

  it('устойчиво медленно (60 мс) — один раз просим лёгкую модель, через ~2 с после прогрева', () => {
    const perf = new AdaptivePerf();
    const run = feed(perf, 300, () => 60);
    const asks = run.filter((r) => r.decision === 'downgrade');
    expect(asks).toHaveLength(1);
    expect(asks[0]!.t).toBeGreaterThanOrEqual(2000);
    expect(perf.isThrottling).toBe(false);
  });

  it('совсем медленно (90 мс) — обрабатываем не чаще ~15 кадров в секунду', () => {
    const perf = new AdaptivePerf();
    const run = feed(perf, 600, () => 90);
    expect(perf.isThrottling).toBe(true);
    const late = run.filter((r) => r.processed && r.t > 5000);
    const gaps = late.slice(1).map((r, i) => r.t - late[i]!.t);
    expect(Math.min(...gaps)).toBeGreaterThanOrEqual(65);
  });

  it('после смены модели меряем заново и троттлинг снимается, если стало быстро', () => {
    const perf = new AdaptivePerf();
    feed(perf, 300, () => 90);
    perf.resetMeasurements();
    feed(perf, 100, () => 20);
    expect(perf.isThrottling).toBe(false);
  });
});
