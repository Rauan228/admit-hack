// Реальный движок: камера + MediaPipe PoseLandmarker + правила.
// Заготовка. Наполняется в E-04…E-14; интерфейс уже финальный, UI переписывать не придётся.

import type { Engine, EngineEvent, EngineMode } from './types';

export class NotImplementedYetError extends Error {
  constructor() {
    super('Реальный движок появится в задаче E-14. Пока открой приложение с ?mock=1.');
    this.name = 'NotImplementedYetError';
  }
}

class RealEngine implements Engine {
  private readonly listeners = new Set<(e: EngineEvent) => void>();
  private mode: EngineMode = 'calibration';

  on(cb: (e: EngineEvent) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  async start(_video: HTMLVideoElement): Promise<void> {
    // start() отклоняется, пока распознавания нет: UI показывает своё состояние ошибки.
    throw new NotImplementedYetError();
  }

  stop(): void {
    this.listeners.clear();
  }

  setMode(mode: EngineMode): void {
    this.mode = mode;
  }

  /** Нужен, пока движок пустой: подтверждает, что режим доехал. */
  currentMode(): EngineMode {
    return this.mode;
  }
}

export function createRealEngine(): Engine {
  return new RealEngine();
}
