import { FrameSnapshots, sourceSize, type SnapshotCanvas } from '../src/engine/snapshot';

/** Холст-заглушка: помнит, какой «кадр» видео в него скопировали последним. */
function fakeCanvas(): SnapshotCanvas & { drawn: unknown } {
  const slot = {
    canvas: { width: 0, height: 0 } as HTMLCanvasElement,
    drawn: null as unknown,
    ctx: {} as CanvasRenderingContext2D,
  };
  slot.ctx = {
    drawImage: (src: unknown) => {
      slot.drawn = (src as { frameNo: number }).frameNo;
    },
  } as unknown as CanvasRenderingContext2D;
  return slot;
}

const video = (frameNo: number, w = 640, h = 480) =>
  ({ videoWidth: w, videoHeight: h, frameNo }) as unknown as HTMLVideoElement;

describe('снимок кадра для модели и экрана', () => {
  it('экран получает кадр только после детекции; следующий снимок пишется в другой холст', () => {
    const made: ReturnType<typeof fakeCanvas>[] = [];
    const snaps = new FrameSnapshots(() => {
      const c = fakeCanvas();
      made.push(c);
      return c;
    });
    expect(snaps.frame).toBeNull();

    const a = snaps.capture(video(1));
    expect(a).not.toBeNull();
    // Пока детекция не закончилась, экран показывает прошлый кадр (здесь — ещё ничего).
    expect(snaps.frame).toBeNull();
    snaps.commit();
    expect(snaps.frame).toBe(a);

    const b = snaps.capture(video(2));
    expect(b).not.toBe(a);
    // Модель пишет кадр 2 в другой холст — на экране по-прежнему кадр 1 со своими точками.
    expect(snaps.frame).toBe(a);
    expect(made.map((c) => c.drawn)).toEqual([1, 2]);
    snaps.commit();
    expect(snaps.frame).toBe(b);
    expect(made).toHaveLength(2);
  });

  it('детекция упала (commit не вызван) — на экране остаётся прошлый кадр, холст переиспользуется', () => {
    const snaps = new FrameSnapshots(fakeCanvas);
    const a = snaps.capture(video(1));
    snaps.commit();
    const b = snaps.capture(video(2));
    // Детекция кадра 2 бросила исключение — commit не было.
    const again = snaps.capture(video(3));
    expect(again).toBe(b);
    expect(snaps.frame).toBe(a);
  });

  it('холст под размер кадра; нет холстов (тесты, воркер) — null, модель берёт само видео', () => {
    const snaps = new FrameSnapshots(fakeCanvas);
    const c = snaps.capture(video(1, 480, 360))!;
    expect(sourceSize(c)).toEqual({ w: 480, h: 360 });
    expect(new FrameSnapshots(() => null).capture(video(1))).toBeNull();
    // Видео ещё не готово (0×0) — снимок не делаем.
    expect(new FrameSnapshots(fakeCanvas).capture(video(1, 0, 0))).toBeNull();
    // В node нет document — снимков нет, движок работает как раньше.
    expect(new FrameSnapshots().capture(video(1))).toBeNull();
  });
});
