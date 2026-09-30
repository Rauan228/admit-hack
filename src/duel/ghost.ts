// 3D-атлет платформы (ui/components/Ghost.tsx) на странице дуэли: страница без React, поэтому каждый атлет —
// свой маленький корень React поверх готового компонента. Сам компонент не трогаем: тот же атлет, что в
// выборе упражнений платформы (анатомическая модель, three.js — отдельным чанком, без WebGL — 2D).

import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Ghost, type GhostProps } from '../ui/components/Ghost';

export interface GhostMount {
  set(next: Partial<GhostProps>): void;
  unmount(): void;
}

export function mountGhost(host: HTMLElement, props: GhostProps): GhostMount {
  let root: Root | null = createRoot(host);
  let current: GhostProps = { ...props };
  const paint = () => root?.render(createElement(Ghost, current));
  paint();
  return {
    set(next) {
      const merged = { ...current, ...next };
      if (Object.keys(merged).every((k) => merged[k as keyof GhostProps] === current[k as keyof GhostProps]))
        return;
      current = merged;
      paint();
    },
    unmount() {
      root?.unmount();
      root = null;
    },
  };
}
