// «Призрак» (E-19): эталонное движение для каждого упражнения — для интро перед подходом (U-12).
//
// Ключевые кадры строятся тем же кинематическим скелетом, на котором проверены все ошибки техники,
// поэтому призрак показывает ровно то, что движок считает правильным: присед до параллели,
// руки над головой и ноги шире плеч в «звёздочке», заднее колено у пола в выпаде.
// Точки — в формате события frame (Landmark[33]): UI рисует призрака тем же кодом, что и скелет.

import { clamp } from './geometry';
import { lungeFrame, squatPose, STAND, synthFrame, type SynthParams } from './skeleton';
import type { ExerciseId, Landmark } from './types';

/** Длительность одного цикла анимации, мс. */
export const GHOST_DURATION_MS: Record<ExerciseId, number> = {
  squat: 2800,
  jumping_jack: 1100,
  lunge: 5600, // два выпада: правой ногой назад, потом левой
  arm_raise: 2600,
};

/** Сколько ключевых кадров на цикл. */
const KEYFRAMES = 12;

/** Плавное «туда-обратно» 0 → 1 → 0 за цикл u ∈ [0, 1). */
const wave = (u: number) => 0.5 - 0.5 * Math.cos(2 * Math.PI * u);

/** Поза упражнения в момент цикла u ∈ [0, 1): 0 — исходное положение, 0.5 — нижняя точка / пик. */
function poseAt(exercise: ExerciseId, u: number): Landmark[] {
  const w = wave(u);
  const base: Partial<SynthParams> = { aspect: 1, centerX: 0.5, footY: 0.92, height: 0.8, visibility: 1 };
  switch (exercise) {
    case 'squat':
      // До параллели и чуть ниже, руки вперёд-в стороны для баланса.
      return synthFrame({ ...squatPose(w * 100, base), arms: 10 + w * 45 }, 0).image;
    case 'jumping_jack':
      return synthFrame(
        { ...STAND, ...base, arms: 10 + w * 165, stance: 1 + w * 3.2, thigh: w * 10, shin: w * 4 },
        0,
      ).image;
    case 'lunge': {
      // Два выпада за цикл: первая половина — правая нога сзади, вторая — левая.
      const half = u < 0.5 ? u * 2 : (u - 0.5) * 2;
      return lungeFrame({ depth: wave(half), back: u < 0.5 ? 'right' : 'left', aspect: 1, height: 0.8 }, 0)
        .image;
    }
    case 'arm_raise':
      return synthFrame({ ...STAND, ...base, arms: 10 + w * 165 }, 0).image;
  }
}

/** Ключевые кадры цикла: GHOST_KEYFRAMES[упражнение][k] — поза в момент k / 12 цикла. */
export const GHOST_KEYFRAMES: Record<ExerciseId, Landmark[][]> = {
  squat: frames('squat'),
  jumping_jack: frames('jumping_jack'),
  lunge: frames('lunge'),
  arm_raise: frames('arm_raise'),
};

function frames(exercise: ExerciseId): Landmark[][] {
  return Array.from({ length: KEYFRAMES }, (_, k) => round(poseAt(exercise, k / KEYFRAMES)));
}

function round(points: Landmark[]): Landmark[] {
  return points.map((p) => ({ x: r3(p.x), y: r3(p.y), z: r3(p.z), v: 1 }));
}

function r3(v: number): number {
  return Math.round(v * 1000) / 1000;
}

/**
 * Поза призрака в момент tMs (анимация по кругу), линейная интерполяция между ключевыми кадрами.
 * aspect — ширина / высота холста UI: точки растягиваются так, чтобы человек не выглядел сплюснутым.
 * Координаты — как у события frame: x слева направо по исходной картинке (UI отражает сам, как скелет).
 */
export function ghostPoseAt(exercise: ExerciseId, tMs: number, aspect = 1): Landmark[] {
  const keys = GHOST_KEYFRAMES[exercise];
  const duration = GHOST_DURATION_MS[exercise];
  const u = (((tMs % duration) + duration) % duration) / duration;
  const pos = u * keys.length;
  const i = Math.floor(pos) % keys.length;
  const j = (i + 1) % keys.length;
  const k = pos - Math.floor(pos);
  const a = keys[i] as Landmark[];
  const b = keys[j] as Landmark[];
  return a.map((p, n) => {
    const q = b[n] as Landmark;
    // Ключевые кадры в квадратном холсте (аспект 1): для широкого холста сжимаем x к центру.
    const x = 0.5 + (p.x + (q.x - p.x) * k - 0.5) / aspect;
    return { x: clamp(x, -0.5, 1.5), y: p.y + (q.y - p.y) * k, z: p.z + (q.z - p.z) * k, v: 1 };
  });
}
