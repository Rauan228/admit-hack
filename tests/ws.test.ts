// Минимальный WebSocket-сервер (E-26, RFC 6455): кадры, рукопожатие, эхо через WebSocket из Node 22.

import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { connect } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FrameParser, WsError, acceptWebSocket, encodeFrame } from '../server/ws.ts';

const MASK = Buffer.from([1, 2, 3, 4]);
const masked = (opcode: number, text: string | Buffer, fin = true) =>
  encodeFrame(opcode, Buffer.isBuffer(text) ? text : Buffer.from(text), MASK, fin);

describe('кадры WebSocket', () => {
  it('разбирает маскированный текст, склеивая куски из сети', () => {
    const p = new FrameParser(4096);
    const frame = masked(1, 'привет');
    expect(p.push(frame.subarray(0, 3))).toEqual([]);
    expect(p.push(frame.subarray(3))).toEqual([{ opcode: 1, payload: Buffer.from('привет') }]);
  });

  it('длины 126 и 65 536 — расширенные поля длины', () => {
    const p = new FrameParser(70_000);
    for (const n of [126, 65_536]) {
      const text = 'x'.repeat(n);
      expect(p.push(masked(1, text))[0]!.payload.toString()).toBe(text);
    }
  });

  it('отказ: без маски 1002, больше лимита 1009, фрагменты и бинарные 1003, битый UTF-8 1007', () => {
    const code = (buf: Buffer, max = 4096) => {
      try {
        new FrameParser(max).push(buf);
        return null;
      } catch (e) {
        return (e as WsError).code;
      }
    };
    expect(code(encodeFrame(1, Buffer.from('hi')))).toBe(1002);
    expect(code(masked(1, 'x'.repeat(5000)))).toBe(1009);
    expect(code(masked(1, 'hi', false))).toBe(1003);
    expect(code(masked(2, 'hi'))).toBe(1003);
    expect(code(masked(1, Buffer.from([0xff, 0xfe])))).toBe(1007);
  });

  it('кадр сервера — без маски, с правильной длиной', () => {
    const f = encodeFrame(1, Buffer.from('ok'));
    expect([...f]).toEqual([0x81, 2, 0x6f, 0x6b]);
    expect(encodeFrame(1, Buffer.alloc(300)).subarray(0, 4)).toEqual(Buffer.from([0x81, 126, 1, 44]));
  });
});

describe('соединение WebSocket', () => {
  let server: Server;
  let url = '';
  beforeEach(async () => {
    server = createServer((_req, res) => res.end());
    server.on('upgrade', (req, socket, head) => {
      const ws = acceptWebSocket(req, socket, head, { maxPayload: 4096 });
      if (ws) ws.onmessage = (text) => ws.send(`эхо: ${text}`);
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    url = `ws://127.0.0.1:${(server.address() as AddressInfo).port}/`;
  });
  afterEach(() => new Promise<void>((r) => server.close(() => r())));

  it('браузерный WebSocket: рукопожатие, сообщение туда-обратно, закрытие', async () => {
    const ws = new WebSocket(url);
    const reply = await new Promise<string>((resolve, reject) => {
      ws.onopen = () => ws.send('бой');
      ws.onmessage = (e) => resolve(String(e.data));
      ws.onerror = () => reject(new Error('ws error'));
    });
    expect(reply).toBe('эхо: бой');
    const closed = new Promise<number>((r) => (ws.onclose = (e) => r(e.code)));
    ws.close(1000);
    expect(await closed).toBe(1000);
  });

  it('кривое рукопожатие — 400 и разрыв', async () => {
    const port = (server.address() as AddressInfo).port;
    const answer = await new Promise<string>((resolve) => {
      const s = connect(port, '127.0.0.1', () =>
        s.write('GET / HTTP/1.1\r\nHost: x\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n'),
      );
      let data = '';
      s.on('data', (d) => (data += d));
      s.on('close', () => resolve(data));
    });
    expect(answer.startsWith('HTTP/1.1 400')).toBe(true);
  });
});
