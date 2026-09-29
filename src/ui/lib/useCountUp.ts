import { useEffect, useState } from 'react';

/** Число «набегает» от 0 до target (ease-out). При reduced motion — сразу итог. */
export function useCountUp(target: number, durationMs = 900, delayMs = 0): number {
  const reduced =
    typeof window !== 'undefined' &&
    (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false);
  const [value, setValue] = useState(reduced ? target : 0);

  useEffect(() => {
    if (reduced) return;
    let raf = 0;
    const start = performance.now() + delayMs;
    const tick = () => {
      const t = Math.min(1, Math.max(0, (performance.now() - start) / durationMs));
      setValue(Math.round(target * (1 - Math.pow(1 - t, 3))));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, durationMs, delayMs, reduced]);

  return reduced ? target : value;
}
