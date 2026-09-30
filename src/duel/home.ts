// Арена дуэлей — главный экран страницы: кто онлайн и сколько ищут бой, профиль, «Твой рейтинг» с кривой
// кубков, последние дуэли, топ игроков, окна «Сыграть с другом», «Бой с ботом», «Правила», таблица и история.
// Данные — с сервера (API и сокет онлайн-дуэли); гостю арена выглядит так же, только без своих цифр.
// Все ники — через textContent: они приходят от других людей.

import {
  ARENA_TITLES,
  formatById,
  type ArenaFormatId,
  type ArenaHistory,
  type HistoryItem,
  type LadderEntry,
  type LadderPeriod,
} from '../shared/arena';
import { api } from './api';
import { face } from './face';
import { duelExercise, exerciseTitle, plural } from './labels';
import { onlineDuel } from './online';
import { picked } from './picker';
import { accountState, logout, openLogin } from './social';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const el = {
  onlineCount: $<HTMLElement>('online-count'),
  seekers: $<HTMLElement>('seekers'),
  find: $<HTMLButtonElement>('find'),
  findLabel: $<HTMLElement>('find-label'),
  findSticky: $<HTMLButtonElement>('find-sticky'),
  findStickyLabel: $<HTMLElement>('find-sticky-label'),
  profile: $<HTMLElement>('profile'),
  ratingBody: $<HTMLElement>('rating-body'),
  recent: $<HTMLUListElement>('recent-list'),
  history: $<HTMLUListElement>('history-list'),
  historySheet: $<HTMLDialogElement>('history-sheet'),
  top: $<HTMLOListElement>('top-list'),
  topFormat: $<HTMLSelectElement>('top-format'),
  topPeriod: $<HTMLSelectElement>('top-period'),
  friendSheet: $<HTMLDialogElement>('friend-sheet'),
  friendLead: $<HTMLElement>('friend-lead'),
  botSheet: $<HTMLDialogElement>('bot-sheet'),
  rules: $<HTMLDialogElement>('rules'),
  rulesTitles: $<HTMLUListElement>('rules-titles'),
  ladderSheet: $<HTMLDialogElement>('ladder-sheet'),
};

const CLEAN_KEY = 'forma.duel.clean';
const SVG = 'http://www.w3.org/2000/svg';

let history: ArenaHistory | null = null;
/** Доля чистых повторов (0–1) или null — ещё не из чего считать. */
let cleanShare: number | null = null;
let topSeq = 0;

export function initHome(): void {
  $<HTMLButtonElement>('friend-open').addEventListener('click', () => {
    paintFriendLead();
    el.friendSheet.showModal();
  });
  $<HTMLButtonElement>('bot-open').addEventListener('click', () => el.botSheet.showModal());
  $<HTMLButtonElement>('rules-open').addEventListener('click', () => el.rules.showModal());
  $<HTMLButtonElement>('recent-all').addEventListener('click', () => {
    paintHistory(el.history, 20);
    el.historySheet.showModal();
  });
  $<HTMLButtonElement>('ladder-open').addEventListener('click', () => el.ladderSheet.showModal());
  el.topFormat.addEventListener('change', () => void loadTop());
  el.topPeriod.addEventListener('change', () => void loadTop());
  // Клик по затемнению вокруг окна — закрыть (как у окон платформы).
  for (const d of document.querySelectorAll<HTMLDialogElement>('dialog.sheet'))
    d.addEventListener('click', (e) => {
      if (e.target === d) d.close();
    });
  // Телефон: основная кнопка боя ушла из виду — показываем её копию внизу экрана.
  el.findSticky.addEventListener('click', () => el.find.click());
  if ('IntersectionObserver' in window)
    new IntersectionObserver(([e]) => {
      el.findSticky.hidden = !!e?.isIntersecting || window.innerWidth > 560;
    }).observe(el.find);
  // Выбрал разряд слева — топ показывает его же.
  el.topFormat.value = formatOf(picked().durationMs) ?? '';
  paintTitles();
  paintAll();
  void refreshHome();
}

/** Перечитать свои данные: вход, выход, конец боя. */
export async function refreshHome(): Promise<void> {
  const { me } = accountState();
  paintAll();
  void loadTop();
  if (!me) {
    history = null;
    cleanShare = localClean();
    paintAll();
    return;
  }
  const [h, progress] = await Promise.all([
    api.history(20).catch(() => null),
    api.progress().catch(() => null),
  ]);
  history = h;
  cleanShare = mergeClean(progress);
  paintAll();
}

