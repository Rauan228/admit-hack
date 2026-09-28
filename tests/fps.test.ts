import { FpsCounter } from '../src/engine/fps';

describe('FpsCounter', () => {
  it('на ровных 30 кадрах в секунду показывает 30', () => {
    const fps = new FpsCounter(1000);
    let value = 0;
    for (let i = 0; i <= 60; i++) value = fps.tick(i * (1000 / 30));
    expect(value).toBe(30);
  });

  it('первый кадр даёт 0, а не бесконечность', () => {
    expect(new FpsCounter().tick(123)).toBe(0);
  });

  it('старые кадры выпадают из окна: после паузы FPS падает', () => {
    const fps = new FpsCounter(1000);
    for (let i = 0; i < 30; i++) fps.tick(i * 33);
    // Пауза 2 с, затем два кадра через 100 мс → 10 FPS.
    fps.tick(3000);
    expect(fps.tick(3100)).toBe(10);
  });

  it('reset очищает историю', () => {
    const fps = new FpsCounter(1000);
    fps.tick(0);
    fps.tick(50);
    fps.reset();
    expect(fps.tick(100)).toBe(0);
  });
});
