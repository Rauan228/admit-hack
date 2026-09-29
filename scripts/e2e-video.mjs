#!/usr/bin/env node
// Сквозная проверка движка на видео вместо камеры.
//
//   node scripts/e2e-video.mjs <video> <mode> [секунд] [--from 2.5] [--to 23] [--base https://…/]
//
// Видео превращается ffmpeg в «камеру» Chrome (--use-file-for-fake-video-capture), в начало
// добавляется 15 с неподвижного первого кадра — пока грузится модель (бывает и 10 с). Дальше открывается
// dev-стенд (/dev/engine.html) в режиме mode (squat, jumping_jack, lunge, menu, calibration…),
// и всё идёт по-настоящему: getUserMedia → MediaPipe → сглаживание → правила → события.
// Скрипт печатает события движка (без frame) и итог: повторы, подсказки, FPS.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { createServer } from 'vite';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args.splice(i, 2)[1] : undefined;
};
const from = flag('--from');
const to = flag('--to');
/** Проверить уже выложенный сайт (например, GitHub Pages) вместо локального сервера. */
const base = flag('--base');
const [video, mode = 'squat', secondsArg] = args;
if (!video) {
  console.error(
    'usage: node scripts/e2e-video.mjs <video> <mode> [seconds] [--from s] [--to s] [--base url]',
  );
  process.exit(2);
}

const PAD_S = 15;
const tmp = mkdtempSync(join(tmpdir(), 'forma-e2e-'));
const cam = join(tmp, 'camera.y4m');
// Обрезка — параметрами входа (до -i): после -i она резала бы уже готовый файл вместе с паузой.
const trim = [
  ...(from ? ['-ss', from] : []),
  ...(to ? ['-t', String(Number(to) - Number(from ?? 0))] : []),
  '-i',
  resolve(video),
];
execFileSync('ffmpeg', [
  '-v',
  'error',
  '-y',
  ...trim,
  '-vf',
  `tpad=start_duration=${PAD_S}:start_mode=clone,scale=640:480,fps=30,format=yuv420p`,
  cam,
]);
const duration = Number(
  execFileSync('ffprobe', [
    '-v',
    'error',
    '-show_entries',
    'format=duration',
    '-of',
    'csv=p=0',
    cam,
  ]).toString(),
);
const seconds = Number(secondsArg ?? Math.ceil(duration));

const server = base
  ? null
  : await createServer({
      root,
      logLevel: 'error',
      server: { port: 0, host: '127.0.0.1', hmr: false, watch: null },
      optimizeDeps: { include: ['@mediapipe/tasks-vision'] },
    });
await server?.listen();
const origin = base ?? server?.resolvedUrls?.local[0];
const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: [
    '--use-fake-ui-for-media-stream',
    '--use-fake-device-for-media-stream',
    `--use-file-for-fake-video-capture=${cam}`,
  ],
});
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${origin}dev/engine.html?mode=${mode}&target=100&autostart=1&prewarm=1`);
  // Камера в Chrome зациклена. Отсчёт — от первого кадра движка: к этому моменту ролик прошёл меньше
  // паузы в начале, а после конца ролика снова идёт неподвижная пауза, где ничего не считается.
  await page.waitForFunction(() => (window.__events ?? []).some((e) => e.type === 'frame'), null, {
    timeout: 120_000,
  });
  await page.waitForTimeout(seconds * 1000);
  const { events, frames } = await page.evaluate(() => {
    const all = window.__events ?? [];
    const f = all.filter((e) => e.type === 'frame');
    return {
      events: all.filter((e) => e.type !== 'frame' && e.type !== 'pointer'),
      frames: {
        total: f.length,
        withPerson: f.filter((e) => e.landmarks.length).length,
        fps: f.at(-1)?.fps ?? 0,
      },
    };
  });
  for (const e of events) {
    if (e.type === 'phase') continue;
    const detail =
      e.type === 'rep'
        ? `#${e.count} оценка ${e.score}${e.errors.length ? ` [${e.errors.join(', ')}]` : ''}`
        : e.type === 'half_rep'
          ? `${e.side}${e.errors.length ? ` [${e.errors.join(', ')}]` : ''}`
          : e.type === 'form_error'
            ? `${e.code}: ${e.message}`
            : e.type === 'calibration'
              ? `${e.status}: ${e.hint}`
              : e.type === 'set_complete'
                ? JSON.stringify(e.stats)
                : '';
    console.log(`${e.type.padEnd(12)} ${detail}`);
  }
  const reps = events.filter((e) => e.type === 'rep').length;
  const hints = events.filter((e) => e.type === 'form_error').map((e) => e.code);
  // Выпады: повтор — пара ног, каждое движение — half_rep со стороной (нога впереди).
  const halves = events.filter((e) => e.type === 'half_rep').map((e) => (e.side === 'right' ? 'П' : 'Л'));
  console.log(
    `\nитог: повторов ${reps}${halves.length ? ` (движений ${halves.length}: ${halves.join(' ')})` : ''}; подсказок ${hints.length} [${hints.join(', ')}]; кадров ${frames.total}, с человеком ${frames.withPerson}, FPS ${frames.fps}`,
  );
  if (errors.length) console.log(`ошибки страницы: ${errors.join(' | ')}`);
} finally {
  await browser.close();
  await server?.close();
  rmSync(tmp, { recursive: true, force: true });
}
