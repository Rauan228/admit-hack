import { EXERCISES } from '../engine/types';

// Заглушка: экраны появятся в задачах U-02…U-10 (brain/tasks/BOARD.md).
export function App() {
  const mock = new URLSearchParams(location.search).has('mock');
  return (
    <main className="boot">
      <h1>FORMA</h1>
      <p>AI-тренер, которому не нужны руки.</p>
      <p className="muted">
        Каркас запущен · движок: {mock ? 'mock' : 'real'} · упражнения: {EXERCISES.join(', ')}
      </p>
    </main>
  );
}
