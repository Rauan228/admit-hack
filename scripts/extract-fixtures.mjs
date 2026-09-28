#!/usr/bin/env node
// Извлечение поз из видео в JSON-фикстуры (E-15).
//
//   node scripts/extract-fixtures.mjs <jobs.json>
//
// jobs.json — массив заданий: { "video": "путь к файлу", "out": "куда писать JSON",
//   "fps": 30, "from": 0, "to": 12.5, "model": "full", "meta": { … } }.
// Поднимает Vite, открывает системный Chrome (playwright-core, без скачивания браузеров)
// и на странице dev/extract.html покадрово гонит видео через src/engine/pose.ts.
// Видео должны лежать внутри репозитория (например, в .cache/videos) — так их отдаёт Vite.

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { createServer } from 'vite';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const jobsPath = process.argv[2];
if (!jobsPath) {
  console.error('usage: node scripts/extract-fixtures.mjs <jobs.json>');
  process.exit(2);
}
const jobs = JSON.parse(await readFile(jobsPath, 'utf8'));
const concurrency = Number(process.env.CONCURRENCY ?? 3);

// Без HMR и слежения за файлами: правка исходников во время долгого прогона иначе перезагружает
// страницы, и извлечение молча начинается заново. MediaPipe собираем заранее, а не по первому запросу.
const server = await createServer({
  root,
  logLevel: 'error',
  server: { port: 0, host: '127.0.0.1', hmr: false, watch: null },
  optimizeDeps: { include: ['@mediapipe/tasks-vision'] },
});
await server.listen();
const base = server.resolvedUrls.local[0];
const browser = await chromium.launch({ channel: 'chrome', headless: true });

async function run(job) {
  const page = await browser.newPage();
  const src = '/' + relative(root, resolve(root, job.video)).split('\\').join('/');
  const params = new URLSearchParams({
    src,
    fps: String(job.fps ?? 30),
    from: String(job.from ?? 0),
    ...(job.to !== undefined ? { to: String(job.to) } : {}),
    model: job.model ?? 'full',
    delegate: job.delegate ?? 'CPU',
    numPoses: String(job.numPoses ?? 1),
  });
  const started = Date.now();
  await page.goto(`${base}dev/extract.html?${params}`);
  await page.waitForFunction(() => window.__fixture || window.__error, null, { timeout: 0, polling: 500 });
  const error = await page.evaluate(() => window.__error);
  if (error) throw new Error(`${job.video}: ${error}`);
  const fixture = await page.evaluate(() => window.__fixture);
  await page.close();
  if (job.meta) fixture.meta = job.meta;
  await mkdir(dirname(resolve(root, job.out)), { recursive: true });
  await writeFile(resolve(root, job.out), JSON.stringify(fixture));
  const people = fixture.frames.filter((f) => f.p.length > 0).length;
  console.log(
    `${job.out}: ${fixture.frames.length} кадров, человек в ${people}, ${((Date.now() - started) / 1000).toFixed(0)} с`,
  );
}

const queue = [...jobs];
let failed = 0;
await Promise.all(
  Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
    for (let job = queue.shift(); job; job = queue.shift()) {
      // Одна повторная попытка: сеть к CDN с моделью иногда моргает.
      for (let attempt = 1; attempt <= 2; attempt++) {
        try {
          await run(job);
          break;
        } catch (err) {
          console.error(`попытка ${attempt}: ${String(err)}`);
          if (attempt === 2) failed++;
        }
      }
    }
  }),
);
await browser.close();
await server.close();
process.exit(failed ? 1 : 0);
