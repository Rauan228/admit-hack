// U-07: главное меню — только крупные кнопки с выбором удержанием.

import { useEffect } from 'react';
import { EXERCISES } from '../../engine/types';
import { say } from '../audio/voice';
import { DwellButton } from '../components/dwell';
import { Icon } from '../components/Icon';
import { order } from '../lib/motion';
import { formatDuration } from '../lib/results';
import { loadTotals } from '../store/progress';
import './Menu.css';

interface Props {
  onQuick: () => void;
  onPick: () => void;
  onChallenge: () => void;
  onRecords: () => void;
  onRecalibrate: () => void;
  onProgress: () => void;
}

export function Menu({ onQuick, onPick, onChallenge, onRecords, onRecalibrate, onProgress }: Props) {
  const totals = loadTotals();

  useEffect(() => {
    say('Подними руку и задержи курсор на кнопке');
  }, []);

  return (
    <main className="screen menu">
      <header className="menu__head">
        <h1 className="menu__title rise" style={order(0)}>
          Что тренируем?
        </h1>
        <p className="menu__how">
          <Icon name="hand" size={26} className="primary" />
          Подними руку — появится курсор. Задержи его на кнопке, пока она не заполнится.
        </p>
      </header>

      <nav className="menu__grid" aria-label="Главное меню">
        <DwellButton
          variant="primary"
          size="lg"
          style={order(1)}
          className="rise menu__tile menu__tile--hero"
          onSelect={onQuick}
        >
          <Icon name="play" size={40} />
          <span className="menu__tile-text">
            <b>Быстрая тренировка</b>
            <small>Присед · Звёздочка · Выпады · ~3 мин</small>
          </span>
        </DwellButton>
        <DwellButton size="lg" style={order(2)} className="rise menu__tile" onSelect={onPick}>
          <Icon name="list" size={36} />
          <span className="menu__tile-text">
            <b>Одно упражнение</b>
            <small>{EXERCISES.length} на выбор · 4 категории</small>
          </span>
        </DwellButton>
        <DwellButton size="lg" style={order(3)} className="rise menu__tile" onSelect={onChallenge}>
          <Icon name="timer" size={36} />
          <span className="menu__tile-text">
            <b>Челлендж 60 с</b>
            <small>Максимум чистых приседаний</small>
          </span>
        </DwellButton>
        <DwellButton size="lg" style={order(4)} className="rise menu__tile" onSelect={onRecords}>
          <Icon name="trophy" size={36} />
          <span className="menu__tile-text">
            <b>Рейтинг</b>
            <small>Сегодня · неделя · всё время</small>
          </span>
        </DwellButton>
        <DwellButton
          size="lg"
          variant="ghost"
          style={order(5)}
          className="rise menu__tile"
          onSelect={onRecalibrate}
        >
          <Icon name="user" size={36} />
          <span className="menu__tile-text">
            <b>Калибровка</b>
            <small>Проверить, видно ли тебя целиком</small>
          </span>
        </DwellButton>
      </nav>

      <footer className="menu__foot">
        {totals.workouts > 0 ? (
          <p className="muted">
            Твой прогресс: {totals.workouts} трен. · {totals.reps} повт. · {totals.cleanReps} чистых ·{' '}
            {formatDuration(totals.seconds)} в движении
          </p>
        ) : (
          <p className="muted">Первая тренировка? Начни с быстрой — тренер всё подскажет.</p>
        )}
        <DwellButton size="sm" variant="ghost" onSelect={onProgress}>
          <Icon name="zap" size={22} /> Мой прогресс
        </DwellButton>
      </footer>
    </main>
  );
}
