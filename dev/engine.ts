// Dev-стенд реального движка: видео, скелет, курсор, счётчик, подсказки и журнал событий.
// Проверяет движок на живой камере без UI. Режим — кнопками или в адресе:
//   /dev/engine.html?mode=squat&target=10&autostart=1
// (mode: calibration | menu | squat | jumping_jack | lunge | arm_raise). Все события движка
// складываются в window.__events — по ним dev-скрипты проверяют движок на видео вместо камеры.

import { createRealEngine } from '../src/engine/Engine';
import { createPoseDetector, type PoseDetector } from '../src/engine/pose';
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
const ctx = canvas.getContext('2d')!;

const params = new URLSearchParams(location.search);
const target = Number(params.get('target') ?? 10);
let detector: PoseDetector | null = null;
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
    case 'rep':
      state.reps = e.count;
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
  b.addEventListener('click', () => engine?.setMode(toMode(name)));
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
  engine = createRealEngine({ createPoseDetector: async () => (detector = await createPoseDetector()) });
  engine.on(onEvent);
  engine.setMode(toMode(params.get('mode')));
  const t0 = performance.now();
  try {
    await engine.start(video);
    console.info(`[dev] движок запущен за ${Math.round(performance.now() - t0)} мс`);
  } catch (err) {
    hud.textContent = `Ошибка: ${(err as Error).message}`;
    button.disabled = false;
  }
}

button.addEventListener('click', () => void start());
if (params.get('autostart') === '1') void start();
