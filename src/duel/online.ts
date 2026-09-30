// E-26: онлайн-дуэль на странице — «Онлайн сейчас» и «Позвать», приглашение поверх любого экрана,
// вход по ссылке #r=<комната>, лобби на экране подготовки («Готов»), итог — от сервера.
// Время боя назначает сервер; страница только переводит его часы в свои (Live.toLocal).
// Арена: подбор соперника — «seek» в очередь сервера, пара приходит обычной комнатой (room.matched).
// Все имена — через textContent: ники и имена гостей приходят от других людей.

import { cupsLabel, type AwardView } from '../shared/arena';
import type { DuelExercise } from '../shared/duel';
import type { RoomView, ServerMsg } from '../shared/duelRoom';
import { api, type Player } from './api';
import { face } from './face';
import { exerciseTitle, formatName } from './labels';
import { Live } from './live';
import { picked, roomDuration } from './picker';
import { openLogin, refreshRank } from './social';

export interface OnlineHooks {
  /** Вошли в комнату — нужна камера (экран подготовки). */
  enterRoom(): void;
  /** Сервер назначил общий отсчёт: его начало по часам страницы. */
  countdown(startLocal: number, durationMs: number, countdownMs: number): void;
  /** Бой окончен по серверу (приходит и повторно — если поздний повтор изменил счёт). */
  over(view: RoomView): void;
  /** Кубки этого раунда — после окна поздних повторов. */
  award(a: AwardView & { room: string; round: number }): void;
  /** Вышли из комнаты. */
  leftRoom(): void;
  /** Любое новое состояние комнаты (экран «Соперник найден» следит за соперником). */
  room?(view: RoomView): void;
  /** Поиск соперника: идёт (с какого момента по часам страницы) или снят (null). */
  seeking?(s: SeekState | null): void;
  /** Сколько людей на арене и сколько ищут бой. */
  stats?(): void;
  /** Сервер отказал (для экрана поиска). */
  error?(message: string): void;
}

export interface SeekState {
  exercise: string;
  durationMs: number;
  /** Начало поиска по performance.now() страницы. */
  since: number;
  /** Сколько ещё ищут на этой доске. */
  queue: number;
}

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const el = {
  app: $<HTMLElement>('app'),
  section: $<HTMLElement>('online'),
  list: $<HTMLUListElement>('online-list'),
  search: $<HTMLInputElement>('online-search'),
  toastEx: $<HTMLElement>('toast-ex'),
  create: $<HTMLButtonElement>('online-create'),
  note: $<HTMLParagraphElement>('online-note'),
  card: $<HTMLDivElement>('room-card'),
  lobby: $<HTMLDivElement>('lobby'),
  lobbyPlayers: $<HTMLUListElement>('lobby-players'),
  lobbyOpp: $<HTMLParagraphElement>('lobby-opp'),
  lobbyShare: $<HTMLButtonElement>('lobby-share'),
  lobbyLink: $<HTMLInputElement>('lobby-link'),
  toast: $<HTMLDivElement>('invite-toast'),
  toastFrom: $<HTMLElement>('toast-from'),
  toastAccept: $<HTMLButtonElement>('toast-accept'),
  toastDecline: $<HTMLButtonElement>('toast-decline'),
};

let hooks: OnlineHooks;
let live: Live;
/** null и до приветствия, и у гостя. meKnown отличает «ещё не знаем» от «аккаунта нет». */
let me: string | null = null;
let meKnown = false;
let online: string[] = [];
let view: RoomView | null = null;
let entered: string | null = null;
let countdownRound = 0;
/** Кого позвать, как только комната будет создана. */
let pendingInvite: string | null = null;
let toastRoom: { room: string; from: string } | null = null;
/** Все игроки приложения (поиск по нику) — звать можно любого, не только тех, кто в сети. */
let players: Player[] = [];
/** Кого уже позвали в эту комнату: ник (нижний регистр) → пришло сразу / ждёт, когда он откроет дуэль. */
const called = new Map<string, 'online' | 'waiting'>();
let sending: string | null = null;
let seekState: SeekState | null = null;
/** Что просили у сервера: после обрыва связи поиск надо поставить заново. */
let seekWant: { exercise: string; durationMs: number } | null = null;
let stats: { online: number; seeking: Record<string, number> } | null = null;

/** Создать комнату с тем, что выбрано на вступлении: упражнение и время боя (E-29, E-30). */
function createRoom(): void {
  if (meKnown && !me) {
    openLogin();
    return;
  }
  live.create(picked().exercise, roomDuration());
}

