// U-07: выбор одного упражнения — 18 штук в четырёх категориях. Сверху вкладки-пилюли, под ними карточки,
// чтобы рукой попадать с 2–3 метров. 3D-атлета в плитках нет: эталон показывает интро (и телефон не тормозит).
// «Обе руки вверх» — назад (обрабатывает App).

import { useState } from 'react';
import type { ExerciseId } from '../../engine/types';
import { SINGLE_TARGET } from '../../shared/rating';
import { DwellButton } from '../components/dwell';
import { Ghost } from '../components/Ghost';
import { Icon } from '../components/Icon';
import { MUSCLE_NAMES, hasRecordedMotion } from '../lib/athlete';
import { CATEGORIES, EXERCISE_META } from '../lib/exercises';
import { order } from '../lib/motion';
import './Picker.css';

const EXERCISE_COUNT = CATEGORIES.reduce((n, c) => n + c.items.length, 0);
const TAB_KEY = 'forma.picker.tab.v1';

function savedTab(): string {
  try {
    return sessionStorage.getItem(TAB_KEY) ?? CATEGORIES[0]!.id;
  } catch {
    return CATEGORIES[0]!.id;
  }
}

/** Упор лёжа и бёрпи: фигура вытянута по горизонтали — в превью не увеличиваем, иначе обрежется. */
const LYING = new Set<string>(['push_up', 'plank', 'burpee']);

/** Самая узнаваемая поза каждого упражнения для превью (доля цикла). */
const ICON_PHASE: Partial<Record<string, number>> = {
  squat: 0.5,
  lunge: 0.19,
  side_lunge: 0.25,
  jump_squat: 0.4,
  calf_raise: 0.4,
  side_leg_raise: 0.25,
  jumping_jack: 0.26,
  cross_jack: 0.2,
  high_knees: 0.25,
  burpee: 0.5,
  boxing: 0.08,
  arm_raise: 0.26,
  arm_circles: 0.5,
  squat_press: 0.64,
  side_bend: 0.27,
  knee_to_elbow: 0.23,
  push_up: 0.3,
  plank: 0.5,
};

export function Picker({ onPick, onBack }: { onPick: (e: ExerciseId) => void; onBack: () => void }) {
  const [tab, setTab] = useState(savedTab);
  const cat = CATEGORIES.find((c) => c.id === tab) ?? CATEGORIES[0]!;
  const choose = (id: string) => {
    setTab(id);
    try {
      sessionStorage.setItem(TAB_KEY, id);
    } catch {
      /* без хранилища — просто не запомним вкладку */
    }
  };

  return (
    <main className="page picker">
      <div className="page__inner">
        <header className="page__head picker__head rise" style={order(0)}>
          <DwellButton className="picker__back" onSelect={onBack}>
            <Icon name="back" size={16} /> Назад
          </DwellButton>
          <h1 className="page__title">Выбери упражнение</h1>
          <p className="page__sub">
            {EXERCISE_COUNT} упражнений в четырёх группах. Обе руки над головой — назад.
          </p>
        </header>

        <nav className="pills picker__tabs" aria-label="Категории">
          {CATEGORIES.map((c) => (
            <DwellButton
              key={c.id}
              className={`pill picker__tab ${c.id === cat.id ? 'is-active' : ''}`}
              onSelect={() => choose(c.id)}
            >
              <Icon name={c.icon} size={16} /> {c.title}
              <small>{c.items.length}</small>
            </DwellButton>
          ))}
        </nav>

        <h2 className="picker__cat">{cat.title}</h2>

        <nav className="picker__grid" aria-label={cat.title} key={cat.id}>
          {cat.items.map((ex, i) => {
            const meta = EXERCISE_META[ex];
            const target = SINGLE_TARGET[ex];
            return (
              <DwellButton
                key={ex}
                className="picker__card rise"
                style={order(i + 1)}
                onSelect={() => onPick(ex)}
              >
                <span className="picker__frame" aria-hidden="true">
                  <Ghost
                    exercise={ex}
                    still
                    phase={ICON_PHASE[ex] ?? 0.3}
                    className={
                      hasRecordedMotion(ex) && !LYING.has(ex)
                        ? 'picker__ghost picker__ghost--3d'
                        : 'picker__ghost'
                    }
                  />
                </span>
                <span className="picker__text">
                  <b>{meta.title}</b>
                  <span className="picker__target">
                    {ex === 'lunge'
                      ? `${target} × 2 ноги`
                      : `${target} ${meta.unit === 'sec' ? 'сек' : 'повт.'}`}
                  </span>
                  <small className="picker__muscles">{MUSCLE_NAMES[ex].join(' · ')}</small>
                  {meta.setup && (
                    <span className="picker__setup">
                      <Icon name="camera" size={14} /> камера на полу, лицом к ней
                    </span>
                  )}
                </span>
              </DwellButton>
            );
          })}
        </nav>
      </div>
    </main>
  );
}
