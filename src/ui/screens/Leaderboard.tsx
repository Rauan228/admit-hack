// U-13: общий рейтинг (сервер). Три режима — у каждого своя честная метрика (src/shared/rating.ts),
// у «Одного упражнения» — доска на каждое упражнение; периоды «сегодня / неделя / всё время».
// Всё выбирается и рукой (удержание), и мышью; «обе руки вверх» — назад в меню.

import { useEffect, useState } from 'react';
import {
  RATED_EXERCISES,
  boardExercise,
  boardKind,
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
  const unit = boardUnit(board);
  const loading = !data || data.key !== key;
  const d = !loading && data && 'd' in data ? data.d : null;
  const error = !loading && data && 'error' in data ? data.error : null;
  const meOutside = d?.me && !d.rows.some((r) => r.me) ? d.me : null;

  return (
    <main className="screen board">
      <header className="board__head">
        <span className="eyebrow">Рейтинг FORMA</span>
        <h1 className="board__title">Кто сильнее — и чище</h1>
        {d && <p className="muted board__rule">{d.rule}</p>}
      </header>

      <nav className="board__tabs" aria-label="Режим">
        {KINDS.map((k) => (
          <DwellButton
            key={k.kind}
            size="sm"
            variant={kind === k.kind ? 'primary' : 'ghost'}
            className="board__tab"
            onSelect={() => setBoard(k.kind === 'single' ? `single:${exercise ?? 'squat'}` : k.kind)}
          >
            <Icon name={k.icon} size={22} /> {k.label}
          </DwellButton>
        ))}
      </nav>

      <div className="board__filters">
        {kind === 'single' && (
          <div className="board__chips" aria-label="Упражнение">
            {RATED_EXERCISES.map((ex: RatedExercise) => (
              <DwellButton
                key={ex}
                size="sm"
                variant={exercise === ex ? 'primary' : 'default'}
                className="board__chip"
                onSelect={() => setBoard(`single:${ex}`)}
              >
                {EXERCISE_META[ex].title}
              </DwellButton>
            ))}
          </div>
        )}
        <div className="board__chips board__periods" aria-label="Период">
          {PERIODS.map((p) => (
            <DwellButton
              key={p.id}
              size="sm"
              variant={period === p.id ? 'primary' : 'default'}
              className="board__chip"
              onSelect={() => setPeriod(p.id)}
            >
              {p.label}
            </DwellButton>
          ))}
        </div>
      </div>

      {loading && (
        <ol className="board__list" aria-busy="true">
          {[0, 1, 2, 3].map((i) => (
            <li key={i} className="board__row board__row--skeleton" />
          ))}
        </ol>
      )}

      {error && (
        <div className="card board__empty">
          <Icon name="alert" size={40} className="primary" />
          <div>
            <p>{error}</p>
            <DwellButton size="sm" onSelect={() => setRetry((n) => n + 1)}>
              <Icon name="retry" size={20} /> Обновить
            </DwellButton>
          </div>
        </div>
      )}

      {d && d.rows.length === 0 && (
        <div className="card board__empty">
          <Icon name="trophy" size={44} className="primary" />
          <p>
            {period === 'all' ? 'Здесь пока никого.' : 'За этот период результатов ещё нет.'} Пройди
            тренировку и сохрани результат — место №1 свободно.
          </p>
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

      {d && (
        <p className="muted board__players">
          Игроков на доске: {d.players}
          {!user && ' · Войди, чтобы попасть в рейтинг'}
        </p>
      )}

      <footer className="menu__foot board__foot">
        <DwellButton size="lg" onSelect={onBack}>
          <Icon name="back" size={28} /> В меню
        </DwellButton>
        {!user && (
          <DwellButton size="lg" variant="ghost" onSelect={onSignIn}>
            <Icon name="user" size={28} /> Войти
          </DwellButton>
        )}
        <p className="muted hide-sm">Обе руки над головой — назад</p>
      </footer>
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
      <span className="board__name">
        <b>
          {r.nick}
          {r.me && <em className="board__you">ты</em>}
        </b>
        <small className="muted">{new Date(r.createdAt).toLocaleDateString('ru-RU')}</small>
      </span>
      <span className="board__meta muted">
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
