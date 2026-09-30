// E-29: выбор дуэли на вступлении — упражнение, время боя и бот-соперник. Выбор общий для всех режимов:
// бой с ботом, онлайн-дуэль (комната создаётся с этим упражнением и временем) и вызов другу после боя.
// Последний выбор помним в localStorage — вернулся на страницу, а там твоё упражнение.
// Арена: упражнение — карусель с 3D-атлетом (стрелки и полоса превью), время — три разряда.

import { ARENA_FORMATS } from '../shared/arena';
import { DEFAULT_DUEL_EXERCISE, DUEL_EXERCISE_IDS, isDuelExercise, type DuelExercise } from '../shared/duel';
import { ROOM_DURATIONS } from '../shared/duelRoom';
import { BOTS, botTotal, findBot, type Bot } from './bot';
import { mountGhost, type GhostMount } from './ghost';
import { cameraTip, exerciseTitle, formatName, isFloor, whereLabel } from './labels';

export interface Pick {
  exercise: DuelExercise;
  durationMs: number;
  bot: Bot;
}

const STORE_KEY = 'forma.duel.pick';
const DEFAULT_MS = 60_000;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const el = {
  grid: $<HTMLDivElement>('ex-grid'),
  where: $<HTMLElement>('ex-where'),
  name: $<HTMLElement>('ex-name'),
  stage: $<HTMLDivElement>('ex-stage'),
  prev: $<HTMLButtonElement>('ex-prev'),
  next: $<HTMLButtonElement>('ex-next'),
  dur: $<HTMLDivElement>('dur-pick'),
  bots: $<HTMLDivElement>('bots'),
  sumEx: $<HTMLElement>('sum-ex'),
  sumMeta: $<HTMLElement>('sum-meta'),
  tip: $<HTMLParagraphElement>('intro-tip'),
};

const pick: Pick = { exercise: DEFAULT_DUEL_EXERCISE, durationMs: DEFAULT_MS, bot: findBot(null) };
let changed: () => void = () => undefined;
let hero: GhostMount | null = null;
/** Поза превью: середина движения, где упражнение узнаётся с первого взгляда. */
const THUMB_PHASE: Partial<Record<DuelExercise, number>> = {
  push_up: 0.5,
  squat: 0.5,
  lunge: 0.5,
  burpee: 0.35,
};

export function picked(): Readonly<Pick> {
  return pick;
}

/** Время для онлайн-комнаты: только из списка сервера (?sec= для проверок — не отсюда). */
export function roomDuration(): number {
  return ROOM_DURATIONS.includes(pick.durationMs) ? pick.durationMs : DEFAULT_MS;
}

export function initPicker(params: URLSearchParams, onChange: () => void): void {
  changed = onChange;
  const saved = load();
  const ex = params.get('ex');
  pick.exercise = isDuelExercise(ex) ? ex : isDuelExercise(saved.exercise) ? saved.exercise : pick.exercise;
  const sec = Number(params.get('sec'));
  if (params.get('sec') !== null && Number.isFinite(sec))
    pick.durationMs = Math.min(180, Math.max(10, Math.round(sec))) * 1000;
  else if (typeof saved.durationMs === 'number' && ROOM_DURATIONS.includes(saved.durationMs))
    pick.durationMs = saved.durationMs;
  pick.bot = findBot(params.get('bot') ?? (typeof saved.bot === 'string' ? saved.bot : null));

  for (const id of DUEL_EXERCISE_IDS) {
    const b = option('thumb', () => set({ exercise: id }));
    b.dataset.value = id;
    b.setAttribute('aria-label', exerciseTitle(id));
    b.title = exerciseTitle(id);
    const art = span('thumb__art', '');
    art.setAttribute('aria-hidden', 'true');
    b.append(art);
    el.grid.append(b);
    mountGhost(art, { exercise: id, still: true, phase: THUMB_PHASE[id] ?? 0.3, className: 'thumb__ghost' });
  }
  hero = mountGhost(el.stage, { exercise: pick.exercise, sway: true, className: 'carousel__ghost' });
  el.prev.addEventListener('click', () => step(-1));
  el.next.addEventListener('click', () => step(1));
  for (const f of ARENA_FORMATS) {
    const b = option('seg__item seg__item--stack', () => set({ durationMs: f.ms }));
    b.dataset.value = String(f.ms);
    b.append(span('seg__name', f.name), span('seg__time', f.short));
    el.dur.append(b);
  }
  for (const bot of BOTS) {
    const b = option('bot', () => set({ bot }));
    b.dataset.value = bot.id;
    const level = span('bot__level', '');
    level.setAttribute('aria-hidden', 'true');
    for (let i = 1; i <= 3; i += 1) level.append(span(i <= bot.level ? 'is-on' : '', ''));
    b.append(level, span('bot__name', bot.name), span('bot__pace', ''));
    el.bots.append(b);
  }
  render();
}

