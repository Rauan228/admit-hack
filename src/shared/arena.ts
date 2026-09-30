// Арена дуэли: три разряда как в шахматах, и у каждого упражнения в каждом разряде свой рейтинг.
// Кубки растут за победу и падают за поражение, но не ниже нуля. Опыт — только за победу.
// Титул и рамка — по сумме кубков со всех досок. Файл без импортов: его же считает сервер.

export const ARENA_FORMATS = [
  { id: 'bullet', ms: 30_000, name: 'Пуля', short: '30 с', xp: 12 },
  { id: 'blitz', ms: 60_000, name: 'Блиц', short: '1 мин', xp: 25 },
  { id: 'rapid', ms: 180_000, name: 'Рапид', short: '3 мин', xp: 50 },
] as const;

export type ArenaFormatId = (typeof ARENA_FORMATS)[number]['id'];

/** Длительности соревновательного боя. 15 с больше нет — только три разряда. */
export const ARENA_DURATIONS: readonly number[] = ARENA_FORMATS.map((f) => f.ms);

/** Пороги титула. id рамки совпадает с id титула: рамка появляется вместе с титулом. */
export const ARENA_TITLES = [
  { id: 'spark', min: 15, name: 'Искра' },
  { id: 'fighter', min: 50, name: 'Боец' },
  { id: 'athlete', min: 120, name: 'Атлет' },
  { id: 'gladiator', min: 250, name: 'Гладиатор' },
  { id: 'master', min: 500, name: 'Мастер темпа' },
  { id: 'champion', min: 900, name: 'Чемпион арены' },
  { id: 'legend', min: 1500, name: 'Легенда' },
  { id: 'titan', min: 2500, name: 'Титан' },
] as const;

export type ArenaFrame = (typeof ARENA_TITLES)[number]['id'];
export type ArenaOutcome = 'win' | 'lose' | 'draw';

/** K как в блице: равные делят ожидание пополам, фаворит берёт мало, андердог — много. */
const K = 32;

export interface ArenaTitle {
  id: ArenaFrame;
  name: string;
}

export interface AwardView {
  outcome: ArenaOutcome;
  /** Сколько кубков реально прибавилось или убавилось (после пола в ноль). */
  cupsDelta: number;
  xpDelta: number;
  totalCups: number;
  title: string | null;
  frame: ArenaFrame | null;
  titleChanged: boolean;
}

export interface LadderEntry {
  rank: number;
  nick: string;
  cups: number;
  xp: number;
  wins: number;
  losses: number;
  draws: number;
  title: string | null;
  frame: ArenaFrame | null;
  me: boolean;
}

export interface LadderData {
  format: ArenaFormatId | null;
  exercise: string | null;
  rows: LadderEntry[];
  me: LadderEntry | null;
}

/** Бой из истории — глазами игрока. */
export interface HistoryItem {
  id: string;
  exercise: string;
  format: ArenaFormatId;
  /** live — бой онлайн, async — ответ на вызов. */
  kind: 'live' | 'async';
  opponent: { nick: string; title: string | null; frame: ArenaFrame | null };
  reps: number;
  oppReps: number;
  outcome: ArenaOutcome;
  cupsDelta: number;
  at: number;
}

export interface ArenaHistory {
  /** Последние бои, новые — первыми. */
  matches: HistoryItem[];
  /** Сумма кубков после каждого боя (от старых к новым, не больше 30 точек; первая — до них). */
  curve: { at: number; cups: number }[];
  /** Всего побед за все бои. */
  wins: number;
  total: number;
}

export type LadderPeriod = 'all' | 'week';

export interface ArenaFormatStanding {
  id: ArenaFormatId;
  name: string;
  cups: number;
  wins: number;
  losses: number;
  draws: number;
}

export interface ArenaBoardStanding {
  exercise: string;
  format: ArenaFormatId;
  cups: number;
  xp: number;
  wins: number;
  losses: number;
  draws: number;
}

export interface ArenaStanding {
  cups: number;
  xp: number;
  level: number;
  /** Опыт внутри текущего уровня. */
  into: number;
  /** Сколько опыта нужно, чтобы закрыть уровень. */
  span: number;
  title: ArenaTitle | null;
  frame: ArenaFrame | null;
  nextTitle: { name: string; left: number } | null;
  formats: ArenaFormatStanding[];
  boards: ArenaBoardStanding[];
}

