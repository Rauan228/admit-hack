// U-13: ник для таблицы рекордов без клавиатуры — выбираем жестом из сгенерированных.
// Прошлый ник (если был) стоит первым, чтобы не выбирать заново каждый раз.

import { useState } from 'react';
import { DwellButton } from '../components/dwell';
import { Icon } from '../components/Icon';
import { generateNames, lastName, saveRecord } from '../store/progress';
import type { PendingRecord } from './Summary';
import './Leaderboard.css';

export function NamePicker({ record, onSaved }: { record: PendingRecord; onSaved: (id: string) => void }) {
  const [seed, setSeed] = useState(() => Date.now());
  const prev = lastName();
  const names = generateNames(prev ? 2 : 3, seed);
  const options = prev ? [prev, ...names.filter((n) => n !== prev)] : names;

  const pick = (name: string) => onSaved(saveRecord({ ...record, name }).id);

  return (
    <main className="screen board">
      <header className="board__head">
        <h1 className="board__title">Как тебя записать?</h1>
        <p className="muted">
          {record.points} очков · {record.label}. Задержи руку на нике.
        </p>
      </header>
      <nav className="names" aria-label="Выбор ника">
        {options.map((n, i) => (
          <DwellButton key={n} size="lg" variant={i === 0 ? 'primary' : 'default'} onSelect={() => pick(n)}>
            <Icon name="user" size={30} /> {n}
          </DwellButton>
        ))}
        <DwellButton size="lg" variant="ghost" onSelect={() => setSeed((s) => s + 7919)}>
          <Icon name="retry" size={28} /> Другие варианты
        </DwellButton>
      </nav>
    </main>
  );
}
