// U-07: главное меню платформы. Два главных входа — тренировка и арена дуэлей — большими карточками,
// ниже режимы тренировки, ещё ниже — рейтинг, прогресс, калибровка.
// Без камеры — мышь и тач; с «Жестами» — удержание рукой (все карточки — DwellButton).

import { useEffect } from 'react';
import { EXERCISES } from '../../engine/types';
import { say } from '../audio/voice';
import { DwellButton } from '../components/dwell';
import { Ghost } from '../components/Ghost';
import { Icon, type IconName } from '../components/Icon';
import { order } from '../lib/motion';
import { formatDuration } from '../lib/results';
import { loadCoachPlan } from '../store/coach';
import { loadTotals } from '../store/progress';
import './Menu.css';

interface Props {
  onQuick: () => void;
  onPick: () => void;
  onChallenge: () => void;
  onCoach: () => void;
  onRecords: () => void;
  onRecalibrate: () => void;
  onProgress: () => void;
  /** Камера включена — подсказываем про курсор-руку. */
  hands?: boolean;
}

const DUEL_URL = `${import.meta.env.BASE_URL}duel.html`;

export function Menu({
  onQuick,
  onPick,
  onChallenge,
  onCoach,
  onRecords,
  onRecalibrate,
  onProgress,
  hands,
}: Props) {
  const totals = loadTotals();
  const coach = loadCoachPlan();

  useEffect(() => {
    if (hands) say('Подними руку и задержи курсор на кнопке');
  }, [hands]);

  const modes: { icon: IconName; title: string; sub: string; onSelect: () => void }[] = [
    { icon: 'list', title: 'Одно упражнение', sub: `Выбери из ${EXERCISES.length}`, onSelect: onPick },
    { icon: 'timer', title: 'Челлендж 60 секунд', sub: 'Максимум чистых за минуту', onSelect: onChallenge },
  ];
  const more: { icon: IconName; title: string; sub: string; onSelect: () => void }[] = [
    { icon: 'trophy', title: 'Рейтинг', sub: 'Сравни себя с другими', onSelect: onRecords },
    { icon: 'chart', title: 'Мой прогресс', sub: 'Рекорды, кубки, графики', onSelect: onProgress },
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
              : 'Выбери режим и начни прямо сейчас — камера включится, только когда начнёшь.'}
          </p>
        </header>

        {/* Главный вход — персональный план от ИИ: широкая карточка над тренировкой и ареной. */}
        <DwellButton className="menu__coach rise" style={order(1)} onSelect={onCoach}>
          <span className="menu__coach-text">
            <span className="menu__badge">ИИ-тренер</span>
            <b>{coach ? coach.title : 'Персональный план тренировок'}</b>
            <small>
              {coach
                ? `${coach.sessions.length} тренировки в неделю · 4 недели. Продолжай — нагрузка растёт вместе с тобой.`
                : 'Расскажи о цели, данных и здоровье — ИИ изучит анкету и соберёт план из безопасных для тебя упражнений.'}
            </small>
            <span className="menu__coach-steps" aria-hidden="true">
              <span>
                <Icon name="target" size={16} /> Цель
              </span>
              <span>
                <Icon name="user" size={16} /> Данные
              </span>
              <span>
                <Icon name="shield" size={16} /> Ограничения
              </span>
              <span>
                <Icon name="sparkle" size={16} /> План за 15 секунд
              </span>
            </span>
            <span className="menu__go">
              {coach ? 'Продолжить план' : 'Собрать план'} <Icon name="chevron" size={18} />
            </span>
          </span>
          <span className="menu__coach-art" aria-hidden="true">
            <Ghost exercise="calf_raise" still phase={0} yaw={-0.55} className="menu__coach-ghost" />
          </span>
        </DwellButton>

        <section className="menu__heroes">
          <DwellButton className="menu__hero rise" style={order(2)} onSelect={onQuick}>
            <span className="menu__hero-text">
              <span className="menu__badge">Рекомендуем</span>
              <b>Быстрая тренировка</b>
              <small>
                Приседания, отжимания и бёрпи · около 4 минут. Тренер считает повторы и подсказывает по
                технике.
              </small>
              <span className="menu__go">
                Начать <Icon name="chevron" size={18} />
              </span>
            </span>
            <span className="menu__hero-art" aria-hidden="true">
              <Ghost exercise="squat" still className="menu__hero-ghost" />
            </span>
          </DwellButton>

          <DwellButton
            className="menu__hero menu__hero--arena rise"
            style={order(3)}
            onSelect={() => window.location.assign(DUEL_URL)}
          >
            <span className="menu__hero-text">
              <span className="menu__badge menu__badge--arena">Онлайн</span>
              <b>Арена дуэлей</b>
              <small>Сразись с соперником на скорость и чистоту. Кубки, титулы и рамки за победы.</small>
              <span className="menu__formats" aria-label="Форматы">
                <span>Пуля 30 с</span>
                <span>Блиц 1 мин</span>
                <span>Рапид 3 мин</span>
              </span>
              <span className="menu__go menu__go--light">
                <Icon name="users" size={18} /> Найти соперника
              </span>
            </span>
            <span className="menu__hero-art menu__versus" aria-hidden="true">
              <Ghost exercise="boxing" still yaw={-1.7} className="menu__fighter menu__fighter--a" />
              {/* Второй боец — зеркало первого: стоят лицом друг к другу. */}
              <Ghost exercise="boxing" still yaw={-1.7} className="menu__fighter menu__fighter--b" />
              <i>VS</i>
            </span>
          </DwellButton>
        </section>

        <nav className="menu__modes" aria-label="Режимы тренировки">
          {modes.map((t, i) => (
            <DwellButton key={t.title} className="menu__row rise" style={order(i + 4)} onSelect={t.onSelect}>
              <span className="menu__icon">
                <Icon name={t.icon} size={22} />
              </span>
              <span className="menu__text">
                <b>{t.title}</b>
                <small>{t.sub}</small>
              </span>
              <Icon name="chevron" size={18} className="menu__chev" />
            </DwellButton>
          ))}
        </nav>

        <nav className="menu__more" aria-label="Ещё">
          {more.map((t, i) => (
            <DwellButton
              key={t.title}
              className="menu__row menu__row--small rise"
              style={order(i + 6)}
              onSelect={t.onSelect}
            >
              <span className="menu__icon">
                <Icon name={t.icon} size={20} />
              </span>
              <span className="menu__text">
                <b>{t.title}</b>
                <small>{t.sub}</small>
              </span>
            </DwellButton>
          ))}
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
