// Быстрый старт движка (E-34): модель позы качается один раз на страницу — и предзагрузкой, пока человек
// в меню, и самим детектором; сорвавшаяся загрузка не залипает.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadPoseModel } from '../src/engine/pose';

afterEach(() => vi.unstubAllGlobals());

function fakeFetch(fail = 0) {
  let calls = 0;
  const fn = vi.fn(async () => {
    calls += 1;
    if (calls <= fail) throw new TypeError('network');
    return new Response(new Uint8Array([1, 2, 3]));
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

describe('модель позы: одна загрузка на страницу', () => {
  it('предзагрузка и детектор берут одну и ту же загрузку', async () => {
    const fetch = fakeFetch();
    const url = 'https://cdn.test/model-a.task';
    const [a, b] = await Promise.all([loadPoseModel(url), loadPoseModel(url)]);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect([...a]).toEqual([1, 2, 3]);
    expect(b).toBe(a);
  });

  it('сорвалась — следующая попытка качает заново, а не отдаёт старую ошибку', async () => {
    const fetch = fakeFetch(1);
    const url = 'https://cdn.test/model-b.task';
    await expect(loadPoseModel(url)).rejects.toThrow();
    await expect(loadPoseModel(url)).resolves.toHaveLength(3);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('HTTP-ошибка — это ошибка, а не «модель из 0 байт»', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('nope', { status: 404 })),
    );
    await expect(loadPoseModel('https://cdn.test/model-c.task')).rejects.toThrow(/404/);
  });
});
