// U-13: общий рейтинг (сервер). Три режима — у каждого своя честная метрика (src/shared/rating.ts),
// у «Одного упражнения» — доска на каждое упражнение; периоды «сегодня / неделя / всё время».
// Всё выбирается и рукой (удержание), и мышью; «обе руки вверх» — назад в меню.

import { useEffect, useState } from 'react';
import {
  RATED_EXERCISES,
  CHALLENGE_EXERCISES,
  boardExercise,
  boardKind,
  challengeBoard,
  challengeExercise,
  type Board,
  type RatedExercise,
} from '../../shared/rating';
import { DwellButton } from '../components/dwell';
import { Icon } from '../components/Icon';
import { EXERCISE_META } from '../lib/exercises';
import { order } from '../lib/motion';
import { boardUnit } from '../lib/rating';
import { formatDuration } from '../lib/results';
import { ApiError, fetchBoard, useAuth, type BoardData, type BoardRow, type Period } from '../store/api';
import './Leaderboard.css';

const KINDS: { kind: 'quick' | 'single' | 'challenge'; label: string; icon: 'play' | 'list' | 'timer' }[] = [
  { kind: 'quick', label: 'Быстрая', icon: 'play' },
  { kind: 'single', label: 'Одно упражнение', icon: 'list' },
  { kind: 'challenge', label: 'Челлендж 60 с', icon: 'timer' },
];

const PERIODS: { id: Period; label: string }[] = [
  { id: 'day', label: 'Сегодня' },
  { id: 'week', label: 'Неделя' },
  { id: 'all', label: 'Всё время' },
];

