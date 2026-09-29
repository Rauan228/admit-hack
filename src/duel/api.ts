// E-25: запросы страницы дуэли к API (server/duels.ts + вход из server/app.ts).
// Свой маленький fetch: клиент платформы (ui/store/api.ts) тянет React, а страница дуэли — без него.
// Cookie-сессия общая с платформой: вошёл там — вошёл и здесь.

export interface Me {
  nick: string;
}

export interface Challenge {
  id: string;
  from: string;
  to: string | null;
  reps: number;
  durationMs: number;
  timeline: number[];
  createdAt: number;
  mine: boolean;
  forMe: boolean;
  answers: { name: string; reps: number; createdAt: number; me: boolean }[];
}

export interface Inbox {
  incoming: {
    id: string;
    from: string;
    reps: number;
    durationMs: number;
    answered: { reps: number } | null;
  }[];
  outgoing: { id: string; to: string | null; reps: number; answers: { name: string; reps: number }[] }[];
}

export interface Player {
  nick: string;
  friend: boolean;
}

export type Outcome = 'win' | 'lose' | 'draw';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

const BASE = `${import.meta.env.BASE_URL.replace(/\/$/, '')}/api`;

async function call<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(BASE + path, {
      method,
      credentials: 'same-origin',
      headers: body === undefined ? undefined : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, 'Нет связи с сервером — проверь интернет');
  }
  // Зеркало без API (GitHub Pages) отдаёт HTML-страницу 404 — это «сервера нет», а не ошибка запроса.
  const data = (await res.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!data) throw new ApiError(0, 'Вызовы друзьям работают на основном сайте');
  if (!res.ok) throw new ApiError(res.status, data.error ?? 'Ошибка сервера');
  return data;
}

export const api = {
  me: () => call<{ user: Me | null }>('GET', '/me').then((r) => r.user),
  login: (email: string, password: string) =>
    call<{ user: Me }>('POST', '/login', { email, password }).then((r) => r.user),
  register: (email: string, nick: string, password: string) =>
    call<{ user: Me }>('POST', '/register', { email, nick, password }).then((r) => r.user),
  logout: () => call<{ ok: true }>('POST', '/logout'),
  challenge: (timeline: number[], durationMs: number, to?: string) =>
    call<{ id: string }>('POST', '/duel/challenge', { timeline, durationMs, to }).then((r) => r.id),
  getChallenge: (id: string) =>
    call<{ challenge: Challenge }>('GET', `/duel/challenge?id=${encodeURIComponent(id)}`).then(
      (r) => r.challenge,
    ),
  answer: (id: string, timeline: number[], name?: string) =>
    call<{ reps: number; outcome: Outcome }>('POST', '/duel/answer', { id, timeline, name }),
  inbox: () => call<Inbox>('GET', '/duel/inbox'),
  players: (q = '') =>
    call<{ players: Player[] }>('GET', `/duel/players?q=${encodeURIComponent(q)}`).then((r) => r.players),
  friends: () => call<{ friends: { nick: string }[] }>('GET', '/duel/friends').then((r) => r.friends),
  setFriend: (nick: string, add: boolean) => call<{ ok: true }>('POST', '/duel/friends', { nick, add }),
};

/** Ссылка на вызов: /duel.html#c=<id> (в hash — не уходит в логи сервера). */
export function challengeUrl(id: string): string {
  return new URL(`${import.meta.env.BASE_URL}duel.html#c=${id}`, location.origin).href;
}
