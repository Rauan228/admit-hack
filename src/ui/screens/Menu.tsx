// U-07: главное меню платформы. Сверху — большая карточка «Быстрая тренировка» с атлетом, ниже — режимы.
// Без камеры — мышь и тач; с «Жестами» — удержание рукой (все карточки — DwellButton).

import { useEffect } from 'react';
import { EXERCISES } from '../../engine/types';
import { say } from '../audio/voice';
import { DwellButton } from '../components/dwell';
import { Ghost } from '../components/Ghost';
import { Icon, type IconName } from '../components/Icon';
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
  /** Камера включена — подсказываем про курсор-руку. */
  hands?: boolean;
}

const DUEL_URL = `${import.meta.env.BASE_URL}duel.html`;

export function Menu({ onQuick, onPick, onChallenge, onRecords, onRecalibrate, onProgress, hands }: Props) {
  const totals = loadTotals();

  useEffect(() => {
    if (hands) say('Подними руку и задержи курсор на кнопке');
  }, [hands]);

  const tiles: { icon: IconName; title: string; sub: string; onSelect: () => void }[] = [
    { icon: 'list', title: 'Одно упражнение', sub: `${EXERCISES.length} на выбор`, onSelect: onPick },
    { icon: 'timer', title: 'Челлендж 60 с', sub: 'Максимум чистых приседаний', onSelect: onChallenge },
    { icon: 'trophy', title: 'Рейтинг', sub: 'Сегодня, неделя, всё время', onSelect: onRecords },
    { icon: 'chart', title: 'Мой прогресс', sub: 'Рекорды и графики', onSelect: onProgress },
    { icon: 'scan', title: 'Калибровка', sub: 'Видно ли тебя целиком', onSelect: onRecalibrate },
  ];

  return (
    <main className="page menu">
      <div className="page__inner">
        <header className="page__head menu__head rise" style={order(0)}>
          <h1 className="page__title">Что тренируем?</h1>
          <p className="page__sub">
            {hands
              ? 'Подними руку — появится курсор. Задержи его на карточке, пока она не заполнится.'
              : 'Камера включится, только когда начнёшь подход.'}
          </p>
        </header>

        <DwellButton className="menu__hero rise" style={order(1)} onSelect={onQuick}>
          <span className="menu__hero-text">
            <span className="menu__badge">Рекомендуем</span>
            <b>Быстрая тренировка</b>
            <small>Присед, звёздочка и выпады — около 3 минут. Тренер подскажет по технике.</small>
            <span className="menu__go">
              Начать <Icon name="chevron" size={18} />
            </span>
          </span>
          <span className="menu__hero-art" aria-hidden="true">
            <Ghost exercise="squat" still className="menu__hero-ghost" />
          </span>
        </DwellButton>

        <nav className="menu__grid" aria-label="Режимы">
          {tiles.map((t, i) => (
            <DwellButton key={t.title} className="menu__tile rise" style={order(i + 2)} onSelect={t.onSelect}>
              <span className="menu__icon">
                <Icon name={t.icon} size={22} />
              </span>
              <span className="menu__text">
                <b>{t.title}</b>
                <small>{t.sub}</small>
              </span>
            </DwellButton>
          ))}
          <a className="btn menu__tile rise" style={order(7)} href={DUEL_URL}>
            <span className="menu__icon">
              <Icon name="users" size={22} />
            </span>
            <span className="menu__text">
              <b>Арена дуэлей</b>
              <small>Пуля, блиц и рапид</small>
            </span>
          </a>
        </nav>

        {totals.workouts > 0 && (
          <section className="menu__stats rise" style={order(8)} aria-label="Твой прогресс">
            <div>
              <b>{totals.workouts}</b>
              <small>тренировок</small>
            </div>
            <div>
              <b>{totals.reps}</b>
              <small>повторений</small>
            </div>
            <div>
              <b>{totals.cleanReps}</b>
              <small>чистых</small>
            </div>
            <div>
              <b>{formatDuration(totals.seconds)}</b>
              <small>в движении</small>
            </div>
          </section>
        )}
      </div>
    </main>
  );
}
