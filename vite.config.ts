import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  // На GitHub Pages сайт живёт в подпапке (/admit-hack/), на Vercel — в корне.
  base: process.env.BASE_PATH ?? '/',
  plugins: [react()],
  // API аккаунтов и рейтинга (server/) — локально: npm run api; в dev-сервере проксируем /api туда.
  server: { proxy: { '/api': 'http://127.0.0.1:8787' } },
  preview: { proxy: { '/api': 'http://127.0.0.1:8787' } },
  build: {
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, 'index.html'),
        // Стенд движка — в сборке: по ссылке с телефона можно проверить распознавание без UI.
        engine: resolve(import.meta.dirname, 'dev/engine.html'),
      },
    },
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    globals: true,
  },
});
