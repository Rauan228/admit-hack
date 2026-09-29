import { copyFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  // Сайт в корне; если выкладывать в подпапку — BASE_PATH=/подпапка/.
  base: process.env.BASE_PATH ?? '/',
  plugins: [
    react(),
    // Адреса платформы (/app, /app/rating…) — одна страница: статический хостинг без SPA-правил на обновлении /app
    // отдаёт 404.html (боевой nginx отдаёт index.html сам).
    {
      name: 'spa-404',
      writeBundle(options) {
        if (options.dir) copyFileSync(join(options.dir, 'index.html'), join(options.dir, '404.html'));
      },
    },
  ],
  // API аккаунтов и рейтинга (server/) — локально: npm run api; в dev-сервере проксируем /api туда
  // вместе с WebSocket онлайн-дуэли (/api/duel/ws, E-26).
  server: { proxy: { '/api': { target: 'http://127.0.0.1:8787', ws: true } } },
  preview: { proxy: { '/api': { target: 'http://127.0.0.1:8787', ws: true } } },
  build: {
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, 'index.html'),
        // Стенд движка — в сборке: по ссылке с телефона можно проверить распознавание без UI.
        engine: resolve(import.meta.dirname, 'dev/engine.html'),
        // E-24: дуэль на отжиманиях — отдельная страница /duel.html.
        duel: resolve(import.meta.dirname, 'duel.html'),
      },
    },
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    globals: true,
  },
});