/** Выбор слева поменялся: счётчик «ищут бой» и топ — про этот разряд. */
export function pickChanged(): void {
  paintSeekers();
  const f = formatOf(picked().durationMs) ?? '';
  if (el.topFormat.value !== f) {
    el.topFormat.value = f;
    void loadTop();
  }
}

export function paintStats(): void {
  const n = onlineDuel.onlineCount();
  el.onlineCount.textContent =
    n === null ? 'Подключаемся…' : `${fmt(n)} ${plural(n, 'игрок', 'игрока', 'игроков')} онлайн`;
  el.onlineCount.classList.toggle('is-live', n !== null);
  paintSeekers();
}

/** Дуэль сыграна — посчитать чистые повторы (в карточке рейтинга). */
export function recordClean(reps: number, clean: number): void {
  if (reps <= 0) return;
  const prev = readClean();
  try {
    localStorage.setItem(
      CLEAN_KEY,
      JSON.stringify({ reps: prev.reps + reps, clean: prev.clean + Math.min(clean, reps) }),
    );
  } catch {
    /* приватный режим — без статистики */
  }
}

function paintAll(): void {
  paintStats();
  paintFind();
  paintProfile();
  paintRating();
  paintHistory(el.recent, 4);
}

function paintSeekers(): void {
  const p = picked();
  const { board, total } = onlineDuel.seekers(p.exercise, p.durationMs);
  if (onlineDuel.onlineCount() === null) {
    el.seekers.textContent = '';
    return;
  }
  el.seekers.textContent = board
    ? `≈ ${fmt(board)} ${plural(board, 'игрок ищет', 'игрока ищут', 'игроков ищут')} бой`
    : total
      ? `≈ ${fmt(total)} ${plural(total, 'игрок ищет', 'игрока ищут', 'игроков ищут')} бой на арене`
      : 'Пока никто не ищет — стань первым, подберём, как только кто-то придёт';
}

function paintFind(): void {
  const { me, known, online } = accountState();
  el.findLabel.textContent = known && online && !me ? 'Войти, чтобы играть' : 'Найти соперника';
  el.findStickyLabel.textContent = el.findLabel.textContent;
}

function paintProfile(): void {
  const { me, standing, known } = accountState();
  el.profile.replaceChildren();
  const avatar = face(me?.nick ?? 'Гость', standing?.frame ?? null, 44);
  if (standing?.title) avatar.title = standing.title.name;
  const who = div('profile__who');
  who.append(
    text('b', 'profile__nick', me ? me.nick : 'Гость'),
    text('span', 'profile__title', me ? (standing?.title?.name ?? 'Без титула') : 'Кубки — с аккаунтом'),
  );
  el.profile.append(avatar, who);
  if (me) {
    const cups = div('profile__cups');
    cups.append(text('b', '', fmt(standing?.cups ?? 0)), trophy());
    cups.setAttribute('aria-label', `Кубков: ${standing?.cups ?? 0}`);
    const out = button('Выйти', 'link profile__out');
    out.addEventListener('click', () => void logout());
    el.profile.append(cups, out);
  } else if (known) {
    const login = button('Войти', 'btn btn--sm');
    login.addEventListener('click', () => openLogin());
    el.profile.append(login);
  }
}

function paintRating(): void {
  const { me, standing } = accountState();
  const body = el.ratingBody;
  body.replaceChildren();
  const big = div('rating__big');
  big.append(text('b', '', fmt(me ? (standing?.cups ?? 0) : 0)), trophy());
  const title = text(
    'p',
    'rating__title',
    me ? (standing?.title?.name ?? 'Без титула') : 'Сыграй с аккаунтом — появятся кубки и титул',
  );
  body.append(big, title);
  if (me && standing?.nextTitle)
    body.append(
      text('p', 'rating__next', `До «${standing.nextTitle.name}» — ${fmt(standing.nextTitle.left)}`),
    );
  const wins = standing ? standing.formats.reduce((s, f) => s + f.wins, 0) : 0;
  const stats = div('rating__stats');
  stats.append(
    stat(fmt(wins), plural(wins, 'победа', 'победы', 'побед')),
    stat(cleanShare === null ? '—' : `${Math.round(cleanShare * 100)}%`, 'чистых повторов'),
  );
  body.append(stats, chart(history?.curve ?? []));
  const more = document.createElement('a');
  more.className = 'btn btn--sm rating__more';
  more.href = `${import.meta.env.BASE_URL}app/progress`;
  more.append('Подробнее', arrow());
  body.append(more);
}

function stat(value: string, label: string): HTMLElement {
  const s = div('rating__stat');
  s.append(text('b', '', value), text('span', '', label));
  return s;
}

