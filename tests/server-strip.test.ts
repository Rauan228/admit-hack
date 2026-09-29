// API на VPS запускается как `node --experimental-strip-types server/index.ts`: Node только стирает типы.
// Параметры-свойства (`constructor(readonly x)`), enum и namespace он не понимает — vitest их компилирует,
// поэтому без этой проверки сервер мог пройти тесты и не стартовать на проде (E-26, 30.09).

import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

describe('сервер стартует так же, как на VPS', () => {
  it('server/app.ts и всё, что он тянет, грузятся в режиме strip-only', () => {
    const root = resolve(import.meta.dirname, '..');
    const out = execFileSync(
      process.execPath,
      [
        '--experimental-strip-types',
        '--no-warnings',
        '-e',
        "import('./server/app.ts').then(() => console.log('ok'))",
      ],
      { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    );
    expect(out.trim()).toBe('ok');
  });
});