/** Стрелки карусели: соседнее упражнение по кругу. */
export function step(by: number): void {
  const i = DUEL_EXERCISE_IDS.indexOf(pick.exercise);
  const n = DUEL_EXERCISE_IDS.length;
  set({ exercise: DUEL_EXERCISE_IDS[(i + by + n) % n]! });
}

function set(next: Partial<Pick>): void {
  Object.assign(pick, next);
  save();
  render();
  changed();
}

function render(): void {
  mark(el.grid, pick.exercise);
  mark(el.dur, String(pick.durationMs));
  mark(el.bots, pick.bot.id);
  for (const b of el.bots.querySelectorAll<HTMLElement>('.bot')) {
    const bot = findBot(b.dataset.value ?? null);
    b.querySelector('.bot__pace')!.textContent =
      `≈ ${botTotal(bot, pick.exercise, pick.durationMs)} за ${formatName(pick.durationMs)}`;
  }
  el.where.textContent = whereLabel(pick.exercise);
  el.name.textContent = exerciseTitle(pick.exercise);
  hero?.set({ exercise: pick.exercise });
  el.stage.classList.toggle('is-floor', isFloor(pick.exercise));
  // Выбранное превью — в видимой части полосы (саму страницу не прокручиваем).
  const on = el.grid.querySelector<HTMLElement>('.thumb.is-active');
  const g = el.grid;
  if (on && (on.offsetLeft < g.scrollLeft || on.offsetLeft + on.offsetWidth > g.scrollLeft + g.clientWidth))
    g.scrollLeft = on.offsetLeft - (g.clientWidth - on.offsetWidth) / 2;
  el.sumEx.textContent = exerciseTitle(pick.exercise);
  el.sumMeta.textContent = `${formatName(pick.durationMs)} · против бота «${pick.bot.name}»`;
  el.tip.textContent = cameraTip(pick.exercise);
}

function mark(group: HTMLElement, value: string): void {
  for (const b of group.querySelectorAll<HTMLElement>('[role="radio"]')) {
    const on = b.dataset.value === value;
    b.setAttribute('aria-checked', String(on));
    b.classList.toggle('is-active', on);
    b.tabIndex = on ? 0 : -1;
  }
}

/** Кнопка-«радио»: стрелки двигают выбор внутри группы, как у настоящих радиокнопок. */
function option(className: string, onPick: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = className;
  b.setAttribute('role', 'radio');
  b.addEventListener('click', onPick);
  b.addEventListener('keydown', (e) => {
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
    if (!step) return;
    e.preventDefault();
    const all = [...b.parentElement!.querySelectorAll<HTMLButtonElement>('[role="radio"]')];
    const next = all[(all.indexOf(b) + step + all.length) % all.length]!;
    next.click();
    next.focus();
  });
  return b;
}

function span(className: string, text: string): HTMLSpanElement {
  const s = document.createElement('span');
  if (className) s.className = className;
  s.textContent = text;
  return s;
}

function load(): { exercise?: unknown; durationMs?: unknown; bot?: unknown } {
  try {
    return JSON.parse(localStorage.getItem(STORE_KEY) ?? '{}') as Record<string, unknown>;
  } catch {
    return {};
  }
}

function save(): void {
  try {
    localStorage.setItem(
      STORE_KEY,
      JSON.stringify({ exercise: pick.exercise, durationMs: pick.durationMs, bot: pick.bot.id }),
    );
  } catch {
    /* приватный режим — не помним, не страшно */
  }
}
