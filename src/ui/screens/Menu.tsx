// U-07: главное меню платформы. Сверху на всю ширину — персональный план от ИИ (что сегодня, прогресс по
// неделям), под ним три главных входа: тренировка, арена дуэлей, бокс с ботом. Ниже — режимы, рейтинг,
// прогресс, калибровка, общая статистика и серия дней.
// Без камеры — мышь и тач; с «Жестами» — удержание рукой (все карточки — DwellButton).

import { useEffect, type CSSProperties } from 'react';
import { EXERCISES, type ExerciseId } from '../../engine/types';
import { PROGRAM_WEEKS, type CoachPlan } from '../../shared/coach';
import { say } from '../audio/voice';
import { DwellButton } from '../components/dwell';
import { ExerciseThumb } from '../components/ExerciseThumb';
import { Ghost } from '../components/Ghost';
import { Icon, type IconName } from '../components/Icon';
import { WEEKDAYS, sessionLevel, sessionWeekdays, todayIndex, weekOf } from '../lib/coachPlan';
import { order } from '../lib/motion';
import { formatDuration } from '../lib/results';
import { isDone, loadCoachPlan, loadHistory } from '../store/coach';
import { loadTotals, loadTrainedDays, trainingStreak } from '../store/progress';
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
const FIGHT_URL = `${import.meta.env.BASE_URL}fight.html`;
const BOXING_ART = `${import.meta.env.BASE_URL}art/boxing-fpv.jpg`;
/** Быстрая тренировка — эти упражнения и показываем в карточке. */
const QUICK_THUMBS: ExerciseId[] = ['push_up', 'squat', 'burpee', 'lunge'];

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
  const streak = trainingStreak(loadTrainedDays());

  useEffect(() => {
    if (hands) say('Подними руку и задержи курсор на кнопке');
  }, [hands]);

  const modes: { icon: IconName; title: string; sub: string; onSelect: () => void }[] = [
    { icon: 'list', title: 'Одно упражнение', sub: `Выбери из ${EXERCISES.length}`, onSelect: onPick },
    { icon: 'timer', title: 'Челлендж 60 секунд', sub: 'Максимум чистых повторений', onSelect: onChallenge },
  ];
  const more: { icon: IconName; title: string; sub: string; onSelect: () => void }[] = [
    { icon: 'trophy', title: 'Рейтинг', sub: 'Сравни себя с другими', onSelect: onRecords },
    { icon: 'chart', title: 'Мой прогресс', sub: 'Рекорды, кубки, графики', onSelect: onProgress },
    { icon: 'scan', title: 'Калибровка', sub: 'Проверим, как ты двигаешься', onSelect: onRecalibrate },
  ];
  const cleanPct = totals.reps > 0 ? Math.round((totals.cleanReps / totals.reps) * 100) : 0;

  return (
    <main className="page menu">
      <div className="page__inner menu__inner">
        <header className="page__head menu__head rise" style={order(0)}>
          <h1 className="page__title">Что тренируем?</h1>
          <p className="page__sub">
            {hands
              ? 'Подними руку — появится курсор. Задержи его на карточке, пока она не заполнится.'
              : 'Выбери режим и начни прямо сейчас — камера включится, только когда начнёшь.'}
          </p>
        </header>

        <CoachCard plan={coach} onSelect={onCoach} />

        {/* Три главных входа. */}
        <section className="menu__trio" aria-label="Главное">
          <DwellButton className="menu__card rise" style={order(2)} onSelect={onQuick}>
            <span className="menu__card-head">
              <b>Тренировка</b>
              <small>
                Приседания, отжимания и бёрпи · около 4 минут. Тренер считает повторы и следит за техникой.
              </small>
            </span>
            <span className="menu__card-art menu__card-art--train" aria-hidden="true">
              <ExerciseThumb exercise="push_up" className="menu__train-ghost" />
            </span>
            <span className="menu__thumbs" aria-hidden="true">
              {QUICK_THUMBS.map((ex, i) => (
                <span key={ex} className={`menu__thumb ${i === 0 ? 'is-on' : ''}`}>
                  <ExerciseThumb exercise={ex} />
                </span>
              ))}
            </span>
            <span className="menu__go menu__go--wide">
              Начать тренировку <Icon name="chevron" size={18} />
            </span>
          </DwellButton>

          <DwellButton
            className="menu__card menu__card--arena rise"
            style={order(3)}
            onSelect={() => window.location.assign(DUEL_URL)}
          >
            <span className="menu__card-head">
              <span className="menu__badge menu__badge--arena">Онлайн</span>
              <b>Арена дуэлей</b>
              <small>Сразись с реальными людьми на скорость и чистоту. Кубки, титулы и рейтинг.</small>
            </span>
            <span className="menu__card-art menu__versus" aria-hidden="true">
              <Ghost exercise="boxing" still yaw={-1.7} className="menu__fighter menu__fighter--a" />
              {/* Второй боец — зеркало первого: стоят лицом друг к другу. */}
              <Ghost exercise="boxing" still yaw={-1.7} className="menu__fighter menu__fighter--b" />
              <i>VS</i>
            </span>
            <span className="menu__formats" aria-label="Форматы">
              <span>
                <b>Пуля</b>30 с
              </span>
              <span>
                <b>Блиц</b>1 мин
              </span>
              <span>
                <b>Рапид</b>3 мин
              </span>
            </span>
            <span className="menu__go menu__go--light menu__go--wide">
              Найти соперника <Icon name="chevron" size={18} />
            </span>
          </DwellButton>

          <DwellButton
            className="menu__card menu__card--box rise"
            style={order(4)}
            onSelect={() => window.location.assign(FIGHT_URL)}
          >
            <span className="menu__card-art menu__card-art--box" aria-hidden="true">
              <img src={BOXING_ART} alt="" loading="lazy" decoding="async" />
            </span>
            <span className="menu__card-head">
              <span className="menu__badge">3D</span>
              <b>Бокс с ботом</b>
              <small>Дерись движениями своего тела: бей, закрывайся и уклоняйся — от первого лица.</small>
            </span>
            <span className="menu__chips">
              <span>
                <Icon name="zap" size={14} /> Реалистичный бой
              </span>
              <span>
                <Icon name="timer" size={14} /> Раунды по 45 с
              </span>
              <span>
                <Icon name="shield" size={14} /> Следит за техникой
              </span>
            </span>
            <span className="menu__go menu__go--wide">
              Выйти на ринг <Icon name="chevron" size={18} />
            </span>
          </DwellButton>
        </section>

        <nav className="menu__modes" aria-label="Режимы тренировки">
          {modes.map((t, i) => (
            <DwellButton key={t.title} className="menu__row rise" style={order(i + 5)} onSelect={t.onSelect}>
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
              style={order(i + 7)}
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

        <section className="menu__summary rise" style={order(10)}>
          <div className="menu__stats" aria-label="Общая статистика">
            <h2>Общая статистика</h2>
            <dl>
              <div>
                <dd>{totals.workouts}</dd>
                <dt>тренировок</dt>
              </div>
              <div>
                <dd>{totals.reps}</dd>
                <dt>повторов</dt>
              </div>
              <div>
                <dd>{cleanPct}%</dd>
                <dt>чистых повторов</dt>
              </div>
              <div>
                <dd>{formatDuration(totals.seconds)}</dd>
                <dt>в движении</dt>
              </div>
            </dl>
          </div>
          <div className="menu__streak" aria-label="Текущая серия">
            <h2>Текущая серия</h2>
            <p className="menu__streak-num">
              <Icon name="flame" size={30} />
              <b>
                {streak.days} {daysWord(streak.days)}
              </b>
            </p>
            <ol className="menu__week">
              {WEEKDAYS.map((d, i) => (
                <li key={d} className={streak.week[i] ? 'is-on' : ''}>
                  <i aria-hidden="true" />
                  {d}
                </li>
              ))}
            </ol>
          </div>
        </section>

        <DwellButton className="menu__cta rise" style={order(11)} onSelect={onChallenge}>
          <span className="menu__cta-icon" aria-hidden="true">
            <Icon name="zap" size={30} />
          </span>
          <span className="menu__text">
            <b>Готов к новому вызову?</b>
            <small>Пройди челлендж 60 секунд и попади в рейтинг.</small>
          </span>
          <span className="menu__cta-go">
            Начать челлендж <Icon name="chevron" size={18} />
          </span>
        </DwellButton>
      </div>
    </main>
  );
}

/** ИИ-план на всю ширину: что сегодня, длительность, сложность — и справа прогресс программы. */
function CoachCard({ plan, onSelect }: { plan: CoachPlan | null; onSelect: () => void }) {
  const info = plan ? planInfo(plan) : null;
  return (
    <DwellButton className="menu__coach rise" style={order(1)} onSelect={onSelect}>
      <span className="menu__coach-text">
        <span className="menu__badge">ИИ-тренер</span>
        <b>{plan ? plan.title : 'Персональный план тренировок'}</b>
        <small>
          {info
            ? `Твой персональный план. Неделя ${info.week} из ${PROGRAM_WEEKS}.`
            : 'Расскажи о цели, данных и здоровье — ИИ соберёт план из безопасных для тебя упражнений.'}
        </small>
        <span className="menu__facts">
          {info ? (
            <>
              <Fact icon="calendar" title={info.dayLabel} sub={info.focus} />
              <Fact icon="timer" title={`~ ${info.minutes} мин`} sub="Длительность" />
              <Fact icon="chart" title={info.level} sub="Сложность" />
            </>
          ) : (
            <>
              <Fact icon="target" title="Цель" sub="и уровень" />
              <Fact icon="shield" title="Ограничения" sub="травмы учтём" />
              <Fact icon="sparkle" title="15 секунд" sub="на план" />
            </>
          )}
        </span>
        <span className="menu__go">
          {plan ? 'Продолжить план' : 'Собрать план'} <Icon name="chevron" size={18} />
        </span>
      </span>
      <span className="menu__coach-art" aria-hidden="true">
        <Ghost exercise="lunge" still phase={0.19} yaw={-0.75} className="menu__coach-ghost" />
      </span>
      <span className="menu__panel">
        <b className="menu__panel-title">{info ? 'Твой прогресс' : 'План на 4 недели'}</b>
        <span className="menu__ring" style={{ '--p': info?.pct ?? 100 } as CSSProperties}>
          <svg viewBox="0 0 120 120" aria-hidden="true">
            <circle cx="60" cy="60" r="52" />
            <circle cx="60" cy="60" r="52" pathLength={100} />
          </svg>
          <b>{info ? `${info.pct}%` : '4'}</b>
        </span>
        <small className="menu__panel-sub">
          {info ? `${info.done} из ${info.total} тренировок` : 'недели, нагрузка растёт'}
        </small>
        <span className="menu__panel-list">
          {info ? (
            <>
              <PanelRow icon="calendar" value={info.done} label="тренировок" />
              <PanelRow icon="zap" value={info.reps} label="повторов" />
              <PanelRow icon="check" value={`${info.clean}%`} label="чистых" />
            </>
          ) : (
            <>
              <PanelRow icon="user" value="Рост, вес" label="и возраст" />
              <PanelRow icon="heart" value="Здоровье" label="и травмы" />
              <PanelRow icon="dumbbell" value="Турник" label="если есть" />
            </>
          )}
        </span>
      </span>
    </DwellButton>
  );
}

function Fact({ icon, title, sub }: { icon: IconName; title: string; sub: string }) {
  return (
    <span className="menu__fact">
      <Icon name={icon} size={24} />
      <span>
        <b>{title}</b>
        <small>{sub}</small>
      </span>
    </span>
  );
}

function PanelRow({ icon, value, label }: { icon: IconName; value: string | number; label: string }) {
  return (
    <span className="menu__panel-row">
      <Icon name={icon} size={18} />
      <b>{value}</b> {label}
    </span>
  );
}

/** Что показать про план: ближайшая невыполненная тренировка этой недели и прогресс программы. */
function planInfo(plan: CoachPlan) {
  const week = weekOf(plan);
  const history = loadHistory(plan);
  const days = sessionWeekdays(plan);
  const today = todayIndex();
  const open = plan.sessions.map((_, i) => i).filter((i) => !isDone(history, week, i));
  const next =
    open.find((i) => days[i] === today) ??
    open.find((i) => (days[i] ?? 0) > today) ??
    open[0] ??
    plan.sessions.findIndex((_, i) => days[i] === today);
  const s = plan.sessions[Math.max(0, next)] ?? plan.sessions[0]!;
  const day = days[Math.max(0, next)] ?? today;
  const total = plan.sessions.length * PROGRAM_WEEKS;
  const done = history.length;
  const reps = history.reduce((a, h) => a + h.reps, 0);
  const clean = reps > 0 ? Math.round((history.reduce((a, h) => a + h.cleanReps, 0) / reps) * 100) : 0;
  return {
    week,
    dayLabel: day === today ? 'Сегодня' : WEEKDAYS[day]!,
    focus: s.focus || s.title,
    minutes: s.minutes,
    level: sessionLevel(s),
    total,
    done,
    pct: total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0,
    reps,
    clean,
  };
}

function daysWord(n: number): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return 'день';
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return 'дня';
  return 'дней';
}
