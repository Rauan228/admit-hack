#!/usr/bin/env node
// Сквозной прогон интерфейса на мок-движке и скриншоты экранов для README (U-17).
//
//   node scripts/ui-screens.mjs [--out docs/screens] [--mobile]
//
// Поднимает Vite, открывает /?mock=1&nodwell в Chrome (курсор мока не нажимает кнопки) и проходит сценарий: лендинг → калибровка → меню →
// выбор упражнения → интро → подход с подсказками → итоги → рекорды. Кнопки нажимаются кликом
// (запасной путь DwellButton), остальное — события мок-движка. Любая ошибка в консоли — провал.

import { mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { createServer } from 'vite';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const outArg = args.indexOf('--out');
const out = resolve(root, outArg >= 0 ? args[outArg + 1] : 'docs/screens');
const mobile = args.includes('--mobile');
mkdirSync(out, { recursive: true });

const server = await createServer({ root, server: { port: 5199, strictPort: true }, logLevel: 'error' });
await server.listen();
const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage({
  viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 900 },
  deviceScaleFactor: mobile ? 2 : 1,
  isMobile: mobile,
  hasTouch: mobile,
});

const errors = [];
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
page.on('pageerror', (e) => errors.push(e.message));

const suffix = mobile ? '-mobile' : '';
const shot = async (name) => {
  // JPEG: скриншоты лежат в репозитории, PNG раздул бы его в разы.
  await page.screenshot({ path: join(out, `${name}${suffix}.jpg`), type: 'jpeg', quality: 80 });
  console.log('📸', name);
};
const click = (text) => page.getByRole('button', { name: text }).first().click();
const waitText = (text, timeout = 30000) => page.getByText(text).first().waitFor({ timeout });

try {
  await page.goto('http://localhost:5199/?mock=1&nodwell');
  await waitText('не нужны руки');
  await page.waitForTimeout(1200);
  await shot('01-landing');

  await click('Начать');
  await waitText('Калибровка', 15000);
  await page.waitForTimeout(2300);
  await shot('02-calibration');

  await waitText('Что тренируем?', 15000);
  await page.waitForTimeout(900);
  await shot('03-menu');

  await click('Одно упражнение');
  await waitText('Выбери упражнение');
  await page.waitForTimeout(900);
  await shot('04-picker');

  await click('Приседания');
  await waitText('Смотри и повторяй');
  await page.waitForTimeout(1600);
  await shot('05-intro');

  // Подход: 10 повторов мока по 2,4 с. Ловим момент, когда видна подсказка техники.
  await page.locator('.workout').waitFor({ timeout: 15000 });
  await page.locator('.hint--bad, .hint--warn').first().waitFor({ timeout: 20000 });
  await page.waitForTimeout(250);
  await shot('06-workout-hint');

  await waitText('Над чем поработать', 40000);
  await page.waitForTimeout(1800);
  await shot('07-summary');

  await click('В рекорды');
  await waitText('Как тебя записать?');
  await shot('08-name');
  await page.locator('.names .btn').first().click();
  await waitText('Рекорды');
  await page.waitForTimeout(600);
  await shot('09-leaderboard');
} finally {
  await browser.close();
  await server.close();
}

if (errors.length) {
  console.error('Ошибки в консоли:\n' + errors.join('\n'));
  process.exit(1);
}
console.log('OK — сценарий пройден без ошибок');