export function initOnline(h: OnlineHooks): void {
  hooks = h;
  live = new Live({
    message: onMessage,
    connected: (on) => {
      renderList();
      // Сервер снимает поиск при обрыве — вернулись в сеть, встаём в очередь снова.
      if (on && seekWant) live.send({ t: 'seek', ...seekWant });
    },
  });
  live.connect();
  el.create.addEventListener('click', () => {
    pendingInvite = null;
    createRoom();
  });
  el.lobbyShare.addEventListener('click', () => void shareRoom());
  let debounce = 0;
  el.search.addEventListener('input', () => {
    clearTimeout(debounce);
    debounce = window.setTimeout(() => void loadPlayers(), 250);
  });
  el.toastAccept.addEventListener('click', () => {
    if (meKnown && !me) {
      hideToast();
      openLogin();
      return;
    }
    if (toastRoom) live.join(toastRoom.room);
    hideToast();
  });
  el.toastDecline.addEventListener('click', () => {
    if (toastRoom) live.send({ t: 'decline', room: toastRoom.room, from: toastRoom.from });
    hideToast();
  });
  showRoomCard();
  window.addEventListener('hashchange', showRoomCard);
}

/** Вошёл или вышел на странице — переподключиться, чтобы сервер узнал игрока. */
export function reconnectOnline(leave = false): void {
  if (leave) {
    me = null;
    meKnown = true;
    live.dropRoom();
    called.clear();
    view = entered = null;
    countdownRound = 0;
    renderLobby();
    hooks.leftRoom();
  }
  live.reconnect();
}

/** Онлайн-дуэль для main.ts. */
export const onlineDuel = {
  active: () => !!view,
  oppName: () => (view ? (view.players[1 - view.you]?.name ?? 'Соперник') : ''),
  oppReps: () => (view ? (view.players[1 - view.you]?.reps ?? 0) : 0),
  exercise: (): DuelExercise => view?.exercise ?? 'push_up',
  durationMs: () => view?.durationMs ?? 60_000,
  round: () => view?.round ?? 0,
  me: () => (view ? view.players[view.you] : undefined),
  opponent: () => (view ? view.players[1 - view.you] : undefined),
  ready: () => live.send({ t: 'ready', ready: true }),
  rep: () => live.send({ t: 'rep' }),
  giveUp: () => live.send({ t: 'giveup' }),
  leave: () => live.send({ t: 'leave' }),
  matched: () => !!view?.matched,
  view: () => view,
  /** Встать в очередь подбора (только с аккаунтом — иначе откроется вход). */
  seek(exercise: string, durationMs: number): boolean {
    if (meKnown && !me) {
      openLogin();
      return false;
    }
    // Из лобби прошлой комнаты (реванш, соперник ушёл) — выходим молча: экран поиска уже на месте.
    if (view) {
      live.dropRoom();
      called.clear();
      view = entered = null;
      countdownRound = 0;
      renderLobby();
    }
    seekWant = { exercise, durationMs };
    seekState = { exercise, durationMs, since: performance.now(), queue: 0 };
    live.send({ t: 'seek', exercise, durationMs });
    hooks.seeking?.(seekState);
    return true;
  },
  cancelSeek(): void {
    const was = !!seekWant;
    seekWant = seekState = null;
    if (was) live.send({ t: 'cancel_seek' });
  },
  seeking: () => seekState,
  signedIn: () => !!me,
  accountKnown: () => meKnown,
  onlineCount: () => stats?.online ?? null,
  /** Ищут бой: на этой доске и всего. */
  seekers(exercise: string, durationMs: number): { board: number; total: number } {
    const all = stats?.seeking ?? {};
    const total = Object.values(all).reduce((a, b) => a + b, 0);
    return { board: all[`${exercise}:${durationMs}`] ?? 0, total };
  },
};

