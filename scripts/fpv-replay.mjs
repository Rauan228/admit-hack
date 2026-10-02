#!/usr/bin/env node
// Видео боя от первого лица по записи позы (dev/fpv-replay.html): кадр за кадром в Chrome, склейка ffmpeg.
//   node scripts/fpv-replay.mjs <запись.json> <видео.mp4> <выход.mp4> [fps=30] [путь к ffmpeg] [с, с] [по, с]
// Пути к записи и видео — внутри репозитория (их отдаёт Vite).

import { spawn } from 'node:child_process';
import { chromium } from 'playwright-core';
import { createServer } from 'vite';

const [fixture, video, out, fpsArg, ffmpegArg, fromArg, toArg] = process.argv.slice(2);
if (!fixture || !out) {
  console.error('usage: node scripts/fpv-replay.mjs <fixture.json> <video.mp4> <out.mp4> [fps] [ffmpeg]');
  process.exit(2);
}
const fps = Number(fpsArg ?? 30);
const server = await createServer({
  server: { port: 0, host: '127.0.0.1', hmr: false, watch: null },
  logLevel: 'error',
});
await server.listen();
const base = server.resolvedUrls.local[0];
const browser = await chromium.launch({ channel: 'chrome', args: ['--use-gl=angle'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => console.error('page:', e.message));
await page.goto(`${base}dev/fpv-replay.html?fixture=/${fixture}&video=${video ? `/${video}` : ''}`);
await page.waitForFunction(() => window.ready, null, { timeout: 120000 });
const ff = spawn(
  ffmpegArg ?? 'ffmpeg',
  [
    ...['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(fps), '-i', '-'],
    ...['-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '23', out],
  ],
  { stdio: ['pipe', 'inherit', 'inherit'] },
);
const n = await page.evaluate(() => window.renderFrame(0));
const stage = page.locator('#stage');
const i0 = Math.round(Number(fromArg ?? 0) * fps);
const i1 = Math.min(n, toArg ? Math.round(Number(toArg) * fps) : n);
for (let i = i0; i < i1; i++) {
  if (i > 0) await page.evaluate((k) => window.renderFrame(k), i);
  ff.stdin.write(await stage.screenshot({ type: 'jpeg', quality: 85 }));
}
ff.stdin.end();
await new Promise((r) => ff.on('close', r));
await browser.close();
await server.close();
console.log('ok', out, n, 'frames');
