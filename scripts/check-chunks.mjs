#!/usr/bin/env node
// Проверка сборки (E-27): со страниц без платформы (дуэль, стенд движка) не достижима её точка входа
// main-*.js — ни статическим импортом, ни динамическим. Иначе на такой странице исполняется main.tsx:
// он сразу рендерит React в #root и падает (React #299) — «Не удалось запустить распознавание».
// Так было 30.09: Engine.ts импортировался и статически (стенд), и динамически (createEngine) — Rolldown
// строил для него namespace через служебный __exportAll и клал его в main-*.js.
//
//   node scripts/check-chunks.mjs [dist]

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const dist = process.argv[2] ?? 'dist';
const PAGES = ['duel.html', 'dev/engine.html'];
const assets = join(dist, 'assets');
const entry = readdirSync(assets).find((f) => /^main-[\w-]+\.js$/.test(f));
if (!entry) {
  console.error(`check-chunks: нет main-*.js в ${assets} — сначала npm run build`);
  process.exit(2);
}

/** Имена JS-файлов из assets/, на которые ссылается текст (import, import(), modulepreload, __vite__mapDeps). */
const refs = (text) => new Set([...text.matchAll(/(?:assets\/|\.\/)([\w-]+\.js)/g)].map((m) => m[1]));

let failed = false;
for (const page of PAGES) {
  const html = join(dist, page);
  if (!existsSync(html)) continue;
  const seen = new Set();
  const queue = [...refs(readFileSync(html, 'utf8'))];
  while (queue.length) {
    const file = queue.pop();
    if (seen.has(file) || !existsSync(join(assets, file))) continue;
    seen.add(file);
    queue.push(...refs(readFileSync(join(assets, file), 'utf8')));
  }
  if (seen.has(entry)) {
    console.error(`check-chunks: со страницы ${page} достижима точка входа платформы ${entry}`);
    failed = true;
  } else console.log(`check-chunks: ${page} — ok (${seen.size} чанков, без ${entry})`);
}
process.exit(failed ? 1 : 0);
