// Все настройки движка в одном месте: их подкручиваем на живых людях, а не ищем по коду.
// Пороги упражнений (углы, число кадров) добавляются сюда же в E-08…E-12.

export type PoseModel = 'lite' | 'full';

/** Версия wasm должна совпадать с версией пакета @mediapipe/tasks-vision в package.json. */
const TASKS_VISION_VERSION = '1.0.1';

export const ENGINE_CONFIG = {
  camera: {
    /** Фронтальная камера на телефоне; на ноутбуке браузер возьмёт единственную. */
    facingMode: 'user',
    /** 640×480 хватает модели с запасом; больше — только медленнее на телефоне. */
    width: 640,
    height: 480,
    frameRate: 30,
  },
  pose: {
    wasmBaseUrl: `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${TASKS_VISION_VERSION}/wasm`,
    modelUrls: {
      lite: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task',
      full: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task',
    } satisfies Record<PoseModel, string>,
    /** full точнее; берём её, когда есть аппаратный GPU. На слабом телефоне — lite (E-18). */
    model: 'full' as PoseModel,
    /** Без GPU каждая миллисекунда на счету: lite на CPU ~52 мс/кадр против ~57 у full. */
    cpuModel: 'lite' as PoseModel,
    /** Один человек в кадре; выбор ближайшего из нескольких — E-17. */
    numPoses: 1,
    minPoseDetectionConfidence: 0.5,
    minPosePresenceConfidence: 0.5,
    minTrackingConfidence: 0.5,
  },
  /** Окно, по которому усредняется FPS в событии frame, мс. */
  fpsWindowMs: 1000,
} as const;
