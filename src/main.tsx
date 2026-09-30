import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
// Глобальные стили — до App: стили экранов должны переопределять базовые, а не наоборот.
import './ui/styles/global.css';
import { App } from './ui/App';
import { prefetchPoseAssetsWhenIdle } from './engine/pose';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// E-34: пока человек на лендинге или в меню — подкачать модель позы и wasm: «Начать» включает камеру сразу.
// На лендинге и в меню сначала докачивается 3D-атлет (/models/*.glb) — не отбираем у него канал.
prefetchPoseAssetsWhenIdle({ after: /\/models\/[^/]+\.glb/ });
