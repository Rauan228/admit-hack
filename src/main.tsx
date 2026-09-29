import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
// Глобальные стили — до App: стили экранов должны переопределять базовые, а не наоборот.
import './ui/styles/global.css';
import { App } from './ui/App';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
