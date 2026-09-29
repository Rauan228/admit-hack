// U-13: таблица рекордов (топ-10) и общий прогресс, всё из localStorage.

import { DwellButton } from '../components/dwell';
import { Icon } from '../components/Icon';
import { formatDuration } from '../lib/results';
import { loadRecords, loadTotals } from '../store/progress';
import './Leaderboard.css';

export function Leaderboard({ highlight, onBack }: { highlight?: string; onBack: () => void }) {
  const records = loadRecords();
  const totals = loadTotals();

  return (
    <main className="screen board">
      <header className="board__head">
        <h1 className="board__title">Рекорды</h1>
        <p className="muted">Очки = сумма оценок всех повторений: важны и количество, и техника.</p>
      </header>

      <section className="board__totals" aria-label="Прогресс">
        <span>
          <b>{totals.workouts}</b> тренировок
        </span>
        <span>
          <b>{totals.reps}</b> повторений
        </span>
        <span>
          <b>{totals.reps ? Math.round((totals.cleanReps / totals.reps) * 100) : 0}%</b> чистых
        </span>
        <span>
          <b>{formatDuration(totals.seconds)}</b> в движении
        </span>
      </section>

      {records.length === 0 ? (
        <div className="card board__empty">
          <Icon name="trophy" size={44} className="primary" />
          <p>Пока пусто. Заверши тренировку — и твой результат появится здесь.</p>
        </div>
      ) : (
        <ol className="board__list">
          {records.map((r, i) => (
            <li key={r.id} className={`board__row ${r.id === highlight ? 'is-me' : ''}`}>
              <span className="board__place">{i + 1}</span>
              <span className="board__name">
                <b>{r.name}</b>
                <small className="muted">
                  {r.label} · {new Date(r.date).toLocaleDateString('ru-RU')}
                </small>
              </span>
              <span className="board__meta muted">
                {r.reps} повт · {r.reps ? Math.round((r.cleanReps / r.reps) * 100) : 0}% чистых
              </span>
              <span className="board__points">{r.points}</span>
            </li>
          ))}
        </ol>
      )}

      <footer className="menu__foot">
        <DwellButton size="lg" onSelect={onBack}>
          <Icon name="back" size={28} /> В меню
        </DwellButton>
        <p className="muted">Обе руки над головой — назад</p>
      </footer>
    </main>
  );
}
