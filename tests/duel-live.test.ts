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
    app = createApp(openDb(':memory:'), { duel: { countdownMs: 200, durationMs: 800, seekTickMs: 50 } });
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
    /** Сообщение такого типа так и не пришло за ms. */
    const none = (t: Msg['t'], ms = 300) =>
      new Promise<boolean>((r) => setTimeout(() => r(!inbox.some((m) => m.t === t)), ms));
    return { ws, next, send, none };
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
    expect(await a.next('invite_sent')).toMatchObject({ nick: 'rauan', online: true });

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

  it('по ссылке входит только аккаунт; третьему места нет', async () => {
    const a = await player(await cookieOf('Arslan'));
    a.send({ t: 'create' });
    const { room } = await a.next('room');
    const guest = await player();
    await guest.next('hello');
    guest.send({ t: 'join', room: room.id, name: 'Вася' });
    expect((await guest.next('error')).message).toMatch(/Войди/);
    const b = await player(await cookieOf('Rauan'));
    b.send({ t: 'join', room: room.id });
    expect((await b.next('room')).room.players.map((p) => p.name)).toEqual(['Arslan', 'Rauan']);
    const third = await player(await cookieOf('Other'));
    third.send({ t: 'join', room: room.id });
    expect(await third.next('error')).toMatchObject({ message: 'В дуэли уже двое' });
  });

  it('обрыв: соперник видит «не в сети», игрок возвращается по ключу на своё место', async () => {
    const a = await player(await cookieOf('Arslan'));
    const rauan = await cookieOf('Rauan');
    a.send({ t: 'create' });
    const { room } = await a.next('room');
    const b = await player(rauan);
    b.send({ t: 'join', room: room.id });
    const { key } = await b.next('room');
    b.ws.close();
    await a.next('room', (m) => m.room.players[1]?.online === false);
    const back = await player(rauan);
    back.send({ t: 'join', room: room.id, key });
    const again = await back.next('room');
    expect(again.room).toMatchObject({
      you: 1,
      players: [{ name: 'Arslan' }, { name: 'Rauan', online: true }],
    });
  });

  it('позвать того, кто не в сети: приглашение ждёт и приходит, как только он откроет дуэль', async () => {
    const a = await player(await cookieOf('Arslan'));
    const rauanCookie = await cookieOf('Rauan');
    a.send({ t: 'create' });
    const { room } = await a.next('room');
    a.send({ t: 'invite', nick: 'Rauan' });
    expect(await a.next('invite_sent')).toMatchObject({ nick: 'Rauan', online: false });
    const b = await player(rauanCookie);
    expect(await b.next('invited')).toMatchObject({ room: room.id, from: 'Arslan' });
  });

  it('комнаты уже нет — отложенное приглашение не приходит', async () => {
    const a = await player(await cookieOf('Arslan'));
    const otherCookie = await cookieOf('Other');
    a.send({ t: 'create' });
    await a.next('room');
    a.send({ t: 'invite', nick: 'Other' });
    await a.next('invite_sent');
    a.send({ t: 'leave' });
    await a.next('left');
    const b = await player(otherCookie);
    await b.next('hello');
    expect(await b.none('invited')).toBe(true);
  });

  it('упражнение (E-29): комната на «звёздочку», приглашение говорит, на что зовут', async () => {
    const a = await player(await cookieOf('Arslan'));
    const b = await player(await cookieOf('Rauan'));
    const offCookie = await cookieOf('Offline');
    a.send({ t: 'create', exercise: 'jumping_jack' });
    const { room } = await a.next('room');
    expect(room.exercise).toBe('jumping_jack');
    a.send({ t: 'invite', nick: 'Rauan' });
    expect(await b.next('invited')).toMatchObject({
      room: room.id,
      from: 'Arslan',
      exercise: 'jumping_jack',
    });
    a.send({ t: 'invite', nick: 'Offline' });
    await a.next('invite_sent', (m) => m.nick === 'Offline');
    const late = await player(offCookie);
    expect(await late.next('invited')).toMatchObject({ exercise: 'jumping_jack' });
    a.send({ t: 'create', exercise: 'moonwalk' });
    expect((await a.next('error')).message).toMatch(/упражнение/);
  });

  it('упражнение: старый клиент без поля — отжимания; без надёжного счёта (планка) — отказ', async () => {
    const a = await player(await cookieOf('Arslan'));
    a.send({ t: 'create' });
    expect((await a.next('room')).room.exercise).toBe('push_up');
    a.send({ t: 'create', exercise: 'plank' });
    expect((await a.next('error')).message).toMatch(/упражнение/);
    a.send({ t: 'create', exercise: 'squat', durationMs: 30_000 });
    expect((await a.next('room', (m) => m.room.exercise === 'squat')).room.durationMs).toBe(30_000);
  });

  it('время боя: пуля 30 с, блиц 1 мин, рапид 3 мин — у каждого свой разряд', async () => {
    const a = await player(await cookieOf('Arslan'));
    const b = await player(await cookieOf('Rauan'));
    a.send({ t: 'create', exercise: 'jumping_jack', durationMs: 30_000 });
    const { room } = await a.next('room');
    expect(room.durationMs).toBe(30_000);
    a.send({ t: 'invite', nick: 'Rauan' });
    expect(await b.next('invited')).toMatchObject({ exercise: 'jumping_jack', durationMs: 30_000 });
    for (const ms of [60_000, 180_000]) {
      a.send({ t: 'create', durationMs: ms });
      expect((await a.next('room', (m) => m.room.durationMs === ms)).room.durationMs).toBe(ms);
    }
    a.send({ t: 'create', durationMs: 15_000 });
    expect((await a.next('error')).message).toMatch(/врем/);
    a.send({ t: 'create', durationMs: 12_345 });
    expect((await a.next('error')).message).toMatch(/врем/);
  });

  it('гость не входит в соревновательную дуэль', async () => {
    const a = await player(await cookieOf('Arslan'));
    a.send({ t: 'create' });
    const { room } = await a.next('room');
    const guest = await player();
    await guest.next('hello');
    guest.send({ t: 'join', room: room.id, name: 'Вася' });
    expect((await guest.next('error')).message).toMatch(/Войди/);
  });

  it('проверки: создать — только после входа; неизвестная комната; мусор', async () => {
    const guest = await player();
    guest.send({ t: 'create' });
    expect((await guest.next('error')).message).toMatch(/Войди/);
    const a = await player(await cookieOf('Arslan'));
    a.send({ t: 'create' });
    await a.next('room');
    a.send({ t: 'join', room: 'NOPE0000' });
    expect((await a.next('error')).message).toMatch(/не найдена/);
    a.send('не json' as unknown as object);
    expect((await a.next('error')).message).toMatch(/сообщение/);
  });

  it('подбор: двое ищут одну доску → общая комната, как по приглашению; разные доски не сводит', async () => {
    const a = await player(await cookieOf('Arslan'));
    const b = await player(await cookieOf('Rauan'));
    const c = await player(await cookieOf('Other'));
    a.send({ t: 'seek', exercise: 'squat', durationMs: 30_000 });
    expect(await a.next('seeking')).toMatchObject({ exercise: 'squat', durationMs: 30_000, queue: 0 });
    c.send({ t: 'seek', exercise: 'squat', durationMs: 60_000 });
    await c.next('seeking');
    b.send({ t: 'seek', exercise: 'squat', durationMs: 30_000 });
    const ra = await a.next('room');
    const rb = await b.next('room');
    expect(rb.room.players).toHaveLength(2);
    expect(ra.room.id).toBe(rb.room.id);
    expect(ra.room).toMatchObject({ matched: true, exercise: 'squat', durationMs: 30_000, phase: 'lobby' });
    expect(ra.room.players.map((p) => p.cups)).toEqual([0, 0]);
    expect(await c.none('room', 200)).toBe(true);
    // Дальше — обычный протокол готовности и общего отсчёта.
    a.send({ t: 'ready', ready: true });
    b.send({ t: 'ready', ready: true });
    await b.next('room', (m) => m.room.phase === 'countdown');
    const stats = await c.next('stats', (m) => m.seeking['squat:60000'] === 1 && !m.seeking['squat:30000']);
    expect(stats.online).toBe(3);
  });

  it('подбор: только с аккаунтом; отмена; обрыв снимает поиск; один поиск на аккаунт', async () => {
    const guest = await player();
    guest.send({ t: 'seek', exercise: 'push_up', durationMs: 60_000 });
    expect((await guest.next('error')).message).toMatch(/Войди/);

    const arslan = await cookieOf('Arslan');
    const a = await player(arslan);
    a.send({ t: 'seek', durationMs: 60_000 });
    await a.next('seeking');
    a.send({ t: 'cancel_seek' });
    await a.next('seek_cancelled');
    const b = await player(await cookieOf('Rauan'));
    b.send({ t: 'seek', durationMs: 60_000 });
    await b.next('seeking');
    expect(await a.none('room', 200)).toBe(true);

    // Второй вкладкой тот же аккаунт: прежний поиск снят, с собой не сводит.
    const tab1 = await player(arslan);
    tab1.send({ t: 'seek', exercise: 'lunge', durationMs: 180_000 });
    await tab1.next('seeking');
    const tab2 = await player(arslan);
    tab2.send({ t: 'seek', exercise: 'lunge', durationMs: 180_000 });
    await tab2.next('seeking');
    await tab1.next('seek_cancelled');

    // Обрыв: поиск Rauan снят — пришедший позже Other его не получит.
    b.ws.close();
    const st = await guest.next(
      'stats',
      (m) => !m.seeking['push_up:60000'] && m.seeking['lunge:180000'] === 1,
    );
    expect(st.online).toBe(2);
    const o = await player(await cookieOf('Other'));
    o.send({ t: 'seek', durationMs: 60_000 });
    await o.next('seeking');
    expect(await o.none('room', 250)).toBe(true);

    o.send({ t: 'seek', durationMs: 15_000 });
    expect((await o.next('error')).message).toMatch(/врем/);
    o.send({ t: 'seek', exercise: 'plank', durationMs: 60_000 });
    expect((await o.next('error')).message).toMatch(/упражнение/);
  });

  it('подбор: в бою искать нельзя; из лобби — выходит из комнаты', async () => {
    const a = await player(await cookieOf('Arslan'));
    const b = await player(await cookieOf('Rauan'));
    a.send({ t: 'create' });
    const { room } = await a.next('room');
    b.send({ t: 'join', room: room.id });
    await a.next('room', (m) => m.room.players.length === 2);
    b.send({ t: 'seek', durationMs: 60_000 });
    await b.next('seeking');
    await a.next('room', (m) => m.room.players.length === 1);
    b.send({ t: 'cancel_seek' });
    await b.next('seek_cancelled');
    b.send({ t: 'join', room: room.id });
    await a.next('room', (m) => m.room.players.length === 2);
    a.send({ t: 'ready', ready: true });
    b.send({ t: 'ready', ready: true });
    await a.next('room', (m) => m.room.phase === 'countdown');
    a.send({ t: 'seek', durationMs: 60_000 });
    expect((await a.next('error')).message).toMatch(/доиграй/);
  });

  it('стартовая статистика: сколько на арене и кто ищет', async () => {
    const a = await player(await cookieOf('Arslan'));
    expect(await a.next('stats')).toMatchObject({ online: 1, seeking: {} });
    const g = await player();
    await g.next('stats');
    expect((await a.next('stats', (m) => m.online === 2)).online).toBe(2);
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