function onMessage(m: ServerMsg): void {
  switch (m.t) {
    case 'hello':
      meKnown = true;
      me = m.me;
      online = m.online;
      showRoomCard();
      return void loadPlayers();
    case 'presence': {
      online = m.online;
      // В сети появился тот, кого нет в списке (новый игрок) — перечитать список, иначе его не позвать.
      const known = new Set(players.map((p) => p.nick));
      if (me && online.some((n) => n !== me && !known.has(n)) && !el.search.value.trim())
        return void loadPlayers();
      return renderList();
    }
    case 'room':
      seekWant = seekState = null;
      return onRoom(m.room);
    case 'seeking':
      if (!seekWant) return; // отменили, пока ответ шёл
      seekState = {
        exercise: m.exercise,
        durationMs: m.durationMs,
        // После переподключения сервер начинает отсчёт заново — таймер на экране не сбрасываем.
        since: Math.min(seekState?.since ?? Infinity, performance.now() - Math.max(0, m.now - m.since)),
        queue: m.queue,
      };
      return hooks.seeking?.(seekState);
    case 'seek_cancelled':
      seekWant = seekState = null;
      return hooks.seeking?.(null);
    case 'stats':
      stats = { online: m.online, seeking: m.seeking };
      return hooks.stats?.();
    case 'invite_sent':
      sending = null;
      called.set(m.nick.toLowerCase(), m.online ? 'online' : 'waiting');
      if (!m.online && view)
        el.lobbyOpp.textContent = `${m.nick} сейчас не в сети — приглашение придёт, как только он откроет дуэль (15 минут). Можно ещё отправить ссылку.`;
      return renderList();
    case 'left':
      called.clear();
      view = entered = null;
      countdownRound = 0;
      renderLobby();
      return hooks.leftRoom();
    case 'award':
      refreshRank();
      return hooks.award(m);
    case 'invited':
      return showToast(m.room, m.from, m.exercise, m.durationMs);
    case 'declined':
      el.lobbyOpp.textContent = `${m.by} не может сейчас — позови кого-то ещё или отправь ссылку.`;
      return;
    case 'error':
      if (seekWant) {
        seekWant = seekState = null;
        hooks.seeking?.(null);
      }
      hooks.error?.(m.message);
      return showError(m.message);
  }
}

function onRoom(r: RoomView): void {
  view = r;
  if (entered !== r.id) {
    entered = r.id;
    countdownRound = 0;
    el.card.hidden = true;
    hooks.enterRoom();
  }
  if (pendingInvite && r.you === 0) {
    live.send({ t: 'invite', nick: pendingInvite });
    pendingInvite = null;
  }
  if ((r.phase === 'countdown' || r.phase === 'battle') && countdownRound !== r.round) {
    countdownRound = r.round;
    hooks.countdown(live.toLocal(r.startsAt) - r.countdownMs, r.durationMs, r.countdownMs);
  }
  if (r.phase === 'over') hooks.over(r);
  hooks.room?.(r);
  renderLobby();
}

// ——— Позвать на дуэль: все игроки, поиск, кто в сети — первыми ———
async function loadPlayers(): Promise<void> {
  if (me) {
    try {
      players = await api.players(el.search.value.trim());
    } catch (err) {
      players = [];
      el.note.textContent = (err as Error).message;
    }
  }
  renderList();
}

function renderList(): void {
  el.list.replaceChildren();
  el.section.hidden = false;
  el.search.hidden = !me;
  el.create.hidden = !me;
  // Без входа всё скажет блок аккаунта над списком.
  if (!me) {
    el.note.textContent = '';
    return;
  }
  const inNet = new Set(online.map((n) => n.toLowerCase()));
  const rows = players
    .filter((p) => p.nick !== me)
    .sort((a, b) => Number(inNet.has(b.nick.toLowerCase())) - Number(inNet.has(a.nick.toLowerCase())));
  el.note.textContent = rows.length
    ? ''
    : el.search.value.trim()
      ? 'Никого не нашли — проверь ник или отправь ссылку.'
      : 'Пока в приложении больше никого — отправь другу ссылку.';
  for (const p of rows) {
    const key = p.nick.toLowerCase();
    const on = inNet.has(key);
    const li = text('li', 'person', '');
    const dot = text('span', on ? 'person__online' : 'person__online person__online--off', '');
    dot.setAttribute('role', 'img');
    dot.setAttribute('aria-label', on ? 'в сети' : 'не в сети');
    const state = called.get(key);
    const call = text(
      'button',
      'btn btn--sm',
      sending === key
        ? 'Зовём…'
        : state === 'online'
          ? 'Позвали'
          : state === 'waiting'
            ? 'Ждёт входа'
            : 'Позвать',
    ) as HTMLButtonElement;
    call.type = 'button';
    call.disabled = !!state || sending === key;
    call.addEventListener('click', () => {
      sending = key;
      renderList();
      if (view && view.you === 0 && view.players.length < 2) live.send({ t: 'invite', nick: p.nick });
      else {
        pendingInvite = p.nick;
        createRoom();
      }
    });
    const bits = [p.title, p.cups ? cupsLabel(p.cups) : '', on ? 'в сети' : 'не в сети'].filter(
      (part): part is string => !!part,
    );
    const who = text('span', 'person__who', '');
    who.append(text('span', 'person__nick', p.nick), text('span', 'person__note', bits.join(' · ')));
    li.append(dot, face(p.nick, p.frame ?? null, 32), who, call);
    el.list.append(li);
  }
}

