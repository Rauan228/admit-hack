// Dev-стенд реального движка: видео, скелет, курсор, счётчик, подсказки и журнал событий.
// Проверяет движок на живой камере без UI. Режим — кнопками или в адресе:
//   /dev/engine.html?mode=squat&target=10&autostart=1
// (mode: calibration | menu | squat | jumping_jack | lunge | arm_raise). Все события движка
// складываются в window.__events — по ним dev-скрипты проверяют движок на видео вместо камеры.

import { createRealEngine } from '../src/engine/Engine';
import { createPoseDetector, type PoseDetector } from '../src/engine/pose';
import { PoseRecorder } from '../src/engine/recorder';
import {
  EXERCISES,
  type Engine,
  type EngineEvent,
  type EngineMode,
  type ExerciseId,
  type Landmark,
} from '../src/engine/types';

declare global {
  interface Window {
    __events?: EngineEvent[];
  }
}

// Связи скелета MediaPipe Pose: плечи, руки, корпус, ноги.
const BONES: [number, number][] = [
  [11, 12],
  [11, 13],
  [13, 15],
  [12, 14],
  [14, 16],
  [11, 23],
  [12, 24],
  [23, 24],
  [23, 25],
  [25, 27],
  [27, 29],
  [29, 31],
  [27, 31],
  [24, 26],
  [26, 28],
  [28, 30],
  [30, 32],
  [28, 32],
];

const video = document.querySelector<HTMLVideoElement>('#video')!;
const canvas = document.querySelector<HTMLCanvasElement>('#overlay')!;
const hud = document.querySelector<HTMLDivElement>('#hud')!;
const button = document.querySelector<HTMLButtonElement>('#start')!;
const modes = document.querySelector<HTMLDivElement>('#modes')!;
const log = document.querySelector<HTMLPreElement>('#log')!;
const recordButton = document.querySelector<HTMLButtonElement>('#record')!;
const ctx = canvas.getContext('2d')!;

const params = new URLSearchParams(location.search);
const target = Number(params.get('target') ?? 10);
let detector: PoseDetector | null = null;
/** Запись фикстуры (E-15): пока включена, каждая сырая детекция идёт в файл. */
let recorder: PoseRecorder | null = null;
/** Режим, который стенд выставил движку последним (для имени файла записи). */
let current: EngineMode = 'calibration';
let engine: Engine | null = null;
let red = new Set<number>();
let pointer: { x: number; y: number } | null = null;
const state = {
  fps: 0,
  points: 0,
  calibration: '—',
  phase: '—',
  reps: 0,
  score: '—',
  hint: '—',
  gesture: '—',
  /** Выпады: стороны сделанных движений (П/Л) и какая нога ждёт пару. */
  halves: [] as string[],
  pair: '—',
};
window.__events = [];

function toMode(name: string | null): EngineMode {
  if (name === 'menu' || name === 'calibration' || name === null) return name ?? 'calibration';
  return EXERCISES.includes(name as ExerciseId)
    ? { exercise: name as ExerciseId, targetReps: target }
    : 'calibration';
}

function draw(points: Landmark[]): void {
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.lineWidth = 4;
  ctx.strokeStyle = '#4ade80';
  for (const [a, b] of BONES) {
    const p = points[a];
    const q = points[b];
    if (!p || !q || p.v < 0.5 || q.v < 0.5) continue;
    ctx.beginPath();
    ctx.moveTo(p.x * canvas.width, p.y * canvas.height);
    ctx.lineTo(q.x * canvas.width, q.y * canvas.height);
    ctx.stroke();
  }
  points.forEach((p, i) => {
    ctx.fillStyle = red.has(i) ? '#ef4444' : p.v >= 0.5 ? '#fff' : '#9ca3af';
    ctx.beginPath();
    ctx.arc(p.x * canvas.width, p.y * canvas.height, red.has(i) ? 9 : 5, 0, Math.PI * 2);
    ctx.fill();
  });
  if (pointer) {
    // Курсор приходит уже зеркальным, а canvas отражён CSS — возвращаем в координаты картинки.
    ctx.fillStyle = '#facc15';
    ctx.beginPath();
    ctx.arc((1 - pointer.x) * canvas.width, pointer.y * canvas.height, 14, 0, Math.PI * 2);
    ctx.fill();
  }
}

function render(): void {
  hud.textContent =
    `FPS ${state.fps} · ${detector?.delegate ?? '?'} / ${detector?.model ?? '?'} · точек ${state.points}\n` +
    `калибровка: ${state.calibration}\n` +
    `фаза: ${state.phase} · повторов: ${state.reps} · оценка: ${state.score}\n` +
    (state.halves.length ? `пара: ${state.pair} · стороны: ${state.halves.join(' ')}\n` : '') +
    `подсказка: ${state.hint}\n` +
    `жест: ${state.gesture}`;
}

