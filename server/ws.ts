// Минимальный WebSocket-сервер (RFC 6455) на node:http — для онлайн-дуэли (E-26).
// Своя реализация, потому что у API на VPS нет node_modules (деплой копирует только server/ и src/shared/).
// Умеет ровно то, что шлёт браузер: маскированные текстовые кадры, ping/pong, close. Строго по безопасности:
// кадр без маски, больше лимита, фрагмент, бинарный кадр или битый UTF-8 — закрываем соединение.

import { createHash } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const utf8 = new TextDecoder('utf-8', { fatal: true });

export class WsError extends Error {
  constructor(
    readonly code: number,
    message: string,
  ) {
    super(message);
  }
}

export interface Frame {
  opcode: number;
  payload: Buffer;
}

/** Кадр; mask — только для клиентских кадров (в тестах), сервер шлёт без маски. */
export function encodeFrame(opcode: number, payload: Buffer, mask?: Buffer, fin = true): Buffer {
  const len = payload.length;
  const ext = len < 126 ? 0 : len < 65_536 ? 2 : 8;
  const head = Buffer.alloc(2 + ext + (mask ? 4 : 0));
  head[0] = (fin ? 0x80 : 0) | opcode;
  head[1] = (mask ? 0x80 : 0) | (ext === 0 ? len : ext === 2 ? 126 : 127);
  if (ext === 2) head.writeUInt16BE(len, 2);
  if (ext === 8) head.writeBigUInt64BE(BigInt(len), 2);
  if (!mask) return Buffer.concat([head, payload]);
  mask.copy(head, 2 + ext);
  const body = Buffer.from(payload);
  for (let i = 0; i < body.length; i += 1) body[i]! ^= mask[i % 4]!;
  return Buffer.concat([head, body]);
}

/** Разбор кадров клиента из потока (куски из сети могут резать кадр где угодно). */
export class FrameParser {
  private buf: Buffer = Buffer.alloc(0);

  constructor(private readonly maxPayload: number) {}

  push(chunk: Buffer): Frame[] {
    this.buf = this.buf.length ? Buffer.concat([this.buf, chunk]) : chunk;
    const out: Frame[] = [];
    for (;;) {
      const frame = this.next();
      if (!frame) return out;
      out.push(frame);
    }
  }

  private next(): Frame | null {
    const b = this.buf;
    if (b.length < 2) return null;
    const fin = (b[0]! & 0x80) !== 0;
    const opcode = b[0]! & 0x0f;
    if (b[0]! & 0x70) throw new WsError(1002, 'RSV');
    if (!(b[1]! & 0x80)) throw new WsError(1002, 'кадр клиента без маски');
    let len = b[1]! & 0x7f;
    let off = 2;
    if (len === 126) {
      if (b.length < 4) return null;
      len = b.readUInt16BE(2);
      off = 4;
    } else if (len === 127) {
      if (b.length < 10) return null;
      const big = b.readBigUInt64BE(2);
      len = big > BigInt(this.maxPayload) ? this.maxPayload + 1 : Number(big);
      off = 10;
    }
    if (opcode >= 8 && (!fin || len > 125)) throw new WsError(1002, 'управляющий кадр');
    if (len > this.maxPayload) throw new WsError(1009, 'слишком большой кадр');
    if (opcode < 8 && (!fin || opcode === 0)) throw new WsError(1003, 'фрагменты не поддерживаем');
    if (opcode !== 1 && opcode < 8) throw new WsError(1003, 'только текст');
    if (b.length < off + 4 + len) return null;
    const mask = b.subarray(off, off + 4);
    const payload = Buffer.from(b.subarray(off + 4, off + 4 + len));
    for (let i = 0; i < payload.length; i += 1) payload[i]! ^= mask[i % 4]!;
    this.buf = b.subarray(off + 4 + len);
    if (opcode === 1) {
      try {
        utf8.decode(payload);
      } catch {
        throw new WsError(1007, 'не UTF-8');
      }
    }
    return { opcode, payload };
  }
}

/** Одно соединение: onmessage — текст клиента, onclose — один раз при любом завершении. */
export class WsConn {
  onmessage: (text: string) => void = () => {};
  onclose: () => void = () => {};
  /** Ответил на последний ping. */
  alive = true;
  private done = false;
  private closing = false;

  constructor(
    private readonly socket: Duplex,
    maxPayload: number,
    head: Buffer,
  ) {
    const parser = new FrameParser(maxPayload);
    const onData = (chunk: Buffer) => {
      let frames: Frame[];
      try {
        frames = parser.push(chunk);
      } catch (e) {
        this.close(e instanceof WsError ? e.code : 1002);
        return;
      }
      for (const f of frames) this.handle(f);
    };
    socket.on('data', onData);
    socket.on('close', () => this.finish());
    socket.on('error', () => this.finish());
    if (head.length) onData(head);
  }

  send(text: string): void {
    if (!this.done && !this.closing) this.socket.write(encodeFrame(1, Buffer.from(text)));
  }

  ping(): void {
    if (this.done || this.closing) return;
    this.alive = false;
    this.socket.write(encodeFrame(9, Buffer.alloc(0)));
  }

  close(code = 1000): void {
    if (this.done || this.closing) return;
    this.closing = true;
    const body = Buffer.alloc(2);
    body.writeUInt16BE(code);
    this.socket.end(encodeFrame(8, body));
    // Клиент не закрыл со своей стороны — рвём сами.
    setTimeout(() => this.socket.destroy(), 2000).unref();
  }

  terminate(): void {
    this.socket.destroy();
  }

  private handle(f: Frame): void {
    if (f.opcode === 1) this.onmessage(f.payload.toString('utf8'));
    else if (f.opcode === 8) this.close(f.payload.length >= 2 ? f.payload.readUInt16BE(0) : 1000);
    else if (f.opcode === 9 && !this.closing) this.socket.write(encodeFrame(10, f.payload));
    else if (f.opcode === 10) this.alive = true;
  }

  private finish(): void {
    if (this.done) return;
    this.done = true;
    this.onclose();
  }
}

/** Рукопожатие по заголовкам браузера; кривое — 400 и разрыв (возвращает null). */
export function acceptWebSocket(
  req: IncomingMessage,
  socket: Duplex,
  head: Buffer,
  opts: { maxPayload: number },
): WsConn | null {
  const key = req.headers['sec-websocket-key'];
  const ok =
    req.method === 'GET' &&
    req.headers.upgrade?.toLowerCase() === 'websocket' &&
    req.headers['sec-websocket-version'] === '13' &&
    typeof key === 'string' &&
    Buffer.from(key, 'base64').length === 16;
  if (!ok) {
    reject(socket, 400, 'Bad Request');
    return null;
  }
  const accept = createHash('sha1')
    .update(key + GUID)
    .digest('base64');
  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n' +
      `Sec-WebSocket-Accept: ${accept}\r\n\r\n`,
  );
  (socket as Duplex & { setNoDelay?: (v: boolean) => void }).setNoDelay?.(true);
  return new WsConn(socket, opts.maxPayload, head);
}

/** Отказ до рукопожатия (403 — чужой Origin, 503 — перегрузка и т. п.). */
export function reject(socket: Duplex, status: number, text: string): void {
  socket.end(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  setTimeout(() => socket.destroy(), 1000).unref();
}