// ——— Вход по ссылке #r=<комната> ———
function showRoomCard(): void {
  const id = /^#r=([A-Za-z0-9]{6,12})$/.exec(location.hash)?.[1];
  el.card.replaceChildren();
  el.card.hidden = !id || entered === id;
  if (!id || entered === id) return;
  el.card.append(text('p', 'callout__title', 'Тебя зовут на дуэль онлайн'));
  if (!meKnown) {
    el.card.append(text('p', 'callout__text', 'Подключаемся…'));
    return;
  }
  if (!me) {
    el.card.append(
      text(
        'p',
        'callout__text',
        'Соревновательная дуэль открыта после регистрации. Бой с ботом — без аккаунта.',
      ),
    );
    const go = text('button', 'btn btn--primary callout__go', 'Зарегистрироваться') as HTMLButtonElement;
    go.type = 'button';
    go.addEventListener('click', () => openLogin());
    el.card.append(go);
    return;
  }
  el.card.append(
    text('p', 'callout__text', 'Бой на двоих в одно время: каждый твой повтор соперник видит сразу.'),
  );
  const go = text('button', 'btn btn--primary callout__go', 'Войти в дуэль') as HTMLButtonElement;
  go.type = 'button';
  go.addEventListener('click', () => live.join(id));
  el.card.append(go);
}

// ——— Лобби (экран подготовки) ———
function renderLobby(): void {
  el.lobby.hidden = !view;
  if (!view) return;
  const you = view.players[view.you];
  const opp = view.players[1 - view.you];
  const host = view.you === 0;
  el.lobbyShare.hidden = !host || !!opp;
  el.lobbyLink.hidden = el.lobbyLink.hidden || !host || !!opp;
  // Двое в комнате: кто в сети и кто готов — точкой и словом.
  el.lobbyPlayers.replaceChildren(
    playerRow(you?.name ?? 'Ты', you?.ready ? 'ready' : 'here', you?.frame ?? null, you?.title ?? null),
    opp
      ? playerRow(opp.name, !opp.online ? 'off' : opp.ready ? 'ready' : 'here', opp.frame, opp.title)
      : playerRow('Соперник', 'wait', null, null),
  );
  if (!opp) {
    el.lobbyOpp.textContent = 'Ждём соперника — позови игрока из списка или отправь ссылку.';
    return;
  }
  const between = view.phase === 'lobby' || view.phase === 'over';
  el.lobbyOpp.textContent = !between
    ? ''
    : you?.ready
      ? 'Ты готов — ждём соперника.'
      : 'Нажми «Готов» или подними обе руки.';
}

const STATE_TEXT = { ready: 'готов', here: 'не готов', off: 'не в сети', wait: 'ещё не пришёл' } as const;

function playerRow(
  name: string,
  state: keyof typeof STATE_TEXT,
  frameId: string | null,
  title: string | null,
): HTMLLIElement {
  const li = text('li', 'lobby__player', '');
  li.dataset.state = state;
  const avatar = face(name, frameId, 28);
  if (title) avatar.title = title;
  li.append(text('span', 'lobby__dot', ''), avatar, text('span', 'lobby__name', name));
  li.append(text('span', 'lobby__state', STATE_TEXT[state]));
  return li;
}

async function shareRoom(): Promise<void> {
  const id = live.roomId();
  if (!id) return;
  const url = new URL(`${import.meta.env.BASE_URL}duel.html#r=${id}`, location.origin).href;
  el.lobbyLink.value = url;
  el.lobbyLink.hidden = false;
  if (navigator.share) {
    const title = view ? `Дуэль онлайн: ${exerciseTitle(view.exercise)}` : 'Дуэль онлайн';
    await navigator.share({ title, url }).catch(() => undefined);
  } else {
    await navigator.clipboard?.writeText(url).catch(() => undefined);
  }
}

// ——— Приглашение поверх экрана ———
function showToast(room: string, from: string, exercise: DuelExercise, durationMs: number): void {
  // Уже в бою — не отвлекаем; в лобби своей комнаты — тоже.
  if (el.app.dataset.screen === 'countdown' || el.app.dataset.screen === 'battle') return;
  toastRoom = { room, from };
  el.toastFrom.textContent = from;
  el.toastEx.textContent = `${exerciseTitle(exercise)} · ${formatName(durationMs)}`;
  el.toast.hidden = false;
}

function hideToast(): void {
  toastRoom = null;
  el.toast.hidden = true;
}

function showError(message: string): void {
  sending = null;
  renderList();
  if (/Войди/.test(message)) openLogin();
  if (view) el.lobbyOpp.textContent = message;
  else el.note.textContent = message;
}

function text<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, value: string) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  node.textContent = value;
  return node;
}
