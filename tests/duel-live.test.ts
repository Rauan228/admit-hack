// Онлайн-дуэль (E-26) через настоящий WebSocket: кто онлайн, приглашение, комната, общий отсчёт, итог.

import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { connect } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../server/app.ts';
import { openDb } from '../server/db.ts';
import type { ServerMsg } from '../src/shared/duelRoom.ts';

type Msg = ServerMsg;

describe('онлайн-дуэль по WebSocket', () => {
  let server: Server;
  let app: ReturnType<typeof createApp>;
  let port = 0;
  const sockets: WebSocket[] = [];

  beforeEach(async () => {
    app = createApp(openDb(':memory:'), { duel: { countdownMs: 200, durationMs: 800 } });
    server = createServer((req, res) => void app(req, res));
    server.on('upgrade', app.upgrade);
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    port = (server.address() as AddressInfo).port;
  });
  afterEach(async () => {
    for (const s of sockets.splice(0)) s.close();
    app.close();
    await new Promise<void>((r) => server.close(() => r()));
  });

  async function cookieOf(nick: string): Promise<string> {
    const res = await fetch(`http://127.0.0.1:${port}/api/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: `${nick}@forma.kz`, nick, password: 'secret-123' }),
    });
    return res.headers.get('set-cookie')!.split(';')[0]!;
  }

  /** Клиент: очередь сообщений и ожидание нужного. */
  async function player(cookie?: string) {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/api/duel/ws`, {
      headers: { origin: `http://127.0.0.1:${port}`, ...(cookie ? { cookie } : {}) },
    } as unknown as string[]);
    sockets.push(ws);
    const inbox: Msg[] = [];
    const waiters: { test: (m: Msg) => boolean; resolve: (m: Msg) => void }[] = [];
    ws.onmessage = (e) => {
      const m = JSON.parse(String(e.data)) as Msg;
      const i = waiters.findIndex((w) => w.test(m));
      if (i >= 0) waiters.splice(i, 1)[0]!.resolve(m);
      else inbox.push(m);
    };
    await new Promise((r) => (ws.onopen = r));
    const next = <T extends Msg['t']>(t: T, where: (m: Extract<Msg, { t: T }>) => boolean = () => true) =>
      new Promise<Extract<Msg, { t: T }>>((resolve, reject) => {
        const test = (m: Msg) => m.t === t && where(m as Extract<Msg, { t: T }>);
        const i = inbox.findIndex(test);
        if (i >= 0) return resolve(inbox.splice(i, 1)[0] as Extract<Msg, { t: T }>);
        waiters.push({ test, resolve: resolve as (m: Msg) => void });
        setTimeout(() => reject(new Error(`не дождались ${t}`)), 3000);
      });
    const send = (m: unknown) => ws.send(JSON.stringify(m));
    return { ws, next, send };
  }

  it('приветствие и «кто онлайн»: второй вошёл — первый узнал', async () => {
    const a = await player(await cookieOf('Arslan'));
    expect(await a.next('hello')).toMatchObject({ me: 'Arslan', online: ['Arslan'] });
    const b = await player(await cookieOf('Rauan'));
    expect(await b.next('hello')).toMatchObject({ me: 'Rauan' });
    const p = await a.next('presence', (m) => m.online.includes('Rauan'));
    expect(p.online.sort()).toEqual(['Arslan', 'Rauan']);
    const guest = await player();
    expect(await guest.next('hello')).toMatchObject({ me: null });
  });

  it('приглашение → комната на двоих → общий отсчёт → повторы → итог по серверу', async () => {
    const a = await player(await cookieOf('Arslan'));
    const b = await player(await cookieOf('Rauan'));
    a.send({ t: 'create' });
    const created = await a.next('room');
    expect(created.room).toMatchObject({ phase: 'lobby', you: 0, players: [{ name: 'Arslan' }] });

    a.send({ t: 'invite', nick: 'rauan' });
    const inv = await b.next('invited');
    expect(inv).toMatchObject({ room: created.room.id, from: 'Arslan' });

    b.send({ t: 'join', room: inv.room });
    const joined = await b.next('room', (m) => m.room.players.length === 2);
    expect(joined.room.you).toBe(1);
    await a.next('room', (m) => m.room.players.length === 2);

    a.send({ t: 'ready', ready: true });
    b.send({ t: 'ready', ready: true });
    const cd = await a.next('room', (m) => m.room.phase === 'countdown');
    expect(cd.room.endsAt - cd.room.startsAt).toBe(800);
    await a.next('room', (m) => m.room.phase === 'battle');

    a.send({ t: 'rep' });
    await b.next('room', (m) => m.room.players[0]!.reps === 1); // соперник видит повтор сразу
    await new Promise((r) => setTimeout(r, 350));
    a.send({ t: 'rep' });
    b.send({ t: 'rep' });
    const over = await b.next('room', (m) => m.room.phase === 'over');
    expect(over.room.players.map((p) => p.reps)).toEqual([2, 1]);
    expect(over.room.result).toEqual({ winner: 0, reason: 'reps' });
  });

  it('гость входит по ссылке с именем; третьему места нет', async () => {
    const a = await player(await cookieOf('Arslan'));
    a.send({ t: 'create' });
    const { room } = await a.next('room');
    const guest = await player();
    guest.send({ t: 'join', room: room.id, name: 'Вася' });
    expect((await guest.next('room')).room.players.map((p) => p.name)).toEqual(['Arslan', 'Вася']);
    const third = await player();
    third.send({ t: 'join', room: room.id });
    expect(await third.next('error')).toMatchObject({ message: 'В дуэли уже двое' });
  });

  it('обрыв: соперник видит «не в сети», гость возвращается по ключу на своё место', async () => {
    const a = await player(await cookieOf('Arslan'));
    a.send({ t: 'create' });
    const { room } = await a.next('room');
    const guest = await player();
    guest.send({ t: 'join', room: room.id, name: 'Вася' });
    const { key } = await guest.next('room');
    guest.ws.close();
    await a.next('room', (m) => m.room.players[1]?.online === false);
    const back = await player();
    back.send({ t: 'join', room: room.id, name: 'Вася', key });
    const again = await back.next('room');
    expect(again.room).toMatchObject({
      you: 1,
      players: [{ name: 'Arslan' }, { name: 'Вася', online: true }],
    });
  });

  it('проверки: создать — только после входа; позвать можно только того, кто онлайн', async () => {
    const guest = await player();
    guest.send({ t: 'create' });
    expect((await guest.next('error')).message).toMatch(/Войди/);
    const a = await player(await cookieOf('Arslan'));
    await cookieOf('Offline');
    a.send({ t: 'create' });
    await a.next('room');
    a.send({ t: 'invite', nick: 'Offline' });
    expect((await a.next('error')).message).toMatch(/не в сети/);
    a.send({ t: 'join', room: 'NOPE0000' });
    expect((await a.next('error')).message).toMatch(/не найдена/);
    a.send('не json' as unknown as object);
    expect((await a.next('error')).message).toMatch(/сообщение/);
  });

  it('чужой сайт (Origin) — отказ до рукопожатия', async () => {
    const answer = await new Promise<string>((resolve) => {
      const s = connect(port, '127.0.0.1', () =>
        s.write(
          'GET /api/duel/ws HTTP/1.1\r\nHost: 127.0.0.1\r\nOrigin: https://evil.example\r\n' +
            'Upgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Version: 13\r\n' +
            'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n\r\n',
        ),
      );
      let data = '';
      s.on('data', (d) => (data += d));
      s.on('close', () => resolve(data));
    });
    expect(answer.startsWith('HTTP/1.1 403')).toBe(true);
  });
});
