// Удары боя от первого лица (fight/punch.ts) на записях: размеченные по раскадровке (tests/fixtures/fpv)
// и записи движка с известным числом ударов (tests/fixtures/boxing-*). Тот же путь точек, что на странице:
// сглаживание движка → сглаживание экрана → детектор.

import { readFileSync } from 'node:fs';
import { LandmarkSmoother, RenderSmoother, smoothPose } from '../src/engine/filter';
import { torsoLength } from '../src/engine/geometry';
import { decodeDetection, type FixtureFile } from '../src/engine/recorder';
import { PunchDetector, type PunchEvent } from '../src/fight/punch';

type Span = { from: number; to: number };
type Labeled = FixtureFile & {
  meta: { punches: (Span & { side: 'left' | 'right' })[]; unsure: Span[]; guard: Span[] };
};

const load = <T>(path: string) => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8')) as T;

function punches(file: FixtureFile): PunchEvent[] {
  const sm = new LandmarkSmoother();
  const rs = new RenderSmoother();
  const det = new PunchDetector();
  const out: PunchEvent[] = [];
  for (const f of file.frames) {
    const d = decodeDetection(f);
    if (!d) continue;
    const frame = smoothPose(sm, d.image, d.world, f.t, file.aspect);
    const scale = torsoLength({ t: f.t, aspect: file.aspect, image: d.image, world: null }) || 0.25;
    out.push(...det.update(rs.apply(d.image, frame.image, f.t, file.aspect, scale), f.t, file.aspect));
  }
  // Как на странице: удар засчитан к касанию, если это удар, а не мах руками (confirm).
  return out.filter((e) => det.confirm(e.side, e.t));
}

/** Удар найден, если срабатывание той же руки — от 0,15 с до начала до 0,45 с после конца. */
function score(file: Labeled, events: PunchEvent[]) {
  const used = file.meta.punches.map(() => false);
  let tp = 0;
  let fp = 0;
  const lat: number[] = [];
  for (const e of events) {
    const t = e.t / 1000;
    const i = file.meta.punches.findIndex(
      (p, k) => !used[k] && p.side === e.side && t >= p.from - 0.15 && t <= p.to + 0.45,
    );
    if (i >= 0) {
      used[i] = true;
      tp += 1;
      lat.push(t - file.meta.punches[i]!.from);
    } else if (!file.meta.unsure.some((u) => t >= u.from - 0.1 && t <= u.to + 0.3)) fp += 1;
  }
  return { tp, fp, fn: used.filter((u) => !u).length, lat };
}

const LABELED = ['boxing-pexels-gym', 'boxing-pexels-close', 'boxing-pexels-front'];

describe('удары от первого лица: размеченные записи', () => {
  const all = LABELED.map((n) => {
    const file = load<Labeled>(`./fixtures/fpv/${n}.json`);
    return { n, file, events: punches(file), ...score(file, punches(file)) };
  });

  it('в сумме: найдено ≥ 70 % ударов, ≥ 75 % срабатываний — настоящие удары нужной рукой', () => {
    const tp = all.reduce((a, r) => a + r.tp, 0);
    const fp = all.reduce((a, r) => a + r.fp, 0);
    const fn = all.reduce((a, r) => a + r.fn, 0);
    expect(tp / (tp + fn)).toBeGreaterThanOrEqual(0.7);
    expect(tp / (tp + fp)).toBeGreaterThanOrEqual(0.75);
  });

  it('срабатывает в начале удара: медиана задержки от начала — не больше 0,25 с', () => {
    const lat = all.flatMap((r) => r.lat).sort((a, b) => a - b);
    expect(lat[Math.floor(lat.length / 2)]!).toBeLessThanOrEqual(0.25);
  });

  it('в стойке — почти без срабатываний (не больше одного на все отрезки стойки: поправил перчатку)', () => {
    const inGuard = all.flatMap(({ file, events }) =>
      events.filter((e) => file.meta.guard.some((g) => e.t / 1000 > g.from + 0.2 && e.t / 1000 < g.to - 0.2)),
    );
    expect(inGuard.length).toBeLessThanOrEqual(1);
  });
});

describe('удары от первого лица: записи движка', () => {
  const count = (n: string) => punches(load<FixtureFile>(`./fixtures/${n}.json`)).length;

  it('стойка без ударов — 0', () => {
    expect(count('boxing-guard-idle')).toBe(0);
  });

  it('анфас — число ударов в пределах разметки движка', () => {
    // Клетка: быстрые серии с боковыми, руки между сериями внизу — строгая проверка «удар, а не мах»
    // (U-27) пропускает часть боковых: 14 из ~18.
    expect(count('boxing-front-cage')).toBeGreaterThanOrEqual(13);
    expect(count('boxing-front-cage')).toBeLessThanOrEqual(21);
    expect(count('boxing-front-gym')).toBeGreaterThanOrEqual(13);
    expect(count('boxing-front-gym')).toBeLessThanOrEqual(23);
  });
});

describe('удары от первого лица: мах руками — не удар (U-27)', () => {
  /** Подтверждённых «ударов» на записи, где люди машут руками, но не бьют. */
  const swings = (n: string) => punches(load<FixtureFile>(`./fixtures/${n}.json`)).length;

  it('«звёздочка», жим над головой, выпады, наклоны, подтягивания, бёрпи — почти ни одного', () => {
    const files = [
      'jumping-jack-front',
      'jumping-jack-front-2',
      'jumping-jack-slow',
      'jumping-jack-antiphase',
      'squat-press-kettlebell',
      'lunge-front-backlit',
      'side-bend-front',
      'pull-up-6',
      'burpee-side-deck',
      'squat-side-backlit',
    ];
    const per = Object.fromEntries(files.map((n) => [n, swings(n)]));
    // Было (без проверки): 18–20 на каждой «звёздочке», 40 на выпадах, 38 на подтягиваниях — 246 всего.
    expect(Object.values(per).reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(30);
    for (const n of [
      'jumping-jack-slow',
      'jumping-jack-antiphase',
      'pull-up-6',
      'burpee-side-deck',
      'squat-side-backlit',
    ])
      expect(per[n]).toBe(0);
    expect(per['jumping-jack-front-2']).toBeLessThanOrEqual(2);
  });

  it('круги руками (самый похожий на удары мах) — в разы меньше прежнего', () => {
    // Было 21 за 11 с, стало 4.
    expect(swings('arm-circles-big')).toBeLessThanOrEqual(6);
  });
});
