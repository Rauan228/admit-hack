// Dev-стенд реального движка: видео, скелет поверх, FPS и делегат (GPU/CPU).
// Нужен, чтобы проверить E-04 на живой камере без UI; позже сюда же ляжет запись фикстур (E-15).

import { createRealEngine } from '../src/engine/Engine';
import { createPoseDetector, type PoseDetector } from '../src/engine/pose';
import type { Landmark } from '../src/engine/types';

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
const ctx = canvas.getContext('2d')!;

let detector: PoseDetector | null = null;

function draw(points: Landmark[]): void {
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const at = (i: number) => points[i];
  ctx.lineWidth = 4;
  ctx.strokeStyle = '#4ade80';
  for (const [a, b] of BONES) {
    const p = at(a);
    const q = at(b);
    if (!p || !q || p.v < 0.5 || q.v < 0.5) continue;
    ctx.beginPath();
    ctx.moveTo(p.x * canvas.width, p.y * canvas.height);
    ctx.lineTo(q.x * canvas.width, q.y * canvas.height);
    ctx.stroke();
  }
  for (const p of points) {
    ctx.fillStyle = p.v >= 0.5 ? '#fff' : '#f87171';
    ctx.beginPath();
    ctx.arc(p.x * canvas.width, p.y * canvas.height, 5, 0, Math.PI * 2);
    ctx.fill();
  }
}

button.addEventListener('click', async () => {
  button.disabled = true;
  hud.textContent = 'Загружаю модель…';
  const engine = createRealEngine({
    createPoseDetector: async () => (detector = await createPoseDetector()),
  });
  engine.on((e) => {
    if (e.type !== 'frame') return;
    draw(e.landmarks);
    const visible = e.landmarks.filter((p) => p.v >= 0.5).length;
    hud.textContent =
      `FPS: ${e.fps}\n` +
      `делегат: ${detector?.delegate} / модель: ${detector?.model}\n` +
      `точек: ${e.landmarks.length}, видно: ${visible}\n` +
      `видео: ${video.videoWidth}×${video.videoHeight}`;
  });
  const t0 = performance.now();
  try {
    await engine.start(video);
    console.info(`[dev] движок запущен за ${Math.round(performance.now() - t0)} мс`);
  } catch (err) {
    hud.textContent = `Ошибка: ${(err as Error).message}`;
    button.disabled = false;
  }
});
