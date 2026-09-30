// E-26: онлайн-дуэль на странице — «Онлайн сейчас» и «Позвать», приглашение поверх любого экрана,
// вход по ссылке #r=<комната>, лобби на экране подготовки («Готов»), итог — от сервера.
// Время боя назначает сервер; страница только переводит его часы в свои (Live.toLocal).
// Все имена — через textContent: ники и имена гостей приходят от других людей.

import type { DuelExercise } from '../shared/duel';
import type { RoomView, ServerMsg } from '../shared/duelRoom';
import { api, type Player } from './api';
import { durationLabel, exerciseTitle } from './labels';
import { Live } from './live';
import { picked, roomDuration } from './picker';

export interface OnlineHooks {
  /** Вошли в комнату — нужна камера (экран подготовки). */
  enterRoom(): void;
  /** Сервер назначил общий отсчёт: его начало по часам страницы. */
  countdown(startLocal: number, durationMs: number, countdownMs: number): void;
  /** Бой окончен по серверу (приходит и повторно — если поздний повтор изменил счёт). */
  over(view: RoomView): void;
  /** Вышли из комнаты. */
  leftRoom(): void;
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
let me: string | null = null;
let online: string[] = [];
let view: RoomView | null = null;
let entered: string | null = null;
let countdownRound = 0;
/** Кого позвать, как только комната будет создана. */
let pendingInvite: string | null = null;
let toastRoom: { room: string; from: string } | null = null;
let guestName = '';
/** Все игроки приложения (поиск по нику) — звать можно любого, не только тех, кто в сети. */
let players: Player[] = [];
/** Кого уже позвали в эту комнату: ник (нижний регистр) → пришло сразу / ждёт, когда он откроет дуэль. */
const called = new Map<string, 'online' | 'waiting'>();
let sending: string | null = null;

/** Создать комнату с тем, что выбрано на вступлении: упражнение и время боя (E-29, E-30). */
function createRoom(): void {
  live.create(picked().exercise, roomDuration());
}

export function initOnline(h: OnlineHooks): void {
  hooks = h;
  live = new Live({ message: onMessage, connected: () => renderList() });
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
export function reconnectOnline(): void {
  live.reconnect();
}

/** Онлайн-дуэль для main.ts. */
export const onlineDuel = {
  active: () => !!view,
  oppName: () => (view ? (view.players[1 - view.you]?.name ?? 'Соперник') : ''),
  oppReps: () => (view ? (view.players[1 - view.you]?.reps ?? 0) : 0),
  exercise: (): DuelExercise => view?.exercise ?? 'push_up',
  durationMs: () => view?.durationMs ?? 60_000,
  ready: () => live.send({ t: 'ready', ready: true }),
  rep: () => live.send({ t: 'rep' }),
  giveUp: () => live.send({ t: 'giveup' }),
  leave: () => live.send({ t: 'leave' }),
};

function onMessage(m: ServerMsg): void {
  switch (m.t) {
    case 'hello':
      me = m.me;
      online = m.online;
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
      return onRoom(m.room);
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
    case 'invited':
      return showToast(m.room, m.from, m.exercise, m.durationMs);
    case 'declined':
      el.lobbyOpp.textContent = `${m.by} не может сейчас — позови кого-то ещё или отправь ссылку.`;
      return;
    case 'error':
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
    const who = text('span', 'person__who', '');
    who.append(
      text('span', 'person__nick', p.nick),
      text('span', 'person__note', on ? 'в сети' : 'не в сети'),
    );
    li.append(dot, who, call);
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
  el.card.append(
    text('p', 'callout__text', 'Бой на двоих в одно время: каждый твой повтор соперник видит сразу.'),
  );
  if (!me) {
    const label = text('label', 'field', 'Как тебя подписать');
    const input = document.createElement('input');
    input.maxLength = 20;
    input.placeholder = 'Гость';
    input.setAttribute('autocomplete', 'nickname');
    input.value = guestName;
    input.addEventListener('input', () => (guestName = input.value.trim()));
    label.append(input);
    el.card.append(label);
  }
  const go = text('button', 'btn btn--primary callout__go', 'Войти в дуэль') as HTMLButtonElement;
  go.type = 'button';
  go.addEventListener('click', () => live.join(id, me ? undefined : guestName || undefined));
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
    playerRow('Ты', you?.ready ? 'ready' : 'here'),
    opp
      ? playerRow(opp.name, !opp.online ? 'off' : opp.ready ? 'ready' : 'here')
      : playerRow('Соперник', 'wait'),
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

function playerRow(name: string, state: keyof typeof STATE_TEXT): HTMLLIElement {
  const li = text('li', 'lobby__player', '');
  li.dataset.state = state;
  li.append(text('span', 'lobby__dot', ''), text('span', 'lobby__name', name));
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
  el.toastEx.textContent = `${exerciseTitle(exercise)} · ${durationLabel(durationMs)}`;
  el.toast.hidden = false;
}

function hideToast(): void {
  toastRoom = null;
  el.toast.hidden = true;
}

function showError(message: string): void {
  sending = null;
  renderList();
  if (view) el.lobbyOpp.textContent = message;
  else el.note.textContent = message;
}

function text<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, value: string) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  node.textContent = value;
  return node;
}
