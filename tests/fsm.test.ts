import { RepCounter, type FsmEvent, type FsmThresholds } from '../src/engine/exercises/fsm';

const TH: FsmThresholds = {
  startMax: 0.15,
  downMin: 0.25,
  bottomMin: 0.9,
  repMin: 0.45,
  attemptMin: 0.3,
  reversal: 0.12,
  maxRepMs: 12000,
  minRepMs: 250,
  returnHoldMs: 0,
};

/** Прогон значений p с шагом 33 мс. */
function feed(ps: number[], th = TH): FsmEvent[] {
  const c = new RepCounter(th);
  return ps.flatMap((p, i) => c.update(p, i * 33));
}
const ramp = (a: number, b: number, n: number) =>
  Array.from({ length: n }, (_, i) => a + ((b - a) * i) / (n - 1));
const rep = (depth: number) => [...ramp(0, depth, 20), ...ramp(depth, 0, 20), 0, 0, 0];
const kinds = (ev: FsmEvent[], kind: FsmEvent['kind']) => ev.filter((e) => e.kind === kind);
const phases = (ev: FsmEvent[]) => ev.flatMap((e) => (e.kind === 'phase' ? [e.phase] : []));

describe('счётчик повторений', () => {
  it('полное повторение: фазы down → bottom → up → start и один rep', () => {
    const ev = feed(rep(1.2));
    expect(phases(ev)).toEqual(['down', 'bottom', 'up', 'start']);
    expect(kinds(ev, 'rep')).toHaveLength(1);
  });

  it('неполная амплитуда выше repMin — повтор засчитан, bottom в момент разворота', () => {
    const ev = feed(rep(0.6));
    expect(phases(ev)).toEqual(['down', 'bottom', 'up', 'start']);
    const r = kinds(ev, 'rep')[0];
    expect(r?.kind === 'rep' && r.summary.pMax).toBeCloseTo(0.6, 1);
  });

  it('мелкая попытка — не повтор, но attempt (чтобы сказать «глубже», а не молчать)', () => {
    const ev = feed(rep(0.38));
    expect(kinds(ev, 'rep')).toHaveLength(0);
    expect(kinds(ev, 'attempt')).toHaveLength(1);
    expect(phases(ev)).toEqual(['down', 'start']);
  });

  it('совсем мелкое покачивание — ни повтора, ни попытки', () => {
    const ev = feed(rep(0.27));
    expect(kinds(ev, 'rep')).toHaveLength(0);
    expect(kinds(ev, 'attempt')).toHaveLength(0);
  });

  it('10 повторов подряд = 10', () => {
    const ev = feed(Array.from({ length: 10 }, () => rep(1.1)).flat());
    expect(kinds(ev, 'rep')).toHaveLength(10);
  });

  it('дрожание сигнала у порогов не даёт лишних повторов', () => {
    // Человек стоит, сигнал дрожит вокруг downMin и startMax.
    const noisy = Array.from({ length: 300 }, (_, i) => 0.2 + 0.08 * Math.sin(i * 1.7));
    expect(kinds(feed(noisy), 'rep')).toHaveLength(0);
  });

  it('дрожание в нижней точке не превращается в несколько повторов', () => {
    const bottom = Array.from({ length: 60 }, (_, i) => 1.1 + 0.06 * Math.sin(i * 2.3));
    const ev = feed([...ramp(0, 1.1, 20), ...bottom, ...ramp(1.1, 0, 20), 0]);
    expect(kinds(ev, 'rep')).toHaveLength(1);
  });

  it('«отскок» внизу — тот же повтор, а не второй', () => {
    const ev = feed([
      ...ramp(0, 1.2, 20),
      ...ramp(1.2, 0.7, 10),
      ...ramp(0.7, 1.2, 10),
      ...ramp(1.2, 0, 20),
      0,
    ]);
    expect(kinds(ev, 'rep')).toHaveLength(1);
    expect(phases(ev)).toEqual(['down', 'bottom', 'up', 'bottom', 'up', 'start']);
  });

  it('покачивание на подъёме фазу не дёргает', () => {
    const ev = feed([
      ...ramp(0, 1.2, 20),
      ...ramp(1.2, 0.6, 10),
      ...ramp(0.6, 0.75, 5),
      ...ramp(0.75, 0, 15),
      0,
    ]);
    expect(phases(ev)).toEqual(['down', 'bottom', 'up', 'start']);
  });

  it('движение дольше maxRepMs сбрасывается без засчёта', () => {
    const c = new RepCounter(TH);
    c.update(0, 0);
    c.update(1.2, 100);
    const ev = c.update(1.2, 13000);
    expect(kinds(ev, 'timeout')).toHaveLength(1);
    expect(c.phase).toBe('start');
    expect(kinds(c.update(0, 13100), 'rep')).toHaveLength(0);
  });

  it('summary: длительность и время нижней точки', () => {
    const ev = feed(rep(1.2));
    const r = kinds(ev, 'rep')[0];
    if (r?.kind !== 'rep') throw new Error('нет повтора');
    expect(r.summary.durationMs).toBeGreaterThan(900);
    expect(r.summary.bottomT).toBeGreaterThan(r.summary.startT);
    expect(r.summary.endT).toBeGreaterThan(r.summary.bottomT);
  });

  it('выброс детектора на 3 кадра (0,1 с) — не повтор и не попытка', () => {
    const ev = feed([0, 0, 0, 1.4, 0.8, 0, 0, 0]);
    expect(kinds(ev, 'rep')).toHaveLength(0);
    expect(kinds(ev, 'attempt')).toHaveLength(0);
  });

  it('короткий провал на подъёме не закрывает повтор, если ждём подтверждения возврата', () => {
    const th = { ...TH, returnHoldMs: 150 };
    // Внизу на 2 кадра сигнал «провалился» к нулю и вернулся — это один повтор, а не два.
    const ev = feed(
      [...ramp(0, 1.2, 20), 1.2, 0.05, 0.05, 1.2, 1.2, ...ramp(1.2, 0, 20), 0, 0, 0, 0, 0, 0],
      th,
    );
    expect(kinds(ev, 'rep')).toHaveLength(1);
  });

  it('15 FPS: три кадра в исходном положении подтверждают возврат (кадр длится 67 мс, а не миг)', () => {
    const th = { ...TH, returnHoldMs: 150 };
    // Наклоны в ритм: «прямо» между повторами — три кадра, ~200 мс. По меткам кадров это 134 мс < 150,
    // и два повтора сливались в один.
    const one = [...ramp(0.3, 1.2, 8), ...ramp(1.2, 0.3, 8), 0.05, 0.05, 0.05];
    const c = new RepCounter(th);
    const ev = [...one, ...one].flatMap((p, i) => c.update(p, i * 67));
    expect(kinds(ev, 'rep')).toHaveLength(2);
    // А после провала кадров один кадр внизу подтверждением не считается.
    const g = new RepCounter(th);
    const gap = [...ramp(0.3, 1.2, 8), ...ramp(1.2, 0.3, 8)].flatMap((p, i) => g.update(p, i * 67));
    expect(kinds([...gap, ...g.update(0.05, 15 * 67 + 400)], 'rep')).toHaveLength(0);
  });

  it('NaN игнорируется', () => {
    const c = new RepCounter(TH);
    expect(c.update(NaN, 0)).toEqual([]);
    expect(c.phase).toBe('start');
  });

  it('резкий старт сразу в полную амплитуду — down и bottom в одном кадре', () => {
    const c = new RepCounter(TH);
    expect(phases(c.update(1.0, 0))).toEqual(['down', 'bottom']);
  });
});
