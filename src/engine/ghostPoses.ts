// «Призрак» (E-19): эталонное движение для каждого упражнения — для интро перед подходом (U-12).
//
// Ключевые кадры строятся тем же кинематическим скелетом, на котором проверены все ошибки техники,
// поэтому призрак показывает ровно то, что движок считает правильным: присед до параллели,
// руки над головой и ноги шире плеч в «звёздочке», заднее колено у пола в выпаде.
// Точки — в формате события frame (Landmark[33]): UI рисует призрака тем же кодом, что и скелет.

import { clamp } from './geometry';
import {
  blendFrames,
  floorFrame,
  frontPlankFrame,
  lungeFrame,
  sideLungeFrame,
  squatPose,
  STAND,
  synthFrame,
  type SynthParams,
} from './skeleton';
import type { ExerciseId, Landmark } from './types';

/** Длительность одного цикла анимации, мс. */
export const GHOST_DURATION_MS: Record<ExerciseId, number> = {
  squat: 2800,
  jumping_jack: 1100,
  lunge: 5600, // два выпада: правой ногой назад, потом левой
  arm_raise: 2600,
  high_knees: 1000, // два шага: левое колено, правое
  knee_to_elbow: 3000, // два касания: левый локоть к правому колену, правый к левому
  squat_press: 3200,
  side_bend: 3000, // наклон влево, потом вправо
  side_leg_raise: 2600, // левая нога в сторону, потом правая
  side_lunge: 4000, // выпад на левую ногу, потом на правую
  jump_squat: 2600,
  calf_raise: 2400,
  cross_jack: 1200,
  arm_circles: 1000, // один круг
  boxing: 1400, // джеб левой, кросс правой
  push_up: 2400,
  plank: 2000,
  burpee: 3600,
  pull_up: 3000,
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
    case 'high_knees': {
      // Первая половина — левое колено до уровня пояса, вторая — правое; руки согнуты, как в беге.
      const lift = 88 * wave(u < 0.5 ? u * 2 : (u - 0.5) * 2);
      return synthFrame(
        { ...STAND, ...base, arms: 15, elbow: 95, ...(u < 0.5 ? { liftL: lift } : { liftR: lift }) },
        0,
      ).image;
    }
    case 'knee_to_elbow': {
      // Руки за головой; колено поднимается, противоположный локоть идёт к нему, корпус чуть вперёд.
      const c = wave(u < 0.5 ? u * 2 : (u - 0.5) * 2);
      const right = u < 0.5;
      return synthFrame(
        {
          ...STAND,
          ...base,
          handsBehindHead: true,
          lean: 15 * c,
          crunch: c,
          crunchElbow: right ? 'left' : 'right',
          ...(right ? { liftR: 80 * c } : { liftL: 80 * c }),
        },
        0,
      ).image;
    }
    case 'squat_press': {
      // Кисти у плеч → присед ниже параллели → встал → руки прямо вверх → кисти обратно к плечам.
      const depth = u < 0.45 ? wave(u / 0.45) : 0;
      const press = u >= 0.4 && u < 0.85 ? wave((u - 0.4) / 0.45) : 0;
      return synthFrame(
        { ...squatPose(depth * 100, base), arms: 20 + press * 160, elbow: 160 * (1 - press) },
        0,
      ).image;
    }
    case 'side_bend': {
      // Руки на поясе; корпус наклоняется влево, потом вправо, таз на месте.
      const k = wave(u < 0.5 ? u * 2 : (u - 0.5) * 2);
      return synthFrame({ ...STAND, ...base, arms: 25, elbow: 110, sideTilt: (u < 0.5 ? 1 : -1) * 30 * k }, 0)
        .image;
    }
    case 'side_leg_raise': {
      const k = wave(u < 0.5 ? u * 2 : (u - 0.5) * 2);
      return synthFrame(
        { ...STAND, ...base, arms: 25, elbow: 110, ...(u < 0.5 ? { abductL: 44 * k } : { abductR: 44 * k }) },
        0,
      ).image;
    }
    case 'side_lunge': {
      // Выпад на 3/4 половины цикла, потом стоя в центре — между сторонами есть пауза, как у человека.
      const half = u < 0.5 ? u * 2 : (u - 0.5) * 2;
      const depth = half < 0.75 ? wave(half / 0.75) : 0;
      return sideLungeFrame({ depth, side: u < 0.5 ? 'left' : 'right', aspect: 1, height: 0.8 }, 0).image;
    }
    case 'jump_squat': {
      // Присед до параллели → выпрыгнул (стопы отрываются) → приземлился.
      const depth = u < 0.5 ? wave(u / 0.5) : 0;
      const air = u >= 0.5 && u < 0.8 ? Math.sin((Math.PI * (u - 0.5)) / 0.3) : 0;
      return synthFrame(
        { ...squatPose(depth * 100, base), footY: 0.92 - 0.09 * air, arms: 20 + depth * 40 + air * 40 },
        0,
      ).image;
    }
    case 'calf_raise':
      return synthFrame({ ...STAND, ...base, onToes: 0.04 * w }, 0).image;
    case 'cross_jack':
      // Скрещены (руки перед грудью, ноги накрест) → прыжок: руки в стороны, ноги шире плеч → обратно.
      return synthFrame(
        { ...STAND, ...base, armsIn: 1 - w, stance: -0.4 + 4 * w, thigh: w * 8, shin: w * 3 },
        0,
      ).image;
    case 'arm_circles':
      return synthFrame({ ...STAND, ...base, circle: { angle: 2 * Math.PI * u, radius: 0.06 } }, 0).image;
    case 'boxing': {
      // Кулаки у подбородка; первая половина — прямой левой, вторая — правой.
      const k = wave(u < 0.5 ? u * 2 : (u - 0.5) * 2);
      return synthFrame({ ...STAND, ...base, punchL: u < 0.5 ? k : 0, punchR: u < 0.5 ? 0 : k }, 0).image;
    }
    case 'push_up':
      // Лицом к камере, камера на полу (E-31): плечи опускаются к кистям, локти уходят в стороны.
      return floorFrame({ down: w, aspect: 1, height: 0.8 }, 0).image;
    case 'plank':
      // Планка на предплечьях лицом к камере; плечи чуть «дышат», чтобы призрак не выглядел замершим.
      return floorFrame(
        { down: 0, forearms: true, floorY: 0.9 + 0.004 * Math.sin(2 * Math.PI * u), aspect: 1, height: 0.8 },
        0,
      ).image;
    case 'burpee':
      return burpeePose(u, base);
    case 'pull_up':
      // Вис на прямых руках → тело поднимается к перекладине (стопы отрываются от пола) → обратно.
      // Ниже и мельче, чем стоя: кисти над головой не должны уходить за верх кадра.
      return synthFrame({ ...STAND, ...base, height: 0.66, arms: 172, footY: 0.97 - 0.1 * w }, 0).image;
  }
}

