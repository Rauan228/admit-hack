// Клиент API аккаунтов и рейтинга (server/app.ts). Cookie-сессия, тот же адрес — CORS не нужен.
// Сеть недоступна (офлайн, деплой без API) — функции бросают ApiError с понятным текстом, приложение работает дальше.

import { useSyncExternalStore } from 'react';
import type { Board, ResultInput } from '../../shared/rating';

export interface ApiUser {
  id: number;
  nick: string;
  email: string;
}

export type Period = 'day' | 'week' | 'all';

export interface BoardRow {
  rank: number;
  nick: string;
  rating: number;
  tiebreak: number;
  reps: number;
  cleanReps: number;
  avgScore: number;
  durationSec: number;
  createdAt: number;
  me: boolean;
}

export interface BoardData {
  board: Board;
  period: Period;
  rule: string;
  players: number;
  rows: BoardRow[];
  me: BoardRow | null;
}

export interface SaveResponse {
  result: { id: number; board: Board; rating: number; tiebreak: number };
  personalBest: boolean;
  prevBest: number | null;
  prevLast: number | null;
  rank: number | null;
  players: number;
}

export interface HistoryItem {
  id: number;
  rating: number;
  tiebreak: number;
  reps: number;
  cleanReps: number;
  avgScore: number;
  durationSec: number;
  createdAt: number;
}

export interface ProgressData {
  boards: Partial<Record<Board, { history: HistoryItem[]; best: HistoryItem; count: number }>>;
}

export class ApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
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
  const data = (await res.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!res.ok || !data) throw new ApiError(res.status, data?.error ?? 'Сервер недоступен — попробуй позже');
  return data;
}

// ——— Текущий пользователь: один на приложение, компоненты подписываются через useAuth() ———

let auth: { user: ApiUser | null; known: boolean } = { user: null, known: false };
const listeners = new Set<() => void>();

function setUser(u: ApiUser | null): void {
  auth = { user: u, known: true };
  listeners.forEach((l) => l());
}

export function currentUser(): ApiUser | null {
  return auth.user;
}

/** user — кто вошёл; known — сервер уже ответил (до этого не показываем «Войти», чтобы не мигало). */
export function useAuth(): { user: ApiUser | null; known: boolean } {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => auth,
  );
}

/** Узнать, вошёл ли пользователь (при старте приложения). Ошибка сети — считаем гостем. */
export async function refreshMe(): Promise<ApiUser | null> {
  try {
    const { user: u } = await call<{ user: ApiUser | null }>('GET', '/me');
    setUser(u);
  } catch {
    setUser(null);
  }
  return auth.user;
}

export async function register(email: string, password: string, nick: string): Promise<ApiUser> {
  const { user: u } = await call<{ user: ApiUser }>('POST', '/register', { email, password, nick });
  setUser(u);
  return u;
}

export async function login(email: string, password: string): Promise<ApiUser> {
  const { user: u } = await call<{ user: ApiUser }>('POST', '/login', { email, password });
  setUser(u);
  return u;
}

export async function logout(): Promise<void> {
  await call('POST', '/logout').catch(() => undefined);
  setUser(null);
}

export function saveResult(input: ResultInput): Promise<SaveResponse> {
  return call<SaveResponse>('POST', '/results', input);
}

export function fetchBoard(board: Board, period: Period): Promise<BoardData> {
  return call<BoardData>('GET', `/leaderboard?board=${encodeURIComponent(board)}&period=${period}`);
}

export function fetchProgress(): Promise<ProgressData> {
  return call<ProgressData>('GET', '/me/progress');
}
