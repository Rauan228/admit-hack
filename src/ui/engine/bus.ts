// Единственная точка, где UI держит движок. Экраны подписываются на события через useEngineEvents,
// а кадры (frame, 30 раз в секунду) складываются в live и читаются canvas'ом без ре-рендеров React.

import { useEffect, useLayoutEffect, useRef } from 'react';
import type { Engine, EngineEvent, EngineMode, Landmark } from '../../engine/types';

type Listener = (e: EngineEvent) => void;

/** Последний кадр движка: читает Stage в requestAnimationFrame. */
export const live = {
  landmarks: null as Landmark[] | null,
  /** Кадр камеры, на котором посчитаны landmarks (E-23): сцена рисует его, а не живое видео, — скелет кадр в кадр. */
  image: null as HTMLCanvasElement | null,
  fps: 0,
  lastFrameAt: 0,
  /** Курсор-рука в долях экрана (уже зеркально), null — рука опущена. */
  pointer: null as { x: number; y: number } | null,
};

let engine: Engine | null = null;
let detach: (() => void) | null = null;
let currentMode: string | null = null;
const listeners = new Set<Listener>();

export function attachEngine(next: Engine): void {
  detach?.();
  engine = next;
  currentMode = null;
  detach = next.on((e) => {
    if (e.type === 'frame') {
      live.landmarks = e.landmarks;
      live.image =
        typeof HTMLCanvasElement !== 'undefined' && e.image instanceof HTMLCanvasElement ? e.image : null;
      live.fps = e.fps;
      live.lastFrameAt = performance.now();
    } else if (e.type === 'pointer') {
      live.pointer = { x: e.x, y: e.y };
    } else if (e.type === 'pointer_lost' || e.type === 'gesture') {
      live.pointer = null;
    }
    for (const l of listeners) {
      try {
        l(e);
      } catch (err) {
        // Ошибка одного экрана не должна ронять поток событий.
        console.error(err);
      }
    }
  });
}

export function getEngine(): Engine | null {
  return engine;
}

/** Выключить камеру и движок (меню, рейтинг, профиль — камера им не нужна). */
export function detachEngine(): void {
  detach?.();
  detach = null;
  engine?.stop();
  engine = null;
  currentMode = null;
  live.landmarks = null;
  live.image = null;
  live.pointer = null;
}

/** Меняет режим, только если он действительно другой: повторный setMode сбросил бы подход. */
export function setEngineMode(mode: EngineMode): void {
  const key = typeof mode === 'string' ? mode : `${mode.exercise}:${mode.targetReps}`;
  if (key === currentMode) return;
  currentMode = key;
  engine?.setMode(mode);
}

/** Принудительно перезапускает режим (например, «ещё раз» то же упражнение). */
export function restartEngineMode(mode: EngineMode): void {
  currentMode = null;
  setEngineMode(mode);
}

export function subscribe(l: Listener): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

/** Подписка на события движка с актуальным обработчиком без переподписки. */
export function useEngineEvents(handler: Listener): void {
  const ref = useRef(handler);
  useLayoutEffect(() => {
    ref.current = handler;
  });
  useEffect(() => subscribe((e) => ref.current(e)), []);
}