export function isArenaFormat(x: unknown): x is ArenaFormatId {
  return typeof x === 'string' && ARENA_FORMATS.some((f) => f.id === x);
}

export function formatByMs(ms: number): (typeof ARENA_FORMATS)[number] | null {
  return ARENA_FORMATS.find((f) => f.ms === ms) ?? null;
}

export function formatById(id: ArenaFormatId): (typeof ARENA_FORMATS)[number] {
  return ARENA_FORMATS.find((f) => f.id === id) ?? ARENA_FORMATS[1];
}

/** Высший титул, чей порог уже взят. До 15 кубков рамки нет. */
export function titleFor(cups: number): ArenaTitle | null {
  let found: ArenaTitle | null = null;
  for (const t of ARENA_TITLES) if (cups >= t.min) found = { id: t.id, name: t.name };
  return found;
}

export function nextTitle(cups: number): { name: string; min: number; left: number } | null {
  const n = ARENA_TITLES.find((t) => t.min > cups);
  return n ? { name: n.name, min: n.min, left: n.min - cups } : null;
}

/**
 * Уровень с опыта. До 2-го — 40, дальше ступень шире: 20·L·(L+1).
 * Уровень только растёт: опыт за поражение не снимается.
 */
export function levelProgress(xp: number): { level: number; into: number; span: number } {
  const safe = Math.max(0, Math.floor(xp));
  let level = 1;
  while (level < 99 && 20 * level * (level + 1) <= safe) level += 1;
  const start = 20 * (level - 1) * level;
  const nextAt = 20 * level * (level + 1);
  return { level, into: safe - start, span: nextAt - start };
}

/** Ожидаемая доля очков по кубкам этой доски (упражнение × разряд), не по общей сумме. */
export function cupDelta(myCups: number, oppCups: number, outcome: ArenaOutcome): number {
  if (outcome === 'draw') return 0;
  const expected = 1 / (1 + 10 ** ((oppCups - myCups) / 400));
  const score = outcome === 'win' ? 1 : 0;
  let delta = Math.round(K * (score - expected));
  // Победа всегда даёт хотя бы кубок, поражение всегда снимает хотя бы один — если они есть.
  if (outcome === 'win') delta = Math.max(1, delta);
  if (outcome === 'lose') delta = Math.min(-1, delta);
  return delta;
}

/** Новое число кубков и сколько реально сдвинулось. Ниже нуля не уходит. */
export function applyCups(cups: number, delta: number): { cups: number; applied: number } {
  const next = Math.max(0, cups + delta);
  return { cups: next, applied: next - cups };
}

/** Опыт только за победу. База разряда плюс небольшая прибавка, если соперник был богаче по этой доске. */
export function xpGain(
  format: ArenaFormatId,
  myCups: number,
  oppCups: number,
  outcome: ArenaOutcome,
): number {
  if (outcome !== 'win') return 0;
  const upset = Math.max(0, Math.round((oppCups - myCups) / 40));
  return formatById(format).xp + Math.min(30, upset);
}

function ru(n: number, one: string, few: string, many: string): string {
  const v = Math.abs(Math.trunc(n));
  const d = v % 10;
  const dd = v % 100;
  if (d === 1 && dd !== 11) return one;
  if (d >= 2 && d <= 4 && (dd < 12 || dd > 14)) return few;
  return many;
}

export function cupsLabel(n: number): string {
  return `${n} ${ru(n, 'кубок', 'кубка', 'кубков')}`;
}

/** Строка под итогом боя. */
export function describeAward(a: AwardView): string {
  if (a.outcome === 'draw') return 'Ничья — кубки и опыт не изменились.';
  if (a.outcome === 'win') {
    const xp = a.xpDelta > 0 ? `, +${a.xpDelta} опыта` : '';
    const title =
      a.titleChanged && a.title ? ` Новый титул — ${a.title}.` : a.titleChanged ? ' Титул снят.' : '';
    return `+${cupsLabel(a.cupsDelta)}${xp}. Всего ${cupsLabel(a.totalCups)}.${title}`;
  }
  if (a.cupsDelta === 0) return 'Поражение. Кубки не списались — меньше нуля не бывает.';
  const dropped = a.titleChanged ? (a.title ? ` Теперь титул — ${a.title}.` : ' Титул снят.') : '';
  return `Поражение: −${cupsLabel(Math.abs(a.cupsDelta))}. Осталось ${cupsLabel(a.totalCups)}.${dropped}`;
}
