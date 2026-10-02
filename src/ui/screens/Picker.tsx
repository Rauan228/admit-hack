// U-07: выбор одного упражнения — 18 штук в четырёх категориях. Сверху вкладки-пилюли, под ними карточки,
// чтобы рукой попадать с 2–3 метров. 3D-атлета в плитках нет: эталон показывает интро (и телефон не тормозит).
// «Обе руки вверх» — назад (обрабатывает App).

import { useState } from 'react';
import type { ExerciseId } from '../../engine/types';
import { SINGLE_TARGET } from '../../shared/rating';
import { DwellButton } from '../components/dwell';
import { ICON_PHASE, LYING } from '../lib/thumb';
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

export function Picker({
  onPick,
  onBack,
  mode = 'single',
}: {
  onPick: (e: ExerciseId) => void;
  onBack: () => void;
  /** challenge — челлендж 60 с: без планки (она на время), цель — минута. */
  mode?: 'single' | 'challenge';
}) {
  const challenge = mode === 'challenge';
  const cats = CATEGORIES.map((c) => ({
    ...c,
    items: challenge ? c.items.filter((e) => e !== 'plank') : c.items,
  })).filter((c) => c.items.length > 0);
  const [tab, setTab] = useState(savedTab);
  const cat = cats.find((c) => c.id === tab) ?? cats[0]!;
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
          <h1 className="page__title">{challenge ? 'Челлендж 60 секунд' : 'Выбери упражнение'}</h1>
          <p className="page__sub">
            {challenge
              ? 'Сколько чистых повторений успеешь за минуту? Выбери упражнение — у каждого свой рейтинг.'
              : `${EXERCISE_COUNT} упражнений в ${CATEGORIES.length} группах. Обе руки над головой — назад.`}
          </p>
        </header>

        <nav className="pills picker__tabs" aria-label="Категории">
          {cats.map((c) => (
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
                    {challenge
                      ? '60 сек · максимум'
                      : ex === 'lunge'
                        ? `${target} × 2 ноги`
                        : `${target} ${meta.unit === 'sec' ? 'сек' : 'повт.'}`}
                  </span>
                  <small className="picker__muscles">{MUSCLE_NAMES[ex].join(' · ')}</small>
                  {meta.setup && (
                    <span className="picker__setup">
                      <Icon name="camera" size={14} />{' '}
                      {ex === 'pull_up' ? 'нужен турник в кадре' : 'камера на полу, лицом к ней'}
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
