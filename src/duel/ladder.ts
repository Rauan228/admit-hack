// Таблица арены: сумма кубков, отдельный рейтинг разряда и отдельный — упражнения.
// Грузится без входа: своё место подсвечивается, если аккаунт есть.

import { ARENA_FORMATS, cupsLabel, type ArenaFormatId, type LadderEntry } from '../shared/arena';
import { DUEL_EXERCISE_IDS, type DuelExercise } from '../shared/duel';
import { api } from './api';
import { face } from './face';
import { exerciseTitle, plural } from './labels';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const el = {
  format: $<HTMLDivElement>('ladder-format'),
  exercise: $<HTMLDivElement>('ladder-ex'),
  rule: $<HTMLParagraphElement>('ladder-rule'),
  rows: $<HTMLOListElement>('ladder-rows'),
};

let format: ArenaFormatId | null = null;
let exercise: DuelExercise | null = null;
let seq = 0;

export function initLadder(): void {
  const formats: { id: ArenaFormatId | null; label: string }[] = [
    { id: null, label: 'Все кубки' },
    ...ARENA_FORMATS.map((f) => ({ id: f.id, label: f.name })),
  ];
  for (const f of formats)
    el.format.append(chip(f.label, f.id ?? 'all', () => pickFormat(f.id), 'seg__item'));
  el.exercise.append(chip('Все', 'all', () => pickExercise(null), 'chip'));
  for (const id of DUEL_EXERCISE_IDS) {
    el.exercise.append(chip(exerciseTitle(id), id, () => pickExercise(id), 'chip'));
  }
  mark();
  void load();
  if (location.hash === '#ladder') el.rows.closest('section')?.scrollIntoView();
}

export function reloadLadder(): void {
  void load();
}

function pickFormat(next: ArenaFormatId | null): void {
  format = next;
  mark();
  void load();
}

function pickExercise(next: DuelExercise | null): void {
  exercise = next;
  mark();
  void load();
}

async function load(): Promise<void> {
  const token = ++seq;
  el.rule.textContent = ruleText();
  el.rows.replaceChildren(note('Загружаю таблицу…'));
  try {
    const data = await api.ladder(format, exercise);
    if (token !== seq) return;
    paint(data.rows, data.me);
  } catch (err) {
    if (token !== seq) return;
    el.rows.replaceChildren(note((err as Error).message));
  }
}

function paint(rows: LadderEntry[], me: LadderEntry | null): void {
  el.rows.replaceChildren();
  if (!rows.length) {
    el.rows.append(note('Пока никто не сыграл на этой доске. Первый бой — и ты в таблице.'));
    return;
  }
  for (const row of rows) el.rows.append(line(row));
  if (me && !rows.some((r) => r.me)) el.rows.append(line(me));
}

function line(row: LadderEntry): HTMLLIElement {
  const li = document.createElement('li');
  li.className = row.me ? 'ladder__row is-me' : 'ladder__row';
  const rank = document.createElement('span');
  rank.className = 'ladder__rank';
  rank.textContent = String(row.rank);
  const who = document.createElement('span');
  who.className = 'ladder__who';
  const nick = document.createElement('b');
  nick.textContent = row.nick;
  const meta = document.createElement('small');
  const record = `${row.wins} ${plural(row.wins, 'победа', 'победы', 'побед')}`;
  meta.textContent = row.title ? `${row.title} · ${record}` : record;
  who.append(nick, meta);
  const cups = document.createElement('span');
  cups.className = 'ladder__cups';
  cups.textContent = cupsLabel(row.cups);
  li.append(rank, face(row.nick, row.frame, 32), who, cups);
  if (row.title) li.querySelector('.face')?.setAttribute('title', row.title);
  return li;
}

function ruleText(): string {
  const time = format ? (ARENA_FORMATS.find((f) => f.id === format)?.name ?? '') : null;
  if (exercise && time)
    return `Отдельный рейтинг: ${exerciseTitle(exercise)}, ${time}. Другие упражнения и разряды его не двигают.`;
  if (time) return `Кубки разряда «${time}» — сумма по всем упражнениям.`;
  if (exercise) return `Кубки упражнения «${exerciseTitle(exercise)}» — сумма пули, блица и рапида.`;
  return 'Сумма кубков со всех досок. Титул и рамка считаются по ней.';
}

function mark(): void {
  markGroup(el.format, format ?? 'all');
  markGroup(el.exercise, exercise ?? 'all');
}

function markGroup(group: HTMLElement, value: string): void {
  for (const b of group.querySelectorAll<HTMLButtonElement>('button')) {
    const on = b.dataset.value === value;
    b.classList.toggle('is-active', on);
    b.setAttribute('aria-pressed', String(on));
  }
}

function chip(label: string, value: string, onPick: () => void, className: string): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = className;
  b.dataset.value = value;
  b.textContent = label;
  b.addEventListener('click', onPick);
  return b;
}

function note(text: string): HTMLLIElement {
  const li = document.createElement('li');
  li.className = 'ladder__empty';
  li.textContent = text;
  return li;
}
