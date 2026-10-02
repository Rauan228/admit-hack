// Веса вершин атлета в фоновом потоке (skin.ts): основной поток в это время рисует и отвечает.

import { computeSkin } from './skin';

interface Job {
  parts: { name: string; positions: Float32Array; index: Uint32Array | Uint16Array | null }[];
}

self.onmessage = (e: MessageEvent<Job>) => {
  const out = e.data.parts.map((p) => ({ name: p.name, ...computeSkin(p.positions, p.index, p.name) }));
  (self as unknown as Worker).postMessage(
    out,
    out.flatMap((o) => [o.idx.buffer, o.wts.buffer]),
  );
};
