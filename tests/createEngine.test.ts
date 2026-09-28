import { createEngine, isMockRequested } from '../src/engine/createEngine';
import { CameraError } from '../src/engine/camera';

describe('фабрика движка', () => {
  it('понимает флаг ?mock в URL', () => {
    expect(isMockRequested('?mock=1')).toBe(true);
    expect(isMockRequested('?mock')).toBe(true);
    expect(isMockRequested('?mock=true')).toBe(true);
    expect(isMockRequested('?mock=0')).toBe(false);
    expect(isMockRequested('?mock=false')).toBe(false);
    expect(isMockRequested('')).toBe(false);
    expect(isMockRequested('?other=1')).toBe(false);
  });

  it('с ?mock=1 отдаёт движок, который шлёт события без камеры', async () => {
    const engine = await createEngine({ search: '?mock=1' });
    expect(typeof engine.start).toBe('function');
    expect(typeof engine.setMode).toBe('function');

    const seen: string[] = [];
    const off = engine.on((e) => seen.push(e.type));
    await engine.start({} as HTMLVideoElement);
    await new Promise((r) => setTimeout(r, 120));
    engine.stop();
    off();
    expect(seen).toContain('frame');
  });

  it('без флага отдаёт реальный движок, который идёт за камерой', async () => {
    const engine = await createEngine({ search: '' });
    // В Node камеры нет: реальный движок честно отвечает понятной ошибкой, а не молчит.
    await expect(engine.start({} as HTMLVideoElement)).rejects.toBeInstanceOf(CameraError);
    engine.stop();
  });
});
