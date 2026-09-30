// E-26: онлайн-дуэль по WebSocket (/api/duel/ws). Кто сейчас онлайн, приглашения, комнаты на двоих.
// Судья — сервер: общий отсчёт, минута боя, приём повторов и итог (логика комнаты — src/shared/duelRoom.ts).
// Подбор соперника (арена): очередь по доске «упражнение × время», пара — по кубкам (server/duelQueue.ts),
// дальше — обычная комната, как по приглашению.
// Защита: только свой Origin (иначе чужой сайт играл бы от имени зашедшего), лимиты соединений,
// размера кадра и частоты сообщений; ники и имена гостей — через ту же проверку, что при регистрации.

import { randomInt } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { formatByMs } from '../src/shared/arena.ts';
import { duelExerciseOf, type DuelExercise } from '../src/shared/duel.ts';
import {
  DuelRoom,
  ROOM_DURATIONS,
  type ClientMsg,
  type RoomView,
  type ServerMsg,
} from '../src/shared/duelRoom.ts';
import { awardView, type ArenaStore } from './arena.ts';
import { RateLimiter, checkNick } from './auth.ts';
import { SeekQueue } from './duelQueue.ts';
import { acceptWebSocket, reject, type WsConn } from './ws.ts';

export interface LiveOptions {
  now?: () => number;
  countdownMs?: number;
  durationMs?: number;
  /** Кубки за бой. Без него комната работает, но в рейтинг не идёт (короткие тесты). */
  arena?: ArenaStore;
  /** Как часто пересобирать пары и слать «сколько ищут» (окно по кубкам растёт со временем). */
  seekTickMs?: number;
}

interface Client {
  ws: WsConn;
  user: { id: number; nick: string } | null;
  ip: string;
  room: DuelRoom | null;
  key: string | null;
  hits: number[];
}

const MAX_CLIENTS = 500;
const MAX_PER_IP = 20;
const MAX_ROOMS = 200;
const MAX_MSG_PER_SEC = 30;
const HEARTBEAT_MS = 25_000;
/** Брошенная комната (никого в сети) живёт 10 минут, любая — не дольше часа без дела. */
const IDLE_EMPTY_MS = 10 * 60_000;
const IDLE_ANY_MS = 60 * 60_000;
/** Приглашение тому, кто не в сети, ждёт его 15 минут (и пока комната жива и в ней есть место). */
const INVITE_TTL_MS = 15 * 60_000;
const MAX_WAITING_PER_NICK = 5;
const MAX_WAITING_NICKS = 1000;
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

