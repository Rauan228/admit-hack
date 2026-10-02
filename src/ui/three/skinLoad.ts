// Веса вершин для частей модели: из кэша браузера (IndexedDB — со второго захода без расчёта), иначе в
// фоновом потоке, а без него — на основном (как раньше). Результат кладём в кэш.

import { BufferAttribute, type BufferGeometry } from 'three';
import { SKIN_VERSION, computeSkin, type SkinWeights } from './skin';

type Part = { name: string; geo: BufferGeometry };
type Result = { name: string } & SkinWeights;

export async function skinParts(parts: Part[], modelUrl: string): Promise<void> {
  const key = `${modelUrl}#skin${SKIN_VERSION}`;
  const counts = parts.map((p) => p.geo.getAttribute('position').count);
  let res = await cacheGet(key);
  // Кэш от другой сборки модели (другое число вершин) — не годится.
  if (!res || res.length !== parts.length || res.some((r, i) => r.idx.length !== counts[i]! * 4)) {
    res = (await inWorker(parts).catch(() => null)) ?? parts.map((p) => onMain(p));
    void cachePut(key, res);
  }
  parts.forEach((p, i) => {
    p.geo.setAttribute('skinIndex', new BufferAttribute(res[i]!.idx, 4));
    p.geo.setAttribute('skinWeight', new BufferAttribute(res[i]!.wts, 4));
  });
}

function onMain(p: Part): Result {
  const pos = p.geo.getAttribute('position').array as Float32Array;
  const index = p.geo.getIndex()?.array ?? null;
  return { name: p.name, ...computeSkin(pos, index, p.name) };
}

function inWorker(parts: Part[]): Promise<Result[]> {
  if (typeof Worker === 'undefined') return Promise.reject(new Error('no worker'));
  return new Promise((resolve, reject) => {
    const w = new Worker(new URL('./skin.worker.ts', import.meta.url), { type: 'module' });
    w.onmessage = (e: MessageEvent<Result[]>) => {
      resolve(e.data);
      w.terminate();
    };
    w.onerror = (e) => {
      reject(e);
      w.terminate();
    };
    // Копии массивов: геометрия остаётся на основном потоке целой.
    const job = parts.map((p) => ({
      name: p.name,
      positions: new Float32Array(p.geo.getAttribute('position').array as Float32Array),
      index: p.geo.getIndex() ? (p.geo.getIndex()!.array as Uint32Array | Uint16Array).slice() : null,
    }));
    w.postMessage(
      { parts: job },
      job.flatMap((j) => [j.positions.buffer, ...(j.index ? [j.index.buffer] : [])]),
    );
  });
}

// ——— Кэш в IndexedDB (любая ошибка — просто без кэша) ———

const DB = 'forma-3d';
const STORE = 'skin';

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') return reject(new Error('no idb'));
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

async function cacheGet(key: string): Promise<Result[] | null> {
  try {
    const db = await open();
    return await new Promise((resolve) => {
      const q = db.transaction(STORE).objectStore(STORE).get(key);
      q.onsuccess = () => resolve((q.result as Result[] | undefined) ?? null);
      q.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

async function cachePut(key: string, value: Result[]): Promise<void> {
  try {
    const db = await open();
    const tx = db.transaction(STORE, 'readwrite');
    const s = tx.objectStore(STORE);
    s.clear(); // старые версии и другая модель — не копим
    s.put(value, key);
  } catch {
    /* без кэша */
  }
}
