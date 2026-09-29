// U-07: выбор одного упражнения. «Обе руки вверх» — назад (обрабатывает App).

import { EXERCISES, type ExerciseId } from '../../engine/types';
import { DwellButton } from '../components/dwell';
import { Ghost } from '../components/Ghost';
import { Icon } from '../components/Icon';
import { MUSCLE_NAMES } from '../lib/athlete';
import { EXERCISE_META } from '../lib/exercises';
import { order } from '../lib/motion';
import { bestFor } from '../store/progress';
import './Menu.css';
import './Picker.css';

export function Picker({ onPick, onBack }: { onPick: (e: ExerciseId) => void; onBack: () => void }) {
  return (
    <main className="screen menu">
      <header className="menu__head">
        <h1 className="menu__title rise" style={order(0)}>
          Выбери упражнение
        </h1>
        <p className="menu__how">
          <Icon name="back" size={24} className="primary" /> Обе руки над головой — назад
        </p>
      </header>

      <nav className="picker__grid" aria-label="Упражнения">
        {EXERCISES.map((ex, i) => {
          const meta = EXERCISE_META[ex];
          const best = bestFor(meta.title);
          return (
            <DwellButton
              key={ex}
              size="lg"
              className="picker__tile rise"
              style={order(i + 1)}
              onSelect={() => onPick(ex)}
            >
              <Ghost exercise={ex} className="picker__ghost" />
              <span className="menu__tile-text">
                <b>{meta.title}</b>
                <small>{best ? `Рекорд: ${best.points} очк.` : MUSCLE_NAMES[ex].join(' · ')}</small>
              </span>
            </DwellButton>
          );
        })}
      </nav>

      <footer className="menu__foot">
        <DwellButton size="sm" variant="ghost" onSelect={onBack}>
          <Icon name="back" size={22} /> Назад
        </DwellButton>
      </footer>
    </main>
  );
}
