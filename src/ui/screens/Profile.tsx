// Мой прогресс: по каждой доске — личный рекорд, последний результат, прирост к предыдущему и график.

import { useEffect, useId, useState } from 'react';
import { cupsLabel, formatById, type ArenaStanding } from '../../shared/arena';
import { RATED_EXERCISES, boardExercise, boardKind, type Board } from '../../shared/rating';
import { DwellButton } from '../components/dwell';
import { Icon, type IconName } from '../components/Icon';
import { EXERCISE_META } from '../lib/exercises';
import { order } from '../lib/motion';
import { boardTitle, boardUnit } from '../lib/rating';
import {
  ApiError,
  fetchProgress,
  fetchStanding,
  logout,
  useAuth,
  type HistoryItem,
  type ProgressData,
} from '../store/api';
import './Profile.css';

const BOARDS: Board[] = ['quick', 'challenge', ...RATED_EXERCISES.map((e) => `single:${e}` as Board)];

type Filter = 'all' | 'quick' | 'challenge' | 'single';

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'Все' },
  { id: 'quick', label: 'Быстрая' },
  { id: 'challenge', label: 'Челлендж 60 с' },
  { id: 'single', label: 'Упражнения' },
];

function exTitle(id: string): string {
  if (id in EXERCISE_META) return EXERCISE_META[id as keyof typeof EXERCISE_META].title;
  return id;
}

function boardIcon(board: Board): IconName {
  const ex = boardExercise(board);
  if (ex) return EXERCISE_META[ex].icon;
  return board === 'quick' ? 'run' : 'timer';
}

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
  const [standing, setStanding] = useState<ArenaStanding | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetchProgress()
      .then((d) => alive && setData(d))
      .catch((e) => alive && setError(e instanceof ApiError ? e.message : 'Не получилось загрузить'));
    fetchStanding()
      .then((s) => alive && setStanding(s))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  const [filter, setFilter] = useState<Filter>('all');
  const total = data ? Object.values(data.boards).reduce((a, b) => a + (b?.count ?? 0), 0) : 0;
  const shown = BOARDS.filter((b) => filter === 'all' || boardKind(b) === filter);
  const played = shown.filter((b) => data?.boards[b]);
  const fresh = shown.filter((b) => data && !data.boards[b]);
  const nick = user?.nick ?? 'Профиль';

  return (
    <main className="page profile">
      <div className="page__inner">
        <DwellButton className="profile__back" onSelect={onBack}>
          <Icon name="back" size={16} /> В меню
        </DwellButton>

        <header className="profile__head rise" style={order(0)}>
          <span className="face profile__face" data-frame={standing?.frame ?? undefined} aria-hidden="true">
            <span className="profile__avatar face__disc">{nick.slice(0, 1).toUpperCase()}</span>
          </span>
          <div className="profile__who">
            <h1 className="profile__title">{nick}</h1>
            <p className="profile__meta">
              {user?.email}
              {data && (
                <>
                  {user?.email && <span aria-hidden="true"> · </span>}
                  сохранено тренировок: <b>{total}</b>
                </>
              )}
            </p>
          </div>
          <button
            type="button"
            className="btn btn--ghost btn--sm profile__out"
            onClick={() => {
              void logout().then(onSignedOut);
            }}
          >
            <Icon name="logout" size={16} /> Выйти из аккаунта
          </button>
        </header>

        {standing && <ArenaCard standing={standing} />}

        {data && total > 0 && (
          <nav className="pills profile__filters" aria-label="Фильтр">
            {FILTERS.map((f) => (
              <DwellButton
                key={f.id}
                className={`pill profile__pill ${filter === f.id ? 'is-active' : ''}`}
                onSelect={() => setFilter(f.id)}
              >
                {f.label}
              </DwellButton>
            ))}
          </nav>
        )}

        {error && (
          <div className="profile__state profile__state--error">
            <span className="profile__state-icon">
              <Icon name="alert" size={24} />
            </span>
            <b>{error}</b>
            <p>Прогресс хранится на сервере — попробуй открыть страницу чуть позже.</p>
          </div>
        )}

        {!data && !error && (
          <section className="profile__grid" aria-busy="true">
            {[0, 1, 2].map((i) => (
              <div key={i} className="pcard pcard--skeleton" />
            ))}
          </section>
        )}

        {data && total === 0 && (
          <div className="profile__state">
            <span className="profile__state-icon">
              <Icon name="chart" size={24} />
            </span>
            <b>Пока ни одного сохранённого результата</b>
            <p>Пройди тренировку и нажми «Сохранить» на итогах — здесь появятся рекорды и графики.</p>
            <DwellButton size="sm" variant="primary" onSelect={() => onPlay('quick')}>
              <Icon name="play" size={16} /> Быстрая тренировка
            </DwellButton>
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
            <h2 className="profile__section">
              Ещё не пробовал <small>{fresh.length}</small>
            </h2>
            <div className="profile__fresh-grid">
              {fresh.map((b) => (
                <DwellButton key={b} className="profile__try" onSelect={() => onPlay(b)}>
                  <span className="profile__try-icon" aria-hidden="true">
                    <Icon name={boardIcon(b)} size={18} />
                  </span>
                  <span className="profile__try-text">
                    <b>{boardTitle(b)}</b>
                    <small>рекорда ещё нет</small>
                  </span>
                  <Icon name="play" size={16} className="profile__try-go" />
                </DwellButton>
              ))}
            </div>
          </section>
        )}
      </div>
    </main>
  );
}

