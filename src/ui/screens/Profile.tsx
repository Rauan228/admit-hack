// Мой прогресс: по каждой доске — личный рекорд, последний результат, прирост к предыдущему и график.

import { useEffect, useState } from 'react';
import { RATED_EXERCISES, type Board } from '../../shared/rating';
import { DwellButton } from '../components/dwell';
import { Icon } from '../components/Icon';
import { order } from '../lib/motion';
import { boardTitle, boardUnit } from '../lib/rating';
import { ApiError, fetchProgress, logout, useAuth, type HistoryItem, type ProgressData } from '../store/api';
import './Profile.css';

const BOARDS: Board[] = ['quick', 'challenge', ...RATED_EXERCISES.map((e) => `single:${e}` as Board)];

export function Profile({
  onBack,
  onPlay,
  onBoard,
  onSignedOut,
}: {
  onBack: () => void;
  onPlay: (board: Board) => void;
  onBoard: (board: Board) => void;
  onSignedOut: () => void;
}) {
  const { user } = useAuth();
  const [data, setData] = useState<ProgressData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetchProgress()
      .then((d) => alive && setData(d))
      .catch((e) => alive && setError(e instanceof ApiError ? e.message : 'Не получилось загрузить'));
    return () => {
      alive = false;
    };
  }, []);

  const total = data ? Object.values(data.boards).reduce((a, b) => a + (b?.count ?? 0), 0) : 0;
  const played = BOARDS.filter((b) => data?.boards[b]);
  const fresh = BOARDS.filter((b) => data && !data.boards[b]);

  return (
    <main className="screen profile">
      <header className="profile__head">
        <div>
          <span className="eyebrow">Мой прогресс</span>
          <h1 className="profile__title">{user?.nick ?? 'Профиль'}</h1>
          <p className="muted">
            {user?.email}
            {data && ` · сохранено тренировок: ${total}`}
          </p>
        </div>
        <button
          type="button"
          className="btn btn--ghost btn--sm"
          onClick={() => {
            void logout().then(onSignedOut);
          }}
        >
          Выйти из аккаунта
        </button>
      </header>

      {error && <div className="card board__empty">{error}</div>}
      {!data && !error && <div className="profile__grid" aria-busy="true" />}

      {data && total === 0 && (
        <div className="card board__empty">
          <Icon name="zap" size={40} className="primary" />
          <p>Пока ни одного сохранённого результата. Пройди тренировку и нажми «Сохранить» на итогах.</p>
        </div>
      )}

      {data && played.length > 0 && (
        <section className="profile__grid">
          {played.map((b, i) => (
            <BoardCard
              key={b}
              board={b}
              info={data.boards[b]!}
              i={i}
              onBoard={() => onBoard(b)}
              onPlay={() => onPlay(b)}
            />
          ))}
        </section>
      )}

      {data && fresh.length > 0 && (
        <section className="profile__fresh">
          <h3>Ещё не пробовал</h3>
          <div className="board__chips">
            {fresh.map((b) => (
              <DwellButton key={b} size="sm" onSelect={() => onPlay(b)}>
                <Icon name="play" size={18} /> {boardTitle(b)}
              </DwellButton>
            ))}
          </div>
        </section>
      )}

      <footer className="menu__foot">
        <DwellButton size="lg" onSelect={onBack}>
          <Icon name="back" size={28} /> В меню
        </DwellButton>
      </footer>
    </main>
  );
}

function BoardCard({
  board,
  info,
  i,
  onBoard,
  onPlay,
}: {
  board: Board;
  info: { history: HistoryItem[]; best: HistoryItem; count: number };
  i: number;
  onBoard: () => void;
  onPlay: () => void;
}) {
  const h = info.history;
  const last = h[h.length - 1]!;
  const prev = h.length > 1 ? h[h.length - 2]! : null;
  const delta = prev ? last.rating - prev.rating : null;
  const unit = boardUnit(board);
  return (
    <article className="card pcard rise" style={order(i + 1)}>
      <header className="pcard__head">
        <h3>{boardTitle(board)}</h3>
        <span className="muted">{info.count} раз</span>
      </header>
      <div className="pcard__nums">
        <div>
          <span className="pcard__best">{info.best.rating}</span>
          <small className="muted">рекорд · {unit}</small>
        </div>
        <div>
          <span className="pcard__last">{last.rating}</span>
          <small className="muted">
            последний
            {delta !== null && delta !== 0 && (
              <b className={delta > 0 ? 'save__up' : delta < 0 ? 'save__down' : ''}>
                {' '}
                {delta > 0 ? `+${delta}` : delta}
              </b>
            )}
          </small>
        </div>
      </div>
      <Spark items={h.slice(-20)} best={info.best.id} />
      <footer className="pcard__actions">
        <DwellButton size="sm" variant="primary" onSelect={onPlay}>
          <Icon name="play" size={18} /> Побить рекорд
        </DwellButton>
        <DwellButton size="sm" variant="ghost" onSelect={onBoard}>
          <Icon name="trophy" size={18} /> Рейтинг
        </DwellButton>
      </footer>
    </article>
  );
}

/** Мини-график последних результатов: точка рекорда — зелёная. */
function Spark({ items, best }: { items: HistoryItem[]; best: number }) {
  if (items.length < 2)
    return <p className="pcard__hint muted">Сыграй ещё раз — появится график прогресса.</p>;
  const W = 300;
  const H = 70;
  const vals = items.map((x) => x.rating);
  const lo = Math.min(...vals);
  const hi = Math.max(...vals);
  const x = (k: number) => 6 + (k * (W - 12)) / (items.length - 1);
  const y = (v: number) => H - 8 - ((v - lo) / Math.max(1, hi - lo)) * (H - 16);
  const path = items
    .map((it, k) => `${k ? 'L' : 'M'}${x(k).toFixed(1)},${y(it.rating).toFixed(1)}`)
    .join(' ');
  return (
    <svg
      className="pcard__spark"
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label={`Результаты: ${vals.join(', ')}`}
    >
      <path d={`${path} L${x(items.length - 1)},${H} L${x(0)},${H} Z`} className="pcard__area" />
      <path d={path} className="pcard__line" />
      {items.map((it, k) => (
        <circle
          key={it.id}
          cx={x(k)}
          cy={y(it.rating)}
          r={it.id === best ? 5 : 3}
          className={it.id === best ? 'pcard__dot pcard__dot--best' : 'pcard__dot'}
        />
      ))}
    </svg>
  );
}