function onEvent(e: EngineEvent): void {
  window.__events?.push(e);
  switch (e.type) {
    case 'frame':
      state.fps = e.fps;
      state.points = e.landmarks.filter((p) => p.v >= 0.5).length;
      draw(e.landmarks);
      break;
    case 'calibration':
      state.calibration = `${e.status} — ${e.hint}`;
      break;
    case 'pointer':
      pointer = { x: e.x, y: e.y };
      break;
    case 'pointer_lost':
      pointer = null;
      break;
    case 'gesture':
      state.gesture = `${e.name} @ ${new Date().toLocaleTimeString()}`;
      break;
    case 'phase':
      state.phase = e.phase;
      if (e.phase === 'start') red = new Set();
      break;
    case 'form_error':
      state.hint = `${e.message} (${e.code}${e.arrow ? `, стрелка ${e.arrow}` : ''})`;
      red = new Set(e.joints);
      break;
    case 'form_ok':
      state.hint = 'Отлично!';
      red = new Set();
      break;
    case 'half_rep': {
      // Сторона — нога впереди. П/Л по порядку: при смене ног должно чередоваться.
      const word = e.side === 'right' ? 'правая' : 'левая';
      state.halves = [...state.halves, e.side === 'right' ? 'П' : 'Л'].slice(-16);
      state.pair = `${word} ✓${e.errors.length ? ` (${e.errors.join(', ')})` : ''} — теперь ${e.side === 'right' ? 'левая' : 'правая'}`;
      break;
    }
    case 'rep':
      state.reps = e.count;
      if (state.halves.length) state.pair = 'пара закрыта';
      state.score = `${e.score}${e.errors.length ? ` (${e.errors.join(', ')})` : ''}`;
      break;
    case 'set_complete':
      state.hint = `подход закончен: ${JSON.stringify(e.stats)}`;
      break;
  }
  if (e.type !== 'frame' && e.type !== 'pointer')
    log.textContent = `${e.type} ${JSON.stringify(e)}\n${log.textContent}`.slice(0, 4000);
  render();
}

for (const name of ['calibration', 'menu', ...EXERCISES]) {
  const b = document.createElement('button');
  b.textContent = name;
  b.addEventListener('click', () => {
    // Новый режим — новый подход: счёт и стороны выпадов с нуля.
    state.reps = 0;
    state.halves = [];
    state.pair = '—';
    current = toMode(name);
    engine?.setMode(current);
  });
  modes.appendChild(b);
}

async function start(): Promise<void> {
  button.disabled = true;
  if (params.get('prewarm') === '1') {
    // Для проверок на видео: сначала скачать модель (дальше она из кэша браузера), потом включать камеру.
    // Иначе, пока модель едет с CDN, «видео-камера» успевает прокрутить начало ролика.
    hud.textContent = 'Прогреваю модель…';
    (await createPoseDetector()).close();
  }
  hud.textContent = 'Загружаю модель…';
  engine = createRealEngine({
    createPoseDetector: async () => (detector = recording(await createPoseDetector())),
  });
  engine.on(onEvent);
  current = toMode(params.get('mode'));
  engine.setMode(current);
  const t0 = performance.now();
  try {
    await engine.start(video);
    console.info(`[dev] движок запущен за ${Math.round(performance.now() - t0)} мс`);
  } catch (err) {
    hud.textContent = `Ошибка: ${(err as Error).message}`;
    button.disabled = false;
  }
}

/** Обёртка детектора: сырые точки (до сглаживания) уходят и в движок, и в запись. */
function recording(inner: PoseDetector): PoseDetector {
  return {
    delegate: inner.delegate,
    model: inner.model,
    detect(v, t) {
      const d = inner.detect(v, t);
      recorder?.add(t, d, v.videoWidth / Math.max(1, v.videoHeight));
      return d;
    },
    close: () => inner.close(),
  };
}

/** Скачать запись как JSON — готовая фикстура для tests/fixtures (разметку meta.expected дописать руками). */
function download(file: object, name: string): void {
  const url = URL.createObjectURL(new Blob([JSON.stringify(file)], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

recordButton.addEventListener('click', () => {
  if (!recorder) {
    recorder = new PoseRecorder();
    recordButton.textContent = '■ Стоп и скачать';
    return;
  }
  const exercise = typeof current === 'string' ? current : current.exercise;
  const file = recorder.finish({ exercise, model: detector?.model, recordedAt: new Date().toISOString() });
  recorder = null;
  recordButton.textContent = '● Запись';
  download(file, `forma-${exercise}-${Date.now()}.json`);
});

button.addEventListener('click', () => void start());
if (params.get('autostart') === '1') void start();
