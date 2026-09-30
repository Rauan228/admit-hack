// E-26: соединение страницы с онлайн-дуэлью (/api/duel/ws). Переподключается само (0,5 → 8 с)
// и после обрыва возвращается в свою комнату по ключу. Часы сервера → часы страницы: по полю now в
// каждом состоянии комнаты (задержку сети в одну сторону не учитываем — это десятки мс).

import type { ClientMsg, RoomView, ServerMsg } from '../shared/duelRoom';

export interface LiveHandlers {
  message(m: ServerMsg): void;
  connected(on: boolean): void;
}

const URL_WS = (() => {
  const base = import.meta.env.BASE_URL.replace(/\/$/, '');
  return `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}${base}/api/duel/ws`;
})();

export class Live {
  private ws: WebSocket | null = null;
  private retry = 500;
  /** Что пытались отправить без связи — уйдёт сразу после подключения. */
  private queue: ClientMsg[] = [];
  /** Комната и ключ — чтобы вернуться после обрыва. */
  private room: string | null = null;
  private key: string | null = null;
  private name: string | undefined;
  /** Разница часов: сервер − performance.now() страницы. */
  private offset = 0;
  private readonly handlers: LiveHandlers;

  constructor(handlers: LiveHandlers) {
    this.handlers = handlers;
  }

  connect(): void {
    if (this.ws) return;
    let ws: WebSocket;
    try {
      ws = new WebSocket(URL_WS);
    } catch {
      return this.later();
    }
    this.ws = ws;
    ws.onopen = () => {
      this.retry = 500;
      this.handlers.connected(true);
      if (this.room) this.raw({ t: 'join', room: this.room, key: this.key ?? undefined, name: this.name });
      for (const m of this.queue.splice(0)) this.raw(m);
    };
    ws.onmessage = (e) => {
      let m: ServerMsg;
      try {
        m = JSON.parse(String(e.data)) as ServerMsg;
      } catch {
        return;
      }
      if (m.t === 'room') {
        this.offset = m.room.now - performance.now();
        this.room = m.room.id;
        this.key = m.key;
      }
      if (m.t === 'left') this.room = this.key = null;
      this.handlers.message(m);
    };
    ws.onclose = () => {
      if (this.ws !== ws) return; // закрыли сами при переподключении
      this.ws = null;
      this.handlers.connected(false);
      this.later();
    };
  }

  /** Забыть комнату и не возвращаться в неё после переподключения (выход из аккаунта). */
  dropRoom(): void {
    if (this.ws?.readyState === WebSocket.OPEN && this.room) this.raw({ t: 'leave' });
    this.room = null;
    this.key = null;
    this.name = undefined;
    this.queue = [];
  }

  /** Переподключиться — после входа или выхода: сервер узнаёт игрока по cookie при рукопожатии. */
  reconnect(): void {
    const ws = this.ws;
    this.ws = null;
    ws?.close();
    this.connect();
  }

  /** Время сервера → performance.now() страницы. */
  toLocal(serverTime: number): number {
    return serverTime - this.offset;
  }

  create(exercise?: string, durationMs?: number): void {
    this.send({ t: 'create', exercise, durationMs });
  }

  join(room: string, name?: string): void {
    this.name = name;
    this.send({ t: 'join', room, name, key: room === this.room ? (this.key ?? undefined) : undefined });
  }

  send(m: ClientMsg): void {
    if (this.ws?.readyState === WebSocket.OPEN) return this.raw(m);
    // Повтор из прошлого уже не нужен; действия (создать, войти, позвать, готов) — дошлём после подключения.
    if (m.t !== 'rep') this.queue.push(m);
    this.connect();
  }

  roomId(): string | null {
    return this.room;
  }

  private raw(m: ClientMsg): void {
    this.ws?.send(JSON.stringify(m));
  }

  private later(): void {
    setTimeout(() => this.connect(), this.retry);
    this.retry = Math.min(8000, this.retry * 2);
  }
}

export type { RoomView };
