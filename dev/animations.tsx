// Страница проверки анимаций атлета (только dev): все упражнения, ракурс, скорость, пауза, фаза и замечания.
// Замечания хранятся в localStorage; «Скопировать все» собирает их одним текстом.

import { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Ghost } from '../src/ui/components/Ghost';
import { PREFERRED_YAW, durationOf, hasRecordedMotion, type GhostId } from '../src/ui/lib/athlete';
import { CATEGORIES, EXERCISE_META } from '../src/ui/lib/exercises';
import '../src/ui/styles/global.css';
import './animations.css';

const KEY = 'forma.anim-notes.v1';
const SPEEDS = [0.25, 0.5, 1, 1.5];
const VIEWS: { label: string; yaw: number | null }[] = [
  { label: 'Как в приложении', yaw: null },
  { label: 'Анфас', yaw: 0 },
  { label: '3/4', yaw: 0.6 },
  { label: 'Бок', yaw: 1.4 },
  { label: 'Сзади', yaw: Math.PI },
];

const SOURCE: Partial<Record<GhostId, string>> = {
  squat: 'запись человека',
  jump_squat: 'присед + прыжок',
  squat_press: 'присед + руки вверх',
  burpee: 'описание Grok, сплайн',
};

function loadNotes(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '{}') as Record<string, string>;
  } catch {
    return {};
  }
}

function Card({ id, note, onNote }: { id: GhostId; note: string; onNote: (v: string) => void }) {
  const dur = durationOf(id);
  const [view, setView] = useState(0);
  const [speed, setSpeed] = useState(1);
  const [paused, setPaused] = useState(false);
  const [phase, setPhase] = useState(0);
  // Часы атлета: своё время карточки с учётом скорости и паузы.
  const st = useRef({ t: 0, last: 0, speed: 1, paused: false });
  useEffect(() => {
    st.current.speed = speed;
    st.current.paused = paused;
  }, [speed, paused]);
  const [clock] = useState(() => () => {
    const s = st.current;
    const now = performance.now();
    if (!s.last) s.last = now;
    if (!s.paused) s.t += (now - s.last) * s.speed;
    s.last = now;
    return s.t;
  });
  useEffect(() => {
    const id = setInterval(() => setPhase(((st.current.t % dur) + dur) % dur), 100);
    return () => clearInterval(id);
  }, [dur]);
  const yaw = VIEWS[view]!.yaw ?? PREFERRED_YAW[id];
  const title = id === 'burpee' ? 'Бёрпи' : (EXERCISE_META[id as keyof typeof EXERCISE_META]?.title ?? id);

  return (
    <article className="an-card">
      <div className="an-stage">
        <Ghost exercise={id} yaw={yaw} clock={clock} className="an-ghost" />
        <span className="an-src">{hasRecordedMotion(id) ? (SOURCE[id] ?? '3D') : 'стикмен (нет 3D)'}</span>
      </div>
      <div className="an-body">
        <header className="an-head">
          <b>{title}</b>
          <small>
            {id} · цикл {(dur / 1000).toFixed(1)} с
          </small>
        </header>
        <div className="pills an-row">
          {VIEWS.map((v, i) => (
            <button
              key={v.label}
              type="button"
              className={`pill ${i === view ? 'is-active' : ''}`}
              onClick={() => setView(i)}
            >
              {v.label}
            </button>
          ))}
        </div>
        <div className="an-row an-controls">
          <button type="button" className="btn btn--sm" onClick={() => setPaused((p) => !p)}>
            {paused ? 'Играть' : 'Пауза'}
          </button>
          <div className="pills">
            {SPEEDS.map((s) => (
              <button
                key={s}
                type="button"
                className={`pill ${s === speed ? 'is-active' : ''}`}
                onClick={() => setSpeed(s)}
              >
                ×{s}
              </button>
            ))}
          </div>
        </div>
        <label className="an-phase">
          <span>Фаза {Math.round((phase / dur) * 100)}%</span>
          <input
            type="range"
            min={0}
            max={1000}
            value={Math.round((phase / dur) * 1000)}
            onChange={(e) => {
              st.current.t = (Number(e.target.value) / 1000) * dur;
              setPaused(true);
              setPhase(st.current.t);
            }}
          />
        </label>
        <textarea
          className="an-note"
          placeholder="Замечания: что не так, в какой фазе, как должно быть…"
          value={note}
          onChange={(e) => onNote(e.target.value)}
        />
      </div>
    </article>
  );
}

function Page() {
  const [notes, setNotes] = useState(loadNotes);
  const [copied, setCopied] = useState(false);
  const [general, setGeneral] = useState(() => loadNotes()['_general'] ?? '');
  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify({ ...notes, _general: general }));
    } catch {
      /* без хранилища — замечания живут до перезагрузки */
    }
  }, [notes, general]);

  const groups = useMemo(() => CATEGORIES.map((c) => ({ title: c.title, items: c.items as GhostId[] })), []);
  const all = groups.flatMap((g) => g.items);

  const text = () => {
    const lines = ['Замечания по анимациям FORMA', ''];
    if (general.trim()) lines.push('Общее:', general.trim(), '');
    for (const id of all) {
      const n = (notes[id] ?? '').trim();
      if (!n) continue;
      const title = EXERCISE_META[id as keyof typeof EXERCISE_META]?.title ?? id;
      lines.push(`${title} (${id}):`, n, '');
    }
    return lines.join('\n');
  };
  const count = all.filter((id) => (notes[id] ?? '').trim()).length;

  return (
    <main className="an-page">
      <header className="an-top">
        <div>
          <h1>Проверка анимаций</h1>
          <p>
            {all.length} упражнений. Смотри в разных ракурсах, на паузе двигай фазу, пиши замечания под каждым
            — они сохраняются в браузере.
          </p>
        </div>
        <div className="an-actions">
          <span>Замечаний: {count}</span>
          <button
            type="button"
            className="btn btn--primary"
            onClick={() => {
              void navigator.clipboard.writeText(text()).then(() => {
                setCopied(true);
                setTimeout(() => setCopied(false), 1800);
              });
            }}
          >
            {copied ? 'Скопировано' : 'Скопировать все замечания'}
          </button>
        </div>
      </header>
      <textarea
        className="an-note an-general"
        placeholder="Общие замечания (для всех упражнений)…"
        value={general}
        onChange={(e) => setGeneral(e.target.value)}
      />
      {groups.map((g) => (
        <section key={g.title}>
          <h2>{g.title}</h2>
          <div className="an-grid">
            {g.items.map((id) => (
              <Card
                key={id}
                id={id}
                note={notes[id] ?? ''}
                onNote={(v) => setNotes((n) => ({ ...n, [id]: v }))}
              />
            ))}
          </div>
        </section>
      ))}
    </main>
  );
}

createRoot(document.getElementById('root')!).render(<Page />);
