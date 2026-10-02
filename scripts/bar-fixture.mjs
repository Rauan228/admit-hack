#!/usr/bin/env node
// Запись подтягиваний с серыми вырезками у кистей (extract-fixtures.mjs, задание с "bar": true) → фикстура:
// по каждой вырезке ищем перекладину тем же кодом, что в живой камере (src/engine/bar.ts), и кладём
// в кадр поле b = [y, уверенность] (0 — линии нет). Сами вырезки в репозиторий не идут.
//
//   node --experimental-strip-types scripts/bar-fixture.mjs <вход.json> <выход.json> '<meta JSON>'

import { readFileSync, writeFileSync } from 'node:fs';
import { analyzeBar } from '../src/engine/bar.ts';

const [src, out, meta] = process.argv.slice(2);
const file = JSON.parse(readFileSync(src, 'utf8'));
const bars = new Map((file.bars ?? []).map((b) => [b.t, b]));
for (const f of file.frames) {
  const b = bars.get(f.t);
  if (!b) continue;
  const seen = analyzeBar(Buffer.from(b.g, 'base64'), { x0: b.r[0], y0: b.r[1], x1: b.r[2], y1: b.r[3] });
  f.b = seen ? [Math.round(seen.y * 1000) / 1000, Math.round(seen.score * 100) / 100] : 0;
}
delete file.bars;
if (meta) file.meta = JSON.parse(meta);
writeFileSync(out, JSON.stringify(file));
console.log(
  `${out}: ${file.frames.length} кадров, турник искали в ${file.frames.filter((f) => f.b !== undefined).length}`,
);
