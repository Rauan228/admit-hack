import { GestureTracker, pointerPosition, type GestureEvent } from '../src/engine/gestures';
import type { PoseFrame } from '../src/engine/geometry';
import { LM } from '../src/engine/hints';
import type { Landmark } from '../src/engine/types';
import { BOTH_HANDS_UP, body, buildPose, type BodyParams } from '../src/mocks/poses';

const DT = 1000 / 30;
const frameOf = (
  params: Partial<BodyParams> | BodyParams,
  t = 0,
  edit?: (p: Landmark[]) => void,
): PoseFrame => {
  const image = buildPose(body(params));
  edit?.(image);
  // Мок строит пропорции тела в квадратных пикселях, поэтому аспект 1.
  return { t, aspect: 1, image, world: null };
};
const ON = { pointer: true, bothHandsUp: true };

/** Прогон последовательности кадров; возвращает все события. */
function run(tracker: GestureTracker, frames: (PoseFrame | null)[], opts = ON, t0 = 0): GestureEvent[] {
  const out: GestureEvent[] = [];
  frames.forEach((f, i) => out.push(...tracker.update(f, t0 + i * DT, opts)));
  return out;
}
const repeat = <T>(x: T, n: number): T[] => Array.from({ length: n }, () => x);
const pointers = (evs: GestureEvent[]) => evs.filter((e) => e.type === 'pointer');

describe('курсор-рука', () => {
  it('руки опущены — курсора нет вообще', () => {
    expect(run(new GestureTracker(), repeat(frameOf({}), 30))).toEqual([]);
  });

  it('поднятая правая рука ведёт курсор, hand = right', () => {
    const evs = run(new GestureTracker(), repeat(frameOf({ armR: 100, elbowR: 0 }), 20));
    const ps = pointers(evs);
    expect(ps.length).toBeGreaterThan(10);
    expect(ps.every((e) => e.type === 'pointer' && e.hand === 'right')).toBe(true);
  });

  it('зеркально: правая рука уходит в сторону — курсор уходит вправо по экрану', () => {
    const near = pointerPosition(frameOf({ armR: 15, elbowR: 0 }), 'right');
    const far = pointerPosition(frameOf({ armR: 40, elbowR: 0 }), 'right');
    expect(far.x).toBeGreaterThan(near.x);
    // Левая рука в сторону — курсор влево.
    const leftOut = pointerPosition(frameOf({ armL: 100, elbowL: 0 }), 'left');
    expect(leftOut.x).toBeLessThan(0.3);
  });

  it('рука выше — курсор выше (y меньше)', () => {
    const low = pointerPosition(frameOf({ armR: 70, elbowR: 0 }), 'right');
    const high = pointerPosition(frameOf({ armR: 150, elbowR: 0 }), 'right');
    expect(high.y).toBeLessThan(low.y);
  });

  it('до углов экрана можно дотянуться, не сходя с места', () => {
    // Рука по диагонали вверх-наружу — верхний угол экрана.
    const topOut = pointerPosition(frameOf({ armR: 135, elbowR: 0 }), 'right');
    expect(topOut.x).toBeGreaterThan(0.95);
    expect(topOut.y).toBeLessThan(0.05);
    // Та же диагональ внутрь (через голову) — противоположный верхний угол достаётся левой рукой.
    const topIn = pointerPosition(frameOf({ armL: 135, elbowL: 0 }), 'left');
    expect(topIn.x).toBeLessThan(0.05);
    expect(topIn.y).toBeLessThan(0.05);
    const sideOut = pointerPosition(frameOf({ armR: 95, elbowR: 0 }), 'right');
    expect(sideOut.x).toBeGreaterThan(0.95);
  });

  it('курсор всегда в пределах 0..1', () => {
    for (const arm of [20, 60, 90, 120, 170]) {
      for (const hand of ['left', 'right'] as const) {
        const p = pointerPosition(frameOf({ armL: arm, armR: arm }), hand);
        expect(p.x).toBeGreaterThanOrEqual(0);
        expect(p.x).toBeLessThanOrEqual(1);
        expect(p.y).toBeGreaterThanOrEqual(0);
        expect(p.y).toBeLessThanOrEqual(1);
      }
    }
  });

  it('рука опустилась — один pointer_lost, дальше тишина', () => {
    const evs = run(new GestureTracker(), [
      ...repeat(frameOf({ armR: 100 }), 10),
      ...repeat(frameOf({}), 10),
    ]);
    expect(evs.filter((e) => e.type === 'pointer_lost')).toHaveLength(1);
    expect(evs.at(-1)?.type).toBe('pointer_lost');
  });

  it('человек пропал из кадра — pointer_lost', () => {
    const evs = run(new GestureTracker(), [...repeat(frameOf({ armR: 100 }), 5), null, null]);
    expect(evs.filter((e) => e.type === 'pointer_lost')).toHaveLength(1);
  });

  it('в режиме без курсора событий pointer нет', () => {
    const evs = run(new GestureTracker(), repeat(frameOf({ armR: 100 }), 10), {
      pointer: false,
      bothHandsUp: true,
    });
    expect(pointers(evs)).toHaveLength(0);
  });

  it('гистерезис: рука чуть опустилась ниже порога включения — курсор не пропадает', () => {
    const tracker = new GestureTracker();
    // Поднял руку до плеча, затем опустил почти до пояса — всё ещё выше порога отпускания.
    const evs = run(tracker, [...repeat(frameOf({ armR: 90 }), 5), ...repeat(frameOf({ armR: 45 }), 5)]);
    expect(evs.some((e) => e.type === 'pointer_lost')).toBe(false);
  });

  it('пока правая рука ведёт, поднятая левая курсор не перехватывает', () => {
    const tracker = new GestureTracker();
    const evs = run(tracker, [
      ...repeat(frameOf({ armR: 100 }), 5),
      ...repeat(frameOf({ armR: 100, armL: 120 }), 5),
    ]);
    const ps = pointers(evs);
    expect(ps.every((e) => e.type === 'pointer' && e.hand === 'right')).toBe(true);
  });

  it('дрожание запястья почти не доходит до курсора', () => {
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5) * 0.006;
    const frames = Array.from({ length: 90 }, (_, i) =>
      frameOf({ armR: 100 }, i * DT, (pts) => {
        const w = pts[LM.rightWrist] as Landmark;
        pts[LM.rightWrist] = { ...w, x: w.x + rnd(), y: w.y + rnd() };
      }),
    );
    const xs = pointers(run(new GestureTracker(), frames))
      .slice(10)
      .map((e) => (e.type === 'pointer' ? e.x : 0));
    const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
    const std = Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / xs.length);
    // Дрожание ±0,3 % кадра даёт меньше 1 % экрана: кольцо удержания 1,2 с не сбивается.
    expect(std).toBeLessThan(0.01);
  });

  it('курсор шлётся не чаще ~30 раз в секунду', () => {
    const tracker = new GestureTracker();
    const out: GestureEvent[] = [];
    // 120 кадров в секунду в течение секунды.
    for (let i = 0; i < 120; i++) out.push(...tracker.update(frameOf({ armR: 100 }), i * (1000 / 120), ON));
    expect(pointers(out).length).toBeLessThanOrEqual(31);
  });
});

