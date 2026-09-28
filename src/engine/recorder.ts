// Запись поз в JSON-фикстуры (E-15) и чтение их обратно.
// Формат компактный: у кадра массив p (33 × x,y,z,v) и w (33 × x,y,z в метрах), числа округлены.
// Из этих файлов тесты восстанавливают PoseFrame и прогоняют через движок без камеры.

import type { PoseFrame, Vec3 } from './geometry';
import type { PoseDetection } from './pose';
import type { Landmark } from './types';

export interface FixtureFrame {
  /** Время от начала записи, мс. */
  t: number;
  /** 33 × [x, y, z, v] подряд; пустой массив — в кадре никого нет. */
  p: number[];
  /** 33 × [x, y, z] мировых координат подряд или отсутствует. */
  w?: number[];
}

export interface FixtureFile {
  version: 1;
  /** Частота кадров записи. */
  fps: number;
  /** Ширина / высота кадра. */
  aspect: number;
  /** Модель, которой получены точки. */
  model?: string;
  frames: FixtureFrame[];
  /** Произвольное описание: источник, лицензия, разметка. */
  meta?: Record<string, unknown>;
}

/** 0,001 кадра — полпикселя при 480p: точнее модель всё равно не видит. */
const r3 = (v: number) => Math.round(v * 1000) / 1000;
const r2 = (v: number) => Math.round(v * 100) / 100;

/** Кадр детекции → компактная запись. */
export function encodeFrame(tMs: number, detection: PoseDetection | null): FixtureFrame {
  if (!detection) return { t: Math.round(tMs), p: [] };
  const p: number[] = [];
  for (const q of detection.image) p.push(r3(q.x), r3(q.y), r3(q.z), r2(q.v));
  const frame: FixtureFrame = { t: Math.round(tMs), p };
  if (detection.world) {
    const w: number[] = [];
    for (const q of detection.world) w.push(r3(q.x), r3(q.y), r3(q.z));
    frame.w = w;
  }
  return frame;
}

/** Запись → точки контракта. */
export function decodeImage(frame: FixtureFrame): Landmark[] {
  const out: Landmark[] = [];
  for (let i = 0; i + 3 < frame.p.length; i += 4) {
    out.push({
      x: frame.p[i] as number,
      y: frame.p[i + 1] as number,
      z: frame.p[i + 2] as number,
      v: frame.p[i + 3] as number,
    });
  }
  return out;
}

export function decodeWorld(frame: FixtureFrame): Vec3[] | null {
  if (!frame.w) return null;
  const out: Vec3[] = [];
  for (let i = 0; i + 2 < frame.w.length; i += 3) {
    out.push({ x: frame.w[i] as number, y: frame.w[i + 1] as number, z: frame.w[i + 2] as number });
  }
  return out;
}

/** Запись → детекция (как если бы её вернул PoseDetector); null, если в кадре никого. */
export function decodeDetection(frame: FixtureFrame): PoseDetection | null {
  if (frame.p.length === 0) return null;
  return { image: decodeImage(frame), world: decodeWorld(frame) };
}

/** Запись → PoseFrame без сглаживания (для анализа и тестов геометрии); null, если в кадре никого. */
export function decodePoseFrame(file: FixtureFile, frame: FixtureFrame): PoseFrame | null {
  if (frame.p.length === 0) return null;
  return { t: frame.t, aspect: file.aspect, image: decodeImage(frame), world: decodeWorld(frame) };
}

/** Накопитель для кнопки «Запись» на стенде: кадры живой камеры → FixtureFile. */
export class PoseRecorder {
  private frames: FixtureFrame[] = [];
  private t0: number | null = null;
  private aspect = 4 / 3;

  get length(): number {
    return this.frames.length;
  }

  add(tMs: number, detection: PoseDetection | null, aspect: number): void {
    if (this.t0 === null) this.t0 = tMs;
    this.aspect = aspect;
    this.frames.push(encodeFrame(tMs - this.t0, detection));
  }

  finish(meta?: Record<string, unknown>): FixtureFile {
    const n = this.frames.length;
    const durationMs = this.frames[n - 1]?.t ?? 0;
    const file: FixtureFile = {
      version: 1,
      fps: n > 1 && durationMs > 0 ? Math.round(((n - 1) * 1000) / durationMs) : 30,
      aspect: this.aspect,
      frames: this.frames,
      ...(meta ? { meta } : {}),
    };
    this.frames = [];
    this.t0 = null;
    return file;
  }
}