export function createDuelLive(
  currentUser: (req: IncomingMessage) => { id: number; nick: string } | null,
  opts: LiveOptions = {},
) {
  const now = opts.now ?? Date.now;
  const clients = new Set<Client>();
  const rooms = new Map<string, DuelRoom>();
  const timers = new Map<DuelRoom, ReturnType<typeof setTimeout>>();
  const createLimit = new RateLimiter(10, 60_000);
  /** Бой уже поставлен на зачёт: комната + раунд. Повторный финиш кубки не двигает. */
  const settling = new Set<string>();
  /** Отложенные приглашения: ник (в нижнем регистре) → кто и в какую комнату позвал. */
  const waiting = new Map<string, { room: DuelRoom; from: string; at: number }[]>();
  let presenceTimer: ReturnType<typeof setTimeout> | null = null;
  let statsTimer: ReturnType<typeof setTimeout> | null = null;
  const queue = new SeekQueue<Client>();
  let seekTimer: ReturnType<typeof setInterval> | null = null;

  const heartbeat = setInterval(() => {
    for (const c of clients) {
      if (c.ws.alive) c.ws.ping();
      else c.ws.terminate();
    }
    sweep();
  }, HEARTBEAT_MS);
  heartbeat.unref();

  function upgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (url.pathname !== '/api/duel/ws') return reject(socket, 404, 'Not Found');
    // Браузер всегда шлёт Origin: чужой сайт не должен открывать сокет с cookie нашего игрока.
    const origin = req.headers.origin;
    if (origin && hostOf(origin) !== req.headers.host) return reject(socket, 403, 'Forbidden');
    const ip = clientIp(req);
    let sameIp = 0;
    for (const c of clients) if (c.ip === ip) sameIp += 1;
    if (clients.size >= MAX_CLIENTS || sameIp >= MAX_PER_IP) return reject(socket, 503, 'Busy');
    const ws = acceptWebSocket(req, socket, head, { maxPayload: 4096 });
    if (!ws) return;
    const user = currentUser(req);
    const c: Client = {
      ws,
      user: user && { id: user.id, nick: user.nick },
      ip,
      room: null,
      key: null,
      hits: [],
    };
    clients.add(c);
    ws.onmessage = (text) => onMessage(c, text);
    ws.onclose = () => onClose(c);
    send(c, { t: 'hello', me: c.user?.nick ?? null, online: onlineNicks() });
    send(c, statsMsg());
    if (c.user) {
      presenceChanged();
      deliverWaiting(c);
    }
    statsChanged();
  }

  function onMessage(c: Client, text: string): void {
    const t = now();
    c.hits = c.hits.filter((h) => t - h < 1000);
    c.hits.push(t);
    if (c.hits.length > MAX_MSG_PER_SEC) return c.ws.close(1008);
    let m: ClientMsg;
    try {
      m = JSON.parse(text) as ClientMsg;
      if (!m || typeof m !== 'object' || typeof m.t !== 'string') throw new Error();
    } catch {
      return fail(c, 'Непонятное сообщение');
    }
    switch (m.t) {
      case 'create':
        stopSeek(c);
        return create(c, m.exercise, m.durationMs);
      case 'join':
        stopSeek(c);
        return join(c, m);
      case 'seek':
        return seek(c, m.exercise, m.durationMs);
      case 'cancel_seek':
        stopSeek(c);
        return send(c, { t: 'seek_cancelled' });
      case 'ready':
        return inRoom(c, (room, key) => room.setReady(key, m.ready === true, now()));
      case 'rep':
        return inRoom(c, (room, key) => room.rep(key, now()));
      case 'giveup':
        return inRoom(c, (room, key) => room.giveUp(key, now()));
      case 'leave':
        leaveRoom(c);
        return send(c, { t: 'left' });
      case 'invite':
        return invite(c, m.nick);
      case 'decline':
        for (const x of byNick(m.from)) send(x, { t: 'declined', by: c.user?.nick ?? 'Гость' });
        return;
      default:
        return fail(c, 'Непонятное сообщение');
    }
  }

  function create(c: Client, rawExercise: unknown, duration?: unknown): void {
    if (!c.user) return fail(c, 'Войди, чтобы создать дуэль');
    // Старый клиент без поля — отжимания; чужое упражнение (или без надёжного счёта) — отказ.
    const exercise = duelExerciseOf(rawExercise);
    if (!exercise) return fail(c, 'Неизвестное упражнение');
    // Время боя — из списка на выбор (E-30); без него — как задано серверу (в тестах короткий бой) или минута.
    if (duration !== undefined && !(typeof duration === 'number' && ROOM_DURATIONS.includes(duration)))
      return fail(c, 'Такого времени боя нет — выбери пулю (30 с), блиц (1 мин) или рапид (3 мин)');
    if (!createLimit.allow(String(c.user.id), now())) return fail(c, 'Слишком часто — подожди минуту');
    if (rooms.size >= MAX_ROOMS) return fail(c, 'Сервер занят — попробуй через минуту');
    leaveRoom(c);
    const room = new DuelRoom(newId(8), {
      countdownMs: opts.countdownMs,
      durationMs: (duration as number | undefined) ?? opts.durationMs,
      exercise,
    });
    rooms.set(room.id, room);
    enter(c, room, newId(24), c.user.nick);
  }

  // ——— Подбор соперника ———
  function seek(c: Client, rawExercise: unknown, duration: unknown): void {
    if (!c.user) return fail(c, 'Войди, чтобы искать соперника');
    const exercise = duelExerciseOf(rawExercise);
    if (!exercise) return fail(c, 'Неизвестное упражнение');
    const durationMs = duration === undefined ? 60_000 : duration;
    if (typeof durationMs !== 'number' || !ROOM_DURATIONS.includes(durationMs))
      return fail(c, 'Такого времени боя нет — выбери пулю (30 с), блиц (1 мин) или рапид (3 мин)');
    const phase = c.room?.phase;
    if (phase === 'countdown' || phase === 'battle') return fail(c, 'Сначала доиграй бой');
    leaveRoom(c);
    const format = formatByMs(durationMs);
    const cups = opts.arena && format ? opts.arena.boardCups(c.user.id, exercise, format.id) : 0;
    const since = now();
    // Один поиск на аккаунт: в другой вкладке поиск снимается.
    for (const old of queue.add({ ref: c, userId: c.user.id, exercise, durationMs, cups, since }))
      send(old.ref, { t: 'seek_cancelled' });
    sendSeeking(c);
    matchmake();
    armSeekTimer();
    statsChanged();
  }

  function stopSeek(c: Client): void {
    if (queue.remove(c)) statsChanged();
  }

  function sendSeeking(c: Client): void {
    const s = queue.get(c);
    if (!s) return;
    send(c, {
      t: 'seeking',
      exercise: s.exercise as DuelExercise,
      durationMs: s.durationMs,
      since: s.since,
      now: now(),
      queue: queue.count(s.exercise, s.durationMs) - 1,
    });
  }

  /** Собрать пары и посадить каждую в свою комнату — дальше всё как по приглашению. */
  function matchmake(): void {
    const pairs = queue.pairs(now());
    for (const [a, b] of pairs) {
      if (rooms.size >= MAX_ROOMS) {
        for (const x of [a, b]) {
          fail(x.ref, 'Сервер занят — попробуй через минуту');
          send(x.ref, { t: 'seek_cancelled' });
        }
        continue;
      }
      const room = new DuelRoom(newId(8), {
        countdownMs: opts.countdownMs,
        durationMs: a.durationMs,
        exercise: a.exercise as DuelExercise,
        matched: true,
      });
      rooms.set(room.id, room);
      // Оба входят до первой рассылки: «Соперник найден» сразу видит двоих.
      for (const x of [a, b]) {
        leaveRoom(x.ref);
        const p = room.join({ key: newId(24), name: x.ref.user!.nick, userId: x.userId }, now());
        if (typeof p === 'string') continue;
        x.ref.room = room;
        x.ref.key = p.key;
      }
      broadcast(room);
    }
    if (pairs.length) statsChanged();
  }

  function armSeekTimer(): void {
    if (seekTimer) return;
    seekTimer = setInterval(() => {
      matchmake();
      for (const s of queue.all()) sendSeeking(s.ref);
      if (!queue.size && seekTimer) {
        clearInterval(seekTimer);
        seekTimer = null;
      }
    }, opts.seekTickMs ?? 1000);
    seekTimer.unref();
  }

  function join(c: Client, m: Extract<ClientMsg, { t: 'join' }>): void {
    // Соревнование — только со своим аккаунтом. Бой с ботом на странице гостю по-прежнему открыт.
    if (!c.user) return fail(c, 'Войди, чтобы выйти на дуэль');
    const room = typeof m.room === 'string' ? rooms.get(m.room) : undefined;
    if (!room) return fail(c, 'Дуэль не найдена — попроси новую ссылку');
    if (c.room && c.room !== room) leaveRoom(c);
    const key = typeof m.key === 'string' && /^[A-Za-z0-9]{24}$/.test(m.key) ? m.key : newId(24);
    enter(c, room, key, c.user.nick);
  }

  function enter(c: Client, room: DuelRoom, key: string, name: string): void {
    const p = room.join({ key, name, userId: c.user?.id ?? null }, now());
    if (typeof p === 'string') return fail(c, p);
    c.room = room;
    c.key = p.key;
    broadcast(room);
  }

  function inRoom(c: Client, act: (room: DuelRoom, key: string) => unknown): void {
    if (!c.room || !c.key) return fail(c, 'Сначала войди в дуэль');
    // Повтор, не прошедший проверку (слишком часто, вне боя), — молча мимо: рассылать нечего.
    if (act(c.room, c.key) === false) return;
    schedule(c.room);
    broadcast(c.room);
  }

  function invite(c: Client, nick: unknown): void {
    if (!c.user) return fail(c, 'Войди, чтобы звать игроков');
    if (!c.room) return fail(c, 'Сначала создай дуэль');
    if (typeof nick !== 'string' || checkNick(nick)) return fail(c, 'Нет такого игрока');
    if (nick.trim().toLowerCase() === c.user.nick.toLowerCase()) return fail(c, 'Нельзя позвать самого себя');
    const targets = byNick(nick);
    for (const x of targets)
      send(x, {
        t: 'invited',
        room: c.room.id,
        from: c.user.nick,
        exercise: c.room.exercise,
        durationMs: c.room.durationMs,
      });
    if (!targets.length) {
      // Не в сети — приглашение дождётся, когда игрок откроет дуэль (deliverWaiting).
      const key = nick.trim().toLowerCase();
      if (!waiting.has(key) && waiting.size >= MAX_WAITING_NICKS)
        return fail(c, 'Сервер занят — отправь ссылку');
      const room = c.room;
      const list = (waiting.get(key) ?? []).filter((w) => w.room !== room);
      list.push({ room, from: c.user.nick, at: now() });
      waiting.set(key, list.slice(-MAX_WAITING_PER_NICK));
    }
    send(c, { t: 'invite_sent', nick, online: targets.length > 0 });
  }

  /** Вошёл тот, кого звали, пока его не было: отдать живые приглашения. */
  function deliverWaiting(c: Client): void {
    const key = c.user!.nick.toLowerCase();
    const list = waiting.get(key);
    if (!list) return;
    waiting.delete(key);
    const t = now();
    for (const w of list)
      if (rooms.get(w.room.id) === w.room && w.room.players.length < 2 && t - w.at < INVITE_TTL_MS)
        send(c, {
          t: 'invited',
          room: w.room.id,
          from: w.from,
          exercise: w.room.exercise,
          durationMs: w.room.durationMs,
        });
  }

  function leaveRoom(c: Client): void {
    const room = c.room;
    if (!room || !c.key) return;
    room.leave(c.key, now());
    c.room = null;
    c.key = null;
    if (!room.players.length) return drop(room);
    schedule(room);
    broadcast(room);
  }

  function onClose(c: Client): void {
    clients.delete(c);
    queue.remove(c);
    statsChanged();
    if (c.room && c.key) {
      const key = c.key;
      // Тот же игрок открыт в другой вкладке — он всё ещё в сети.
      if (![...clients].some((x) => x.room === c.room && x.key === key)) c.room.setOnline(key, false);
      broadcast(c.room);
    }
    if (c.user) presenceChanged();
  }

  /** Таймер на ближайшую смену фазы: старт боя, финиш. */
  function schedule(room: DuelRoom): void {
    clearTimeout(timers.get(room));
    const at = room.phase === 'countdown' ? room.startsAt : room.phase === 'battle' ? room.endsAt : null;
    if (at === null) return void timers.delete(room);
    const timer = setTimeout(
      () => {
        if (room.tick(now())) broadcast(room);
        schedule(room);
      },
      Math.max(0, at - now()),
    );
    timer.unref();
    timers.set(room, timer);
  }

  function decorate(room: DuelRoom, key: string): RoomView {
    const view = room.view(key, now());
    if (!opts.arena) return view;
    view.players.forEach((p, i) => {
      const id = room.players[i]?.userId;
      if (id == null) return;
      const b = opts.arena!.badge(id);
      p.title = b.title;
      p.frame = b.frame;
      const format = formatByMs(room.durationMs);
      if (format) p.cups = opts.arena!.boardCups(id, room.exercise, format.id);
    });
    return view;
  }

  function broadcast(room: DuelRoom): void {
    for (const c of clients)
      if (c.room === room && c.key) send(c, { t: 'room', room: decorate(room, c.key), key: c.key });
    armSettle(room);
  }

  /** Зачёт после окна поздних повторов (0,5 с) — иначе кубки уедут до последнего жима. */
  function armSettle(room: DuelRoom): void {
    if (room.phase !== 'over' || !opts.arena) return;
    const key = `${room.id}:${room.round}`;
    if (settling.has(key)) return;
    settling.add(key);
    const reason = room.result()?.reason;
    const wait = reason === 'giveup' ? 50 : Math.max(0, room.endsAt + 700 - now());
    const timer = setTimeout(() => {
      try {
        finishRated(room);
      } catch (e) {
        console.error(e);
      }
    }, wait);
    timer.unref();
  }

  function finishRated(room: DuelRoom): void {
    const arena = opts.arena;
    if (!arena) return;
    const format = formatByMs(room.durationMs);
    const [a, b] = room.players;
    if (!format || !a?.userId || !b?.userId || a.userId === b.userId) return;
    const result = room.result();
    if (!result) return;
    const winnerUserId =
      result.winner === null ? null : (room.players.find((p) => p.key === result.winner)?.userId ?? null);
    if (result.winner !== null && winnerUserId === null) return;
    const pair = arena.settleMatch(now(), {
      id: `live:${room.id}:${room.round}`,
      exercise: room.exercise,
      format: format.id,
      a: { userId: a.userId, reps: a.reps.length },
      b: { userId: b.userId, reps: b.reps.length },
      winnerUserId,
    });
    if (!pair) return;
    // Рамки могли смениться — разослать комнату ещё раз, затем личный итог кубков.
    for (const c of clients)
      if (c.room === room && c.key) send(c, { t: 'room', room: decorate(room, c.key), key: c.key });
    for (const c of clients) {
      if (c.room !== room || !c.user) continue;
      const mine = c.user.id === pair.a.userId ? pair.a : c.user.id === pair.b.userId ? pair.b : null;
      if (!mine) continue;
      send(c, { t: 'award', room: room.id, round: room.round, ...awardView(mine) });
    }
  }

  function drop(room: DuelRoom): void {
    clearTimeout(timers.get(room));
    timers.delete(room);
    rooms.delete(room.id);
  }

  function sweep(): void {
    const t = now();
    for (const [key, list] of waiting) {
      const alive = list.filter((w) => rooms.get(w.room.id) === w.room && t - w.at < INVITE_TTL_MS);
      if (alive.length) waiting.set(key, alive);
      else waiting.delete(key);
    }
    for (const room of rooms.values()) {
      const anyone = [...clients].some((c) => c.room === room);
      if ((!anyone && t - room.touched > IDLE_EMPTY_MS) || t - room.touched > IDLE_ANY_MS) {
        for (const c of clients) if (c.room === room) c.room = c.key = null;
        drop(room);
      }
    }
  }

  function onlineNicks(): string[] {
    return [...new Set([...clients].flatMap((c) => (c.user ? [c.user.nick] : [])))];
  }

  function presenceChanged(): void {
    if (presenceTimer) return;
    presenceTimer = setTimeout(() => {
      presenceTimer = null;
      const online = onlineNicks();
      for (const c of clients) send(c, { t: 'presence', online });
    }, 150);
    presenceTimer.unref();
  }

  /** Людей на арене: аккаунт в нескольких вкладках — один, гость — каждое соединение. */
  function statsMsg(): ServerMsg {
    const accounts = new Set<number>();
    let guests = 0;
    for (const c of clients) {
      if (c.user) accounts.add(c.user.id);
      else guests += 1;
    }
    return { t: 'stats', online: accounts.size + guests, seeking: queue.stats() };
  }

  function statsChanged(): void {
    if (statsTimer) return;
    statsTimer = setTimeout(() => {
      statsTimer = null;
      const m = statsMsg();
      for (const c of clients) send(c, m);
    }, 150);
    statsTimer.unref();
  }

  function byNick(nick: unknown): Client[] {
    if (typeof nick !== 'string') return [];
    const n = nick.trim().toLowerCase();
    return [...clients].filter((c) => c.user?.nick.toLowerCase() === n);
  }

  function fail(c: Client, message: string): void {
    send(c, { t: 'error', message });
  }

  function send(c: Client, m: ServerMsg): void {
    c.ws.send(JSON.stringify(m));
  }

  function close(): void {
    clearInterval(heartbeat);
    if (seekTimer) clearInterval(seekTimer);
    for (const t of timers.values()) clearTimeout(t);
    for (const c of clients) c.ws.terminate();
  }

  return { upgrade, close };
}

function hostOf(origin: string): string | null {
  try {
    return new URL(origin).host;
  } catch {
    return null;
  }
}

function clientIp(req: IncomingMessage): string {
  const fwd = req.headers['x-real-ip'] ?? req.headers['x-forwarded-for'];
  const v = Array.isArray(fwd) ? fwd[0] : fwd;
  return (v?.split(',')[0] ?? req.socket.remoteAddress ?? '?').trim();
}

function newId(length: number): string {
  let id = '';
  for (let i = 0; i < length; i += 1) id += ALPHABET[randomInt(ALPHABET.length)];
  return id;
}
