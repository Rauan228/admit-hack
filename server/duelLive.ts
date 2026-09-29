// E-26: онлайн-дуэль по WebSocket (/api/duel/ws). Кто сейчас онлайн, приглашения, комнаты на двоих.
// Судья — сервер: общий отсчёт, минута боя, приём повторов и итог (логика комнаты — src/shared/duelRoom.ts).
// Защита: только свой Origin (иначе чужой сайт играл бы от имени зашедшего), лимиты соединений,
// размера кадра и частоты сообщений; ники и имена гостей — через ту же проверку, что при регистрации.

import { randomInt } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { DuelRoom, type ClientMsg, type ServerMsg } from '../src/shared/duelRoom.ts';
import { RateLimiter, checkNick } from './auth.ts';
import { acceptWebSocket, reject, type WsConn } from './ws.ts';

export interface LiveOptions {
  now?: () => number;
  countdownMs?: number;
  durationMs?: number;
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
  let presenceTimer: ReturnType<typeof setTimeout> | null = null;

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
    if (c.user) presenceChanged();
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
        return create(c);
      case 'join':
        return join(c, m);
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

  function create(c: Client): void {
    if (!c.user) return fail(c, 'Войди, чтобы создать дуэль');
    if (!createLimit.allow(String(c.user.id), now())) return fail(c, 'Слишком часто — подожди минуту');
    if (rooms.size >= MAX_ROOMS) return fail(c, 'Сервер занят — попробуй через минуту');
    leaveRoom(c);
    const room = new DuelRoom(newId(8), { countdownMs: opts.countdownMs, durationMs: opts.durationMs });
    rooms.set(room.id, room);
    enter(c, room, newId(24), c.user.nick);
  }

  function join(c: Client, m: Extract<ClientMsg, { t: 'join' }>): void {
    const room = typeof m.room === 'string' ? rooms.get(m.room) : undefined;
    if (!room) return fail(c, 'Дуэль не найдена — попроси новую ссылку');
    if (c.room && c.room !== room) leaveRoom(c);
    const key = typeof m.key === 'string' && /^[A-Za-z0-9]{24}$/.test(m.key) ? m.key : newId(24);
    const guest =
      typeof m.name === 'string' && !checkNick(m.name) ? m.name.trim().replace(/\s+/g, ' ') : 'Гость';
    enter(c, room, key, c.user?.nick ?? guest);
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
    const targets = byNick(nick).filter((x) => x.user?.id !== c.user!.id);
    if (!targets.length) return fail(c, 'Игрок сейчас не в сети');
    for (const x of targets) send(x, { t: 'invited', room: c.room.id, from: c.user.nick });
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

  function broadcast(room: DuelRoom): void {
    const t = now();
    for (const c of clients)
      if (c.room === room && c.key) send(c, { t: 'room', room: room.view(c.key, t), key: c.key });
  }

  function drop(room: DuelRoom): void {
    clearTimeout(timers.get(room));
    timers.delete(room);
    rooms.delete(room.id);
  }

  function sweep(): void {
    const t = now();
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