/** Кривая кубков по истории боёв: оранжевая линия и мягкая заливка под ней. */
function chart(curve: { at: number; cups: number }[]): HTMLElement {
  const wrap = div('rating__chart');
  if (curve.length < 3) {
    wrap.classList.add('is-empty');
    wrap.append(text('span', '', 'График появится после пары боёв'));
    return wrap;
  }
  const W = 300;
  const H = 84;
  const max = Math.max(...curve.map((p) => p.cups));
  const min = Math.min(...curve.map((p) => p.cups));
  const span = max - min;
  // Ровно (одни ничьи) — линия посередине, а не по дну.
  const pts = curve.map((p, i) => [
    (i / (curve.length - 1)) * W,
    span ? H - 6 - ((p.cups - min) / span) * (H - 16) : H / 2,
  ]);

  const line = pts.map(([x, y]) => `${x!.toFixed(1)},${y!.toFixed(1)}`).join(' ');
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', `Кубки за последние бои: от ${min} до ${max}`);
  const defs = document.createElementNS(SVG, 'defs');
  const grad = document.createElementNS(SVG, 'linearGradient');
  grad.id = 'cups-fill';
  grad.setAttribute('x1', '0');
  grad.setAttribute('x2', '0');
  grad.setAttribute('y1', '0');
  grad.setAttribute('y2', '1');
  for (const [off, op] of [
    ['0', '0.32'],
    ['1', '0'],
  ] as const) {
    const stop = document.createElementNS(SVG, 'stop');
    stop.setAttribute('offset', off);
    stop.setAttribute('stop-color', '#f97316');
    stop.setAttribute('stop-opacity', op);
    grad.append(stop);
  }
  defs.append(grad);
  const area = document.createElementNS(SVG, 'polygon');
  area.setAttribute('points', `0,${H} ${line} ${W},${H}`);
  area.setAttribute('fill', 'url(#cups-fill)');
  const path = document.createElementNS(SVG, 'polyline');
  path.setAttribute('points', line);
  path.setAttribute('class', 'rating__line');
  svg.append(defs, area, path);
  wrap.append(svg);
  return wrap;
}

function paintHistory(list: HTMLUListElement, limit: number): void {
  list.replaceChildren();
  const { me } = accountState();
  const items = history?.matches.slice(0, limit) ?? [];
  if (!items.length) {
    list.append(
      text(
        'li',
        'recent__empty',
        me ? 'Пока без дуэлей — найди соперника, и бой появится здесь.' : 'Войди — здесь будут твои бои.',
      ),
    );
    return;
  }
  for (const m of items) list.append(historyRow(m));
}

function historyRow(m: HistoryItem): HTMLLIElement {
  const li = text('li', 'recent__row', '');
  li.dataset.outcome = m.outcome;
  const avatar = face(m.opponent.nick, m.opponent.frame, 32);
  if (m.opponent.title) avatar.title = m.opponent.title;
  const who = div('recent__who');
  who.append(
    text('b', '', m.opponent.nick),
    text('span', 'recent__score', `${m.reps} — ${m.oppReps}`),
    text('small', 'recent__ex', `${exerciseTitle(duelExercise(m.exercise))} · ${formatById(m.format).name}`),
  );
  const pill = text(
    'span',
    'pill',
    m.outcome === 'win' ? 'Победа' : m.outcome === 'lose' ? 'Поражение' : 'Ничья',
  );
  li.append(avatar, who, pill);
  li.setAttribute(
    'aria-label',
    `${m.opponent.nick}: ${m.reps} — ${m.oppReps}, ${pill.textContent}${m.cupsDelta ? `, кубки ${m.cupsDelta > 0 ? '+' : ''}${m.cupsDelta}` : ''}`,
  );
  return li;
}

async function loadTop(): Promise<void> {
  const token = ++topSeq;
  const format = (el.topFormat.value || null) as ArenaFormatId | null;
  const period = el.topPeriod.value as LadderPeriod;
  try {
    const data = await api.ladder(format, null, period);
    if (token !== topSeq) return;
    el.top.replaceChildren();
    const rows = data.rows.slice(0, 5);
    const mine = data.rows.find((r) => r.me) ?? data.me;
    if (!rows.length) {
      el.top.append(
        text(
          'li',
          'top__empty',
          period === 'week' ? 'На этой неделе ещё никто не играл — стань первым.' : 'Пока никто не играл.',
        ),
      );
      return;
    }
    for (const r of rows) el.top.append(topRow(r, period));
    if (mine && !rows.some((r) => r.me)) el.top.append(topRow(mine, period));
  } catch (err) {
    if (token !== topSeq) return;
    el.top.replaceChildren(text('li', 'top__empty', (err as Error).message));
  }
}

