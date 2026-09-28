import { decodeDetection, decodePoseFrame, encodeFrame, PoseRecorder } from '../src/engine/recorder';
import type { PoseDetection } from '../src/engine/pose';

const detection = (dx = 0): PoseDetection => ({
  image: Array.from({ length: 33 }, (_, i) => ({ x: 0.123456 + i * 0.01 + dx, y: 0.5, z: -0.1, v: 0.987 })),
  world: Array.from({ length: 33 }, (_, i) => ({ x: i * 0.01, y: -0.5, z: 0.25 })),
});

describe('формат записи поз', () => {
  it('кадр → запись → кадр: точность 0,001 кадра (полпикселя при 480p)', () => {
    const back = decodeDetection(encodeFrame(1234.6, detection()));
    expect(back?.image).toHaveLength(33);
    expect(back?.world).toHaveLength(33);
    expect(back?.image[0]?.x).toBeCloseTo(0.123, 3);
    expect(back?.image[0]?.v).toBeCloseTo(0.99, 2);
    expect(back?.world?.[5]?.x).toBeCloseTo(0.05, 3);
  });

  it('никого в кадре — пустой массив точек, время сохраняется', () => {
    const f = encodeFrame(500, null);
    expect(f).toEqual({ t: 500, p: [] });
    expect(decodeDetection(f)).toBeNull();
    expect(decodePoseFrame({ version: 1, fps: 30, aspect: 4 / 3, frames: [f] }, f)).toBeNull();
  });

  it('без мировых точек — world null, а не пустой массив', () => {
    const f = encodeFrame(0, { image: detection().image, world: null });
    expect(f.w).toBeUndefined();
    expect(decodeDetection(f)?.world).toBeNull();
  });

  it('PoseRecorder: время от начала записи, FPS по реальным меткам, meta', () => {
    const rec = new PoseRecorder();
    for (let i = 0; i < 31; i++) rec.add(10_000 + i * 40, i === 5 ? null : detection(i * 0.001), 16 / 9);
    const file = rec.finish({ exercise: 'squat' });
    expect(file.frames).toHaveLength(31);
    expect(file.frames[0]?.t).toBe(0);
    expect(file.frames[30]?.t).toBe(1200);
    expect(file.fps).toBe(25);
    expect(file.aspect).toBeCloseTo(16 / 9);
    expect(file.frames[5]?.p).toEqual([]);
    expect(file.meta).toEqual({ exercise: 'squat' });
    expect(rec.length).toBe(0);
  });

  it('запись переиспользуется: после finish следующий файл начинается с нуля', () => {
    const rec = new PoseRecorder();
    rec.add(100, detection(), 4 / 3);
    rec.finish();
    rec.add(9000, detection(), 4 / 3);
    expect(rec.finish().frames[0]?.t).toBe(0);
  });
});
