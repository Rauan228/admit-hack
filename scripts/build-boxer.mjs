#!/usr/bin/env node
// Сборка 3D-бойца для боя с ботом: Rocketbox Sports_Male_01 (MIT) → фигура и экипировка → public/models/boxer.glb.
//
//   node scripts/build-boxer.mjs [--base http://localhost:5173/]
//
// Исходники кладём в .cache/boxer/Sports_Male_01/ (в git не попадают): FBX из репозитория Rocketbox
// (Assets/Avatars/Professions/Sports_Male_01/Export/Sports_Male_01.fbx) и текстуры m021_* из Textures/,
// уменьшенные до 1024: цвет и блики — .jpg, нормали — .png (ImageMagick: convert x.tga -resize 1024x1024 x.jpg).
// Сама сборка — в браузере (dev/boxerBuild.ts, three.js FBXLoader → GLTFExporter), здесь только запуск и запись.

import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { createServer } from 'vite';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const i = process.argv.indexOf('--base');
const base = i >= 0 ? process.argv[i + 1] : null;
const server = base
  ? null
  : await createServer({
      root,
      logLevel: 'error',
      server: { port: 0, host: '127.0.0.1', hmr: false, watch: null },
    });
await server?.listen();
const origin = base ?? server.resolvedUrls.local[0];
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage();
  await page.goto(`${origin}dev/boxer-build.html`);
  await page.waitForFunction(() => window.__glb || window.__error, null, { timeout: 120_000 });
  const { glb, error, log } = await page.evaluate(() => ({
    glb: window.__glb,
    error: window.__error,
    log: window.__log,
  }));
  for (const line of log ?? []) console.log(line);
  if (error) throw new Error(error);
  const out = resolve(root, 'public/models/boxer.glb');
  writeFileSync(out, Buffer.from(glb, 'base64'));
  console.log(`записано: ${out}`);
} finally {
  await browser.close();
  await server?.close();
}