describe('обе руки вверх', () => {
  const up = frameOf(BOTH_HANDS_UP);
  const down = frameOf({});
  /** Руки над головой, но запястья вышли из кадра (телефон, человек близко): видны только локти. */
  const upWristsHidden = frameOf(BOTH_HANDS_UP, 0, (p) => {
    p[LM.leftWrist]!.v = 0;
    p[LM.rightWrist]!.v = 0;
  });
  const holds = (evs: GestureEvent[]) =>
    evs.filter((e): e is Extract<GestureEvent, { type: 'gesture_hold' }> => e.type === 'gesture_hold');

  it('1,2 с удержания — один жест', () => {
    const evs = run(new GestureTracker(), repeat(up, 45));
    expect(evs.filter((e) => e.type === 'gesture')).toEqual([{ type: 'gesture', name: 'both_hands_up' }]);
  });

  it('короче 1,2 с — жеста нет', () => {
    const evs = run(new GestureTracker(), [...repeat(up, 30), ...repeat(down, 10)]);
    expect(evs.some((e) => e.type === 'gesture')).toBe(false);
  });

  it('пока руки подняты, идёт прогресс удержания 0…1, и он доходит до 1 перед самим жестом', () => {
    const evs = run(new GestureTracker(), repeat(up, 45));
    const p = holds(evs).map((e) => e.progress);
    expect(p.length).toBeGreaterThan(10);
    expect(p[0]).toBeLessThan(0.1);
    for (let i = 1; i < p.length; i++) expect(p[i]).toBeGreaterThanOrEqual(p[i - 1]!);
    const gestureAt = evs.findIndex((e) => e.type === 'gesture');
    const lastHold = evs
      .slice(0, gestureAt)
      .filter((e) => e.type === 'gesture_hold')
      .at(-1);
    expect(lastHold).toEqual({ type: 'gesture_hold', name: 'both_hands_up', progress: 1 });
    // После жеста прогресс больше не шлём — руки всё ещё вверху, но жест уже сработал.
    expect(evs.slice(gestureAt + 1).some((e) => e.type === 'gesture_hold')).toBe(false);
  });

  it('опустил руки раньше времени — прогресс сбрасывается в 0 один раз', () => {
    const evs = run(new GestureTracker(), [...repeat(up, 15), ...repeat(down, 20)]);
    const p = holds(evs).map((e) => e.progress);
    expect(p.at(-1)).toBe(0);
    // Первый кадр удержания — тоже 0 (старт); после роста ноль-сброс приходит ровно один раз.
    let lastPositive = -1;
    p.forEach((x, i) => {
      if (x > 0) lastPositive = i;
    });
    expect(lastPositive).toBeGreaterThan(0);
    expect(p.slice(lastPositive + 1)).toEqual([0]);
    expect(evs.some((e) => e.type === 'gesture')).toBe(false);
  });

  it('запястья над головой ушли из кадра — по локтям это всё ещё «руки вверх»', () => {
    const evs = run(new GestureTracker(), repeat(upWristsHidden, 45));
    expect(evs.filter((e) => e.type === 'gesture')).toHaveLength(1);
  });

  it('после reset() запястья над головой пропали из кадра — это НЕ «руки опущены», жест не перевзводится', () => {
    // Телефон: руки над головой, запястья выше кадра. Раньше невидимое запястье считалось опущенным,
    // жест взводился заново и через удержание срабатывал второй раз, пока руки ещё вверху.
    const tracker = new GestureTracker();
    run(tracker, repeat(up, 45));
    tracker.reset();
    const evs = run(tracker, [...repeat(upWristsHidden, 20), ...repeat(up, 60)], ON, 3000);
    expect(evs.some((e) => e.type === 'gesture')).toBe(false);
  });

  it('запястья не видны, но локти ниже плеч (руки висят, кисти за кадром) — это «опущены», жест взводится', () => {
    const downWristsHidden = frameOf({}, 0, (p) => {
      p[LM.leftWrist]!.v = 0;
      p[LM.rightWrist]!.v = 0;
    });
    const tracker = new GestureTracker();
    tracker.reset();
    const evs = run(tracker, [...repeat(downWristsHidden, 10), ...repeat(up, 45)]);
    expect(evs.filter((e) => e.type === 'gesture')).toHaveLength(1);
  });

  it('держит руки 3 с — жест всё равно один', () => {
    const evs = run(new GestureTracker(), repeat(up, 90));
    expect(evs.filter((e) => e.type === 'gesture')).toHaveLength(1);
  });

  it('опустил и поднял снова — второй жест', () => {
    const evs = run(new GestureTracker(), [...repeat(up, 45), ...repeat(down, 10), ...repeat(up, 45)]);
    expect(evs.filter((e) => e.type === 'gesture')).toHaveLength(2);
  });

  it('короткий провал детекции внутри удержания прощается', () => {
    const evs = run(new GestureTracker(), [...repeat(up, 25), null, null, ...repeat(up, 25)]);
    expect(evs.filter((e) => e.type === 'gesture')).toHaveLength(1);
  });

  it('когда жест отключён (подход «звёздочки»), руки над головой ничего не значат', () => {
    const evs = run(new GestureTracker(), repeat(up, 60), { pointer: false, bothHandsUp: false });
    expect(evs).toEqual([]);
  });

  it('пока руки над головой, курсор отпущен: перед жестом приходит pointer_lost', () => {
    const tracker = new GestureTracker();
    const evs = run(tracker, [...repeat(frameOf({ armR: 100 }), 10), ...repeat(up, 45)]);
    const lostAt = evs.findIndex((e) => e.type === 'pointer_lost');
    const gestureAt = evs.findIndex((e) => e.type === 'gesture');
    expect(lostAt).toBeGreaterThanOrEqual(0);
    expect(gestureAt).toBeGreaterThan(lostAt);
  });

  it('после reset() (смена режима) руки, поднятые ещё до него, жест не дают — только после опускания', () => {
    // Подход → итоги: закончил подход руками вверх и ещё держит их — итоги не должны тут же уйти в меню.
    const tracker = new GestureTracker();
    run(tracker, repeat(up, 30));
    tracker.reset();
    const still = run(tracker, repeat(up, 60), ON, 2000);
    expect(still.some((e) => e.type === 'gesture')).toBe(false);
    const again = run(tracker, [...repeat(down, 10), ...repeat(up, 45)], ON, 5000);
    expect(again.filter((e) => e.type === 'gesture')).toHaveLength(1);
  });

  it('после reset() с опущенными руками жест работает как обычно', () => {
    const tracker = new GestureTracker();
    tracker.reset();
    const evs = run(tracker, [...repeat(down, 5), ...repeat(up, 45)]);
    expect(evs.filter((e) => e.type === 'gesture')).toHaveLength(1);
  });

  it('одна рука вверху — это курсор, а не жест', () => {
    const evs = run(new GestureTracker(), repeat(frameOf({ armR: 170 }), 40));
    expect(evs.some((e) => e.type === 'gesture')).toBe(false);
    expect(pointers(evs).length).toBeGreaterThan(0);
  });
});