function topRow(r: LadderEntry, period: LadderPeriod): HTMLLIElement {
  const li = text('li', r.me ? 'top__row is-me' : 'top__row', '');
  const avatar = face(r.nick, r.frame, 28);
  if (r.title) avatar.title = r.title;
  const cups = div('top__cups');
  const n = period === 'week' && r.cups > 0 ? `+${fmt(r.cups)}` : fmt(r.cups);
  cups.append(trophy(), text('span', '', n));
  li.append(text('span', 'top__rank', String(r.rank)), avatar, text('b', 'top__nick', r.nick), cups);
  return li;
}

function paintFriendLead(): void {
  const { me, online } = accountState();
  el.friendLead.replaceChildren();
  if (!online) {
    el.friendLead.append('Дуэли с друзьями работают на основном сайте.');
    return;
  }
  if (me) {
    el.friendLead.append(
      'Позови игрока — приглашение придёт сразу, если он в сети, или когда он откроет арену. Можно и ссылкой.',
    );
    return;
  }
  el.friendLead.append('Дуэль с другом — с аккаунтом: так кубки достанутся тому, кто их заработал. ');
  const login = button('Войти', 'btn btn--sm btn--primary');
  login.addEventListener('click', () => {
    el.friendSheet.close();
    openLogin();
  });
  el.friendLead.append(login);
}

function paintTitles(): void {
  el.rulesTitles.replaceChildren();
  for (const t of ARENA_TITLES) {
    const li = text('li', 'titles__row', '');
    const f = face(t.name, t.id, 26);
    li.append(f, text('b', '', t.name), text('span', '', `от ${fmt(t.min)}`), trophy());
    el.rulesTitles.append(li);
  }
}

// ——— Чистые повторы: тренировки платформы + дуэли на этом устройстве ———
function readClean(): { reps: number; clean: number } {
  try {
    const v = JSON.parse(localStorage.getItem(CLEAN_KEY) ?? '{}') as { reps?: unknown; clean?: unknown };
    return {
      reps: typeof v.reps === 'number' ? v.reps : 0,
      clean: typeof v.clean === 'number' ? v.clean : 0,
    };
  } catch {
    return { reps: 0, clean: 0 };
  }
}

function localClean(): number | null {
  const c = readClean();
  return c.reps ? c.clean / c.reps : null;
}

function mergeClean(
  progress: { boards: Record<string, { history: { reps: number; cleanReps: number }[] }> } | null,
): number | null {
  const c = readClean();
  let reps = c.reps;
  let clean = c.clean;
  for (const b of Object.values(progress?.boards ?? {}))
    for (const h of b.history) {
      reps += h.reps;
      clean += Math.min(h.cleanReps, h.reps);
    }
  return reps ? clean / reps : null;
}

// ——— Мелочи ———
function formatOf(ms: number): ArenaFormatId | null {
  return ms === 30_000 ? 'bullet' : ms === 60_000 ? 'blitz' : ms === 180_000 ? 'rapid' : null;
}

function fmt(n: number): string {
  return Math.round(n).toLocaleString('ru-RU');
}

/** Кубок — SVG, как в макете (без эмодзи). */
export function trophy(): SVGSVGElement {
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', 'trophy');
  svg.setAttribute('aria-hidden', 'true');
  const cup = document.createElementNS(SVG, 'path');
  cup.setAttribute(
    'd',
    'M7 3.5h10v5.2a5 5 0 0 1-10 0zM7 5.5H4.2v1.2A3.6 3.6 0 0 0 7.4 10.3M17 5.5h2.8v1.2a3.6 3.6 0 0 1-3.2 3.6M12 13.7v3.3M8.3 20.5h7.4l-.8-3.5H9.1z',
  );
  svg.append(cup);
  return svg;
}

function arrow(): SVGSVGElement {
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', 'arrow');
  svg.setAttribute('aria-hidden', 'true');
  const p = document.createElementNS(SVG, 'path');
  p.setAttribute('d', 'M5 12h13M13 6l6 6-6 6');
  svg.append(p);
  return svg;
}

function div(className: string): HTMLDivElement {
  const d = document.createElement('div');
  d.className = className;
  return d;
}

function button(label: string, className: string): HTMLButtonElement {
  const b = text('button', className, label);
  b.type = 'button';
  return b;
}

function text<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, value: string) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  node.textContent = value;
  return node;
}
