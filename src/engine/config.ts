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
  /** One Euro filter для точек (E-05). */
  filter: {
    /**
     * Нормализованные точки. Скорость делится на длину корпуса, поэтому beta в «корпусах в секунду».
     * Подбор перебором (tests/filter.test.ts): дрожание в покое гасится в 3,4 раза,
     * отставание и на взмахе руки (полкадра за 0,3 с), и на приседе — около 1 % кадра.
     * beta 8 давала меньше задержки, но шум модели сам «разгонял» фильтр и дрожание почти не гасилось.
     */
    image: { minCutoff: 0.7, beta: 4, dCutoff: 1.0 },
    /** Мировые точки в метрах: корпус ~0,5 м, поэтому beta вдвое больше, чем у image. */
    world: { minCutoff: 0.7, beta: 8, dCutoff: 1.0 },
    /** Если между кадрами прошло больше, история фильтра сбрасывается (человек пропадал из кадра). */
    resetAfterMs: 500,
  },
  /** Калибровка «виден целиком / далеко / близко / темно» (E-06). */
  calibration: {
    /** Точка считается видимой с такой уверенностью модели. */
    minVisibility: 0.5,
    /** Средняя яркость кадра 0..255, ниже которой точно «темно». */
    darkLuma: 40,
    /** Ниже этой яркости «темно», если модель ещё и плохо видит человека. */
    dimLuma: 70,
    /** Средняя видимость ключевых точек, ниже которой модель «плохо видит». */
    lowVisibility: 0.6,
    /** Доля высоты кадра от носа до стоп: меньше — «подойди ближе». */
    minBodyHeight: 0.42,
    /** Больше — «отойди»: голове и стопам нужен запас по краям. */
    maxBodyHeight: 0.93,
    /** Отступ от боковых краёв кадра, доля ширины: ближе — «встань в центр». */
    edgeMargin: 0.03,
    /** Центр тела (таз или видимая часть корпуса) ближе к боковому краю, чем эта доля ширины, — «встань в центр». */
    offCenter: 0.2,
    /** Ширина плеч / длина корпуса: меньше — человек стоит боком. Анфас ~0,8…1,1, боком ~0,1…0,3. */
    minShoulderToTorso: 0.4,
    /** Сколько новый статус должен продержаться, чтобы мы в него поверили, мс. */
    stableMs: { no_person: 300, partial: 450, too_close: 450, too_far: 450, dark: 600, ok: 350 },
    /** В режиме калибровки текущий статус повторяется с таким интервалом, мс (как в моке). */
    repeatMs: 1000,
    /** Яркость меряем не каждый кадр: это чтение пикселей. */
    brightnessIntervalMs: 500,
  },
} as const;