/** Бёрпи: стойка → присед, руки к полу → упор лёжа → обратно в присед → встал → прыжок с руками вверх. */
function burpeePose(u: number, base: Partial<SynthParams>): Landmark[] {
  const stand = synthFrame({ ...STAND, ...base, arms: 10 }, 0);
  const crouch = synthFrame({ ...squatPose(90, base), lean: 30, arms: 10 }, 0);
  const plank = frontPlankFrame({ aspect: 1, height: 0.8, footY: 0.92 }, 0);
  const jump = synthFrame({ ...STAND, ...base, arms: 175, footY: 0.85 }, 0);
  const steps: [number, ReturnType<typeof synthFrame>][] = [
    [0, stand],
    [0.15, crouch],
    [0.3, plank],
    [0.5, plank],
    [0.65, crouch],
    [0.76, stand],
    [0.88, jump],
    [1, stand],
  ];
  for (let i = 1; i < steps.length; i++) {
    const [u0, a] = steps[i - 1] as [number, ReturnType<typeof synthFrame>];
    const [u1, b] = steps[i] as [number, ReturnType<typeof synthFrame>];
    if (u <= u1) {
      const k = (u - u0) / (u1 - u0);
      return blendFrames(a, b, 0.5 - 0.5 * Math.cos(Math.PI * k), 0).image;
    }
  }
  return stand.image;
}

/** Ключевые кадры цикла: GHOST_KEYFRAMES[упражнение][k] — поза в момент k / 12 цикла. */
export const GHOST_KEYFRAMES: Record<ExerciseId, Landmark[][]> = {
  squat: frames('squat'),
  jumping_jack: frames('jumping_jack'),
  lunge: frames('lunge'),
  arm_raise: frames('arm_raise'),
  high_knees: frames('high_knees'),
  knee_to_elbow: frames('knee_to_elbow'),
  squat_press: frames('squat_press'),
  side_bend: frames('side_bend'),
  side_leg_raise: frames('side_leg_raise'),
  side_lunge: frames('side_lunge'),
  jump_squat: frames('jump_squat'),
  calf_raise: frames('calf_raise'),
  cross_jack: frames('cross_jack'),
  arm_circles: frames('arm_circles'),
  boxing: frames('boxing'),
  push_up: frames('push_up'),
  plank: frames('plank'),
  burpee: frames('burpee'),
  pull_up: frames('pull_up'),
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