export function Leaderboard({
  initialBoard = 'quick',
  onBack,
  onSignIn,
}: {
  initialBoard?: Board;
  onBack: () => void;
  onSignIn: () => void;
}) {
  const { user } = useAuth();
  const [board, setBoard] = useState<Board>(initialBoard);
  const [period, setPeriod] = useState<Period>('all');
  const [data, setData] = useState<{ key: string; d: BoardData } | { key: string; error: string } | null>(
    null,
  );
  const [retry, setRetry] = useState(0);
  const key = `${board}|${period}|${user?.id ?? 0}|${retry}`;

  useEffect(() => {
    let alive = true;
    fetchBoard(board, period)
      .then((d) => alive && setData({ key, d }))
      .catch(
        (e) =>
          alive && setData({ key, error: e instanceof ApiError ? e.message : 'Не получилось загрузить' }),
      );
    return () => {
      alive = false;
    };
  }, [board, period, key]);

  const kind = boardKind(board);
  const exercise = boardExercise(board);
  const challengeEx = challengeExercise(board);
  const unit = boardUnit(board);
  const loading = !data || data.key !== key;
  const d = !loading && data && 'd' in data ? data.d : null;
  const error = !loading && data && 'error' in data ? data.error : null;
  const meOutside = d?.me && !d.rows.some((r) => r.me) ? d.me : null;

  return (
    <main className="page board">
      <div className="page__inner">
        <header className="page__head board__head rise" style={order(0)}>
          <DwellButton className="board__back" onSelect={onBack}>
            <Icon name="back" size={16} /> В меню
          </DwellButton>
          <div className="board__title-row">
            <div className="board__title-text">
              <h1 className="page__title">Рейтинг FORMA</h1>
              <p className="page__sub">{d ? d.rule : 'Кто сильнее — и чище'}</p>
            </div>
            {!user && (
              <DwellButton size="sm" variant="ghost" className="board__signin" onSelect={onSignIn}>
                <Icon name="user" size={18} /> Войти
              </DwellButton>
            )}
          </div>
        </header>

        <div className="board__controls">
          <nav className="pills board__pills" aria-label="Режим">
            {KINDS.map((k) => (
              <DwellButton
                key={k.kind}
                className={`pill board__pill ${kind === k.kind ? 'is-active' : ''}`}
                onSelect={() =>
                  setBoard(
                    k.kind === 'single'
                      ? `single:${exercise ?? challengeEx ?? 'squat'}`
                      : k.kind === 'challenge'
                        ? challengeBoard(
                            challengeEx ?? (exercise && exercise !== 'plank' ? exercise : 'squat'),
                          )
                        : k.kind,
                  )
                }
              >
                <Icon name={k.icon} size={16} className="board__pill-icon" /> {k.label}
              </DwellButton>
            ))}
          </nav>
          <nav className="pills board__pills board__periods" aria-label="Период">
            {PERIODS.map((p) => (
              <DwellButton
                key={p.id}
                className={`pill board__pill ${period === p.id ? 'is-active' : ''}`}
                onSelect={() => setPeriod(p.id)}
              >
                {p.label}
              </DwellButton>
            ))}
          </nav>
        </div>

        {kind === 'challenge' && (
          <nav className="pills board__pills board__chips" aria-label="Упражнение челленджа">
            {CHALLENGE_EXERCISES.map((ex) => (
              <DwellButton
                key={ex}
                className={`pill board__pill board__chip ${challengeEx === ex ? 'is-active' : ''}`}
                onSelect={() => setBoard(challengeBoard(ex))}
              >
                {EXERCISE_META[ex].title}
              </DwellButton>
            ))}
          </nav>
        )}
        {kind === 'single' && (
          <nav className="pills board__pills board__chips" aria-label="Упражнение">
            {RATED_EXERCISES.map((ex: RatedExercise) => (
              <DwellButton
                key={ex}
                className={`pill board__pill board__chip ${exercise === ex ? 'is-active' : ''}`}
                onSelect={() => setBoard(`single:${ex}`)}
              >
                {EXERCISE_META[ex].title}
              </DwellButton>
            ))}
          </nav>
        )}

        <section className="board__table">
          {(loading || (d && d.rows.length > 0)) && (
            <div className="board__thead" aria-hidden="true">
              <span>Место</span>
              <span>Игрок</span>
              <span>Результат</span>
              <span className="board__th-rating">Рейтинг</span>
            </div>
          )}

          {loading && (
            <ol className="board__list" aria-busy="true">
              {[0, 1, 2, 3, 4].map((i) => (
                <li key={i} className="board__row board__row--skeleton">
                  <span />
                  <span />
                  <span />
                </li>
              ))}
            </ol>
          )}

          {error && (
            <div className="board__state board__state--error">
              <span className="board__state-icon">
                <Icon name="alert" size={24} />
              </span>
              <b>{error}</b>
              <p>Проверь соединение и попробуй ещё раз.</p>
              <DwellButton size="sm" onSelect={() => setRetry((n) => n + 1)}>
                <Icon name="retry" size={18} /> Обновить
              </DwellButton>
            </div>
          )}

          {d && d.rows.length === 0 && (
            <div className="board__state">
              <span className="board__state-icon">
                <Icon name="trophy" size={24} />
              </span>
              <b>{period === 'all' ? 'Здесь пока никого.' : 'За этот период результатов ещё нет.'}</b>
              <p>Пройди тренировку и сохрани результат — место №1 свободно.</p>
            </div>
          )}

          {d && d.rows.length > 0 && (
            <ol className="board__list">
              {d.rows.map((r, i) => (
                <Row key={`${r.rank}-${r.nick}`} r={r} unit={unit} kind={kind} i={i} />
              ))}
              {meOutside && (
                <>
                  <li className="board__gap" aria-hidden="true">
                    ···
                  </li>
                  <Row r={meOutside} unit={unit} kind={kind} i={d.rows.length} />
                </>
              )}
            </ol>
          )}
        </section>

        {d && (
          <div className="board__strip">
            {d.me ? (
              <p>
                Твоё место: <b>{d.me.rank}</b> из {d.players}
              </p>
            ) : (
              <p>
                Игроков на доске: <b>{d.players}</b>
                {!user && ' · Войди, чтобы попасть в рейтинг'}
              </p>
            )}
            <span className="board__strip-hint">Обе руки над головой — назад</span>
          </div>
        )}
      </div>
    </main>
  );
}

function Row({ r, unit, kind, i }: { r: BoardRow; unit: string; kind: string; i: number }) {
  const cleanPct = r.reps ? Math.round((r.cleanReps / r.reps) * 100) : 0;
  return (
    <li
      className={`board__row rise ${r.me ? 'is-me' : ''} ${r.rank <= 3 ? `is-top is-top${r.rank}` : ''}`}
      style={order(i + 1)}
    >
      <span className="board__place">{r.rank}</span>
      <span className="board__who">
        <span className="board__avatar" aria-hidden="true">
          {r.nick.slice(0, 1).toUpperCase()}
        </span>
        <span className="board__name">
          <b>
            <span className="board__nick">{r.nick}</span>
            {r.me && <em className="board__you">Ты</em>}
          </b>
          <small>{new Date(r.createdAt).toLocaleDateString('ru-RU')}</small>
        </span>
      </span>
      <span className="board__meta">
        {kind === 'challenge'
          ? `${r.reps} всего · оценка ${r.avgScore}`
          : `${r.cleanReps}/${r.reps} чистых (${cleanPct}%) · ${formatDuration(r.durationSec)}`}
      </span>
      <span className="board__points">
        {r.rating}
        <small>{unit}</small>
      </span>
    </li>
  );
}