function ArenaCard({ standing }: { standing: ArenaStanding }) {
  const pct = Math.min(100, (standing.into / Math.max(1, standing.span)) * 100);
  const next = standing.nextTitle;
  return (
    <section className="arena rise" style={order(1)} aria-label="Арена">
      <div className="arena__lead">
        <div>
          <h2 className="arena__title">{standing.title?.name ?? 'Без титула'}</h2>
          <p className="arena__meta">
            {cupsLabel(standing.cups)} · уровень {standing.level} · {standing.xp} опыта
            {next ? ` · до «${next.name}» ещё ${cupsLabel(next.left)}` : ''}
          </p>
        </div>
      </div>
      <div
        className="arena__bar"
        role="progressbar"
        aria-valuemin={0}
        aria-valuenow={standing.into}
        aria-valuemax={standing.span}
        aria-label={`Уровень ${standing.level}`}
      >
        <span style={{ width: `${pct}%` }} />
      </div>
      <ul className="arena__formats">
        {standing.formats.map((f) => (
          <li key={f.id} className="arena__format">
            <b>{f.name}</b>
            <span>{f.cups}</span>
            <small>
              {f.wins}–{f.losses}
              {f.draws > 0 ? `–${f.draws}` : ''}
            </small>
          </li>
        ))}
      </ul>
      {standing.boards.length > 0 ? (
        <ul className="arena__boards">
          {standing.boards.map((b) => (
            <li key={`${b.exercise}-${b.format}`} className="arena__board">
              <span>
                {exTitle(b.exercise)} · {formatById(b.format).name}
              </span>
              <b>{cupsLabel(b.cups)}</b>
            </li>
          ))}
        </ul>
      ) : (
        <p className="arena__hint">
          Сыграй дуэль с игроком. У пули, блица и рапида свой рейтинг, и у каждого упражнения тоже.
        </p>
      )}
      <a className="btn btn--sm arena__link" href={`${import.meta.env.BASE_URL}duel.html#ladder`}>
        Таблица арены
      </a>
    </section>
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
    <article className="pcard rise" style={order(i + 1)}>
      <header className="pcard__head">
        <span className="pcard__icon">
          <Icon name={boardIcon(board)} size={20} />
        </span>
        <h3>{boardTitle(board)}</h3>
        <span className="pcard__count">{info.count} раз</span>
      </header>
      <div className="pcard__nums">
        <div>
          <span className="pcard__best">{info.best.rating}</span>
          <small>Рекорд, {unit}</small>
        </div>
        <div>
          <span className="pcard__last">
            {last.rating}
            {delta !== null && delta !== 0 && (
              <b className={delta > 0 ? 'pcard__up' : 'pcard__down'}>{delta > 0 ? `+${delta}` : delta}</b>
            )}
          </span>
          <small>Последний</small>
        </div>
      </div>
      <Spark items={h.slice(-20)} best={info.best.id} />
      <footer className="pcard__actions">
        <DwellButton size="sm" variant="primary" className="pcard__go" onSelect={onPlay}>
          <Icon name="play" size={16} /> Побить рекорд
        </DwellButton>
        <DwellButton size="sm" variant="ghost" onSelect={onBoard}>
          <Icon name="trophy" size={16} /> Рейтинг
        </DwellButton>
      </footer>
    </article>
  );
}

/** Плавная линия через точки (Catmull-Rom → кривые Безье). */
function smooth(pts: [number, number][]): string {
  let d = `M${pts[0]![0].toFixed(1)},${pts[0]![1].toFixed(1)}`;
  for (let k = 0; k < pts.length - 1; k++) {
    const p0 = pts[k - 1] ?? pts[k]!;
    const p1 = pts[k]!;
    const p2 = pts[k + 1]!;
    const p3 = pts[k + 2] ?? p2;
    const c1x = p1[0] + (p2[0] - p0[0]) / 6;
    const c1y = p1[1] + (p2[1] - p0[1]) / 6;
    const c2x = p2[0] - (p3[0] - p1[0]) / 6;
    const c2y = p2[1] - (p3[1] - p1[1]) / 6;
    d += ` C${c1x.toFixed(1)},${c1y.toFixed(1)} ${c2x.toFixed(1)},${c2y.toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)}`;
  }
  return d;
}

/** Мини-график последних результатов: точка рекорда — зелёная. */
function Spark({ items, best }: { items: HistoryItem[]; best: number }) {
  const gid = useId();
  if (items.length < 2) return <p className="pcard__hint">Сыграй ещё раз — появится график прогресса.</p>;
  const W = 300;
  const H = 72;
  const vals = items.map((x) => x.rating);
  const lo = Math.min(...vals);
  const hi = Math.max(...vals);
  const x = (k: number) => 6 + (k * (W - 12)) / (items.length - 1);
  const y = (v: number) => H - 10 - ((v - lo) / Math.max(1, hi - lo)) * (H - 20);
  const pts = items.map((it, k) => [x(k), y(it.rating)] as [number, number]);
  const path = smooth(pts);
  const last = pts[pts.length - 1]!;
  const bestK = items.findIndex((it) => it.id === best);
  return (
    <svg
      className="pcard__spark"
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label={`Результаты: ${vals.join(', ')}`}
    >
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#f97316" stopOpacity="0.28" />
          <stop offset="100%" stopColor="#f97316" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={`${path} L${x(items.length - 1)},${H} L${x(0)},${H} Z`} fill={`url(#${gid})`} />
      <path d={path} className="pcard__line" />
      {bestK >= 0 && bestK !== items.length - 1 && (
        <circle cx={pts[bestK]![0]} cy={pts[bestK]![1]} r={4} className="pcard__dot pcard__dot--best" />
      )}
      <circle
        cx={last[0]}
        cy={last[1]}
        r={bestK === items.length - 1 ? 5 : 4}
        className={bestK === items.length - 1 ? 'pcard__dot pcard__dot--best' : 'pcard__dot'}
      />
    </svg>
  );
}
