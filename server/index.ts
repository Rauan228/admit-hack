// Запуск API: node --experimental-strip-types server/index.ts
// Переменные: PORT (8787), DB_PATH (./data/forma.db), SECURE_COOKIES=1 на проде за https,
// OPENAI_API_KEY (+ OPENAI_MODEL) — для ИИ-конструктора плана.

import { mkdirSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, resolve } from 'node:path';
import { createApp } from './app.ts';
import { openDb } from './db.ts';

const port = Number(process.env.PORT ?? 8787);
const dbPath = resolve(process.env.DB_PATH ?? 'data/forma.db');
mkdirSync(dirname(dbPath), { recursive: true });

const handle = createApp(openDb(dbPath), {
  secureCookies: process.env.SECURE_COOKIES === '1',
  coach: { apiKey: process.env.OPENAI_API_KEY, model: process.env.OPENAI_MODEL || undefined },
});
const server = createServer((req, res) => void handle(req, res));
// E-26: онлайн-дуэль — WebSocket на /api/duel/ws (nginx пробрасывает Upgrade только для этого пути).
server.on('upgrade', handle.upgrade);
server.listen(port, '127.0.0.1', () => {
  console.log(`FORMA API: http://127.0.0.1:${port}/api/health (db: ${dbPath})`);
});
