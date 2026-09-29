// U-07: выбор одного упражнения — 18 штук в четырёх категориях. Сверху вкладки, под ними до 6 крупных плиток,
// чтобы рукой попадать с 2–3 метров. 3D-атлета в плитках нет: эталон показывает интро (и телефон не тормозит).
// «Обе руки вверх» — назад (обрабатывает App).

import { useState } from 'react';
import type { ExerciseId } from '../../engine/types';
import { SINGLE_TARGET } from '../../shared/rating';
import { DwellButton } from '../components/dwell';
import { Icon } from '../components/Icon';
import { MUSCLE_NAMES } from '../lib/athlete';
import { CATEGORIES, EXERCISE_META } from '../lib/exercises';
import { order } from '../lib/motion';
import './Menu.css';
import './Picker.css';

const TAB_KEY = 'forma.picker.tab.v1';

function savedTab(): string {
  try {
    return sessionStorage.getItem(TAB_KEY) ?? CATEGORIES[0]!.id;
  } catch {
    return CATEGORIES[0]!.id;
  }
}

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
    <main className="screen menu picker">
      <header className="menu__head">
        <h1 className="menu__title rise" style={order(0)}>
          Выбери упражнение
        </h1>
        <p className="menu__how">
          <Icon name="back" size={24} className="primary" /> Обе руки над головой — назад
        </p>
      </header>

      <nav className="picker__tabs" aria-label="Категории">
        {CATEGORIES.map((c) => (
          <DwellButton
            key={c.id}
            size="sm"
            variant={c.id === cat.id ? 'primary' : 'ghost'}
            className="picker__tab"
            onSelect={() => choose(c.id)}
          >
            <Icon name={c.icon} size={22} /> {c.title}
            <small className="picker__count">{c.items.length}</small>
          </DwellButton>
        ))}
      </nav>

      <nav className="picker__grid" aria-label={cat.title} key={cat.id}>
        {cat.items.map((ex, i) => {
          const meta = EXERCISE_META[ex];
          const target = SINGLE_TARGET[ex];
          return (
            <DwellButton
              key={ex}
              size="lg"
              className="picker__tile rise"
              style={order(i + 1)}
              onSelect={() => onPick(ex)}
            >
              <span className="picker__tile-top">
                <Icon name={meta.icon} size={30} className="primary" />
                <span className="picker__target">
                  {ex === 'lunge'
                    ? `${target} × 2 ноги`
                    : `${target} ${meta.unit === 'sec' ? 'сек' : 'повт.'}`}
                </span>
              </span>
              <span className="menu__tile-text">
                <b>{meta.title}</b>
                <small>{MUSCLE_NAMES[ex].join(' · ')}</small>
              </span>
              {meta.setup && (
                <span className="picker__setup">
                  <Icon name="camera" size={16} /> камера на полу, лицом к ней
                </span>
              )}
            </DwellButton>
          );
        })}
      </nav>

      <footer className="menu__foot">
        <DwellButton size="sm" variant="ghost" onSelect={onBack}>
          <Icon name="back" size={22} /> Назад
        </DwellButton>
      </footer>
    </main>
  );
}
