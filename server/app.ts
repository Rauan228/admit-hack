// HTTP API FORMA: аккаунты (почта + пароль), сохранение результатов, лидерборды и личный прогресс.
// Без фреймворков: node:http + node:sqlite. Рейтинг считает сервер по общим формулам (src/shared/rating.ts).

import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  BOARD_INFO,
  boardKind,
  isBoard,
  rate,
  validate,
  type Board,
  type ResultInput,
} from '../src/shared/rating.ts';
import {
  RateLimiter,
  checkEmail,
  checkNick,
  checkPassword,
  hashPassword,
  hashToken,
  newToken,
  verifyPassword,
} from './auth.ts';
import { createArena } from './arena.ts';
import type { Db } from './db.ts';
import { createDuelLive, type LiveOptions } from './duelLive.ts';
import { duelRoutes } from './duels.ts';

const COOKIE = 'forma_sid';
const SESSION_DAYS = 30;
const DAY_MS = 86_400_000;
/** «Сегодня» — по Астане (UTC+5): хакатон и жюри там. */
const TZ_OFFSET_MS = 5 * 3_600_000;
const MAX_BODY = 16 * 1024;

export type Period = 'day' | 'week' | 'all';

export interface AppOptions {
  /** Ставить Secure на cookie (прод за https). */
  secureCookies?: boolean;
  now?: () => number;
  /** E-26: длительности онлайн-дуэли (в тестах — короткие). */
  duel?: Omit<LiveOptions, 'now'>;
}

interface User {
  id: number;
  email: string;
  nick: string;
}

class HttpError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

interface ResultRow {
  id: number;
  user_id: number;
  nick: string;
  board: string;
  reps: number;
  clean_reps: number;
  avg_score: number;
  duration_sec: number;
  rating: number;
  tiebreak: number;
  created_at: number;
}

export function periodStart(period: Period, now: number): number {
  if (period === 'all') return 0;
  if (period === 'week') return now - 7 * DAY_MS;
  return Math.floor((now + TZ_OFFSET_MS) / DAY_MS) * DAY_MS - TZ_OFFSET_MS;
}

export function createApp(db: Db, opts: AppOptions = {}) {
  const now = opts.now ?? Date.now;
  const authLimit = new RateLimiter(8, 60_000);
  const saveLimit = new RateLimiter(20, 60_000);

  const q = {
    userByEmail: db.prepare('SELECT id, email, nick, pass FROM users WHERE email = ?'),
    userByNick: db.prepare('SELECT id FROM users WHERE nick = ?'),
    insertUser: db.prepare('INSERT INTO users (email, nick, pass, created_at) VALUES (?, ?, ?, ?)'),
    insertSession: db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)'),
    session: db.prepare(
      `SELECT u.id, u.email, u.nick FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = ? AND s.expires_at > ?`,
    ),
    deleteSession: db.prepare('DELETE FROM sessions WHERE token_hash = ?'),
    purgeSessions: db.prepare('DELETE FROM sessions WHERE expires_at <= ?'),
    insertResult: db.prepare(
      `INSERT INTO results (user_id, board, reps, clean_reps, avg_score, duration_sec, rating, tiebreak, errors, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ),
    // Лучший результат каждого игрока на доске за период.
    board: db.prepare(
      `WITH ranked AS (
         SELECT r.*, ROW_NUMBER() OVER (
           PARTITION BY r.user_id ORDER BY r.rating DESC, r.tiebreak DESC, r.created_at ASC) AS rn
         FROM results r WHERE r.board = ? AND r.created_at >= ?)
       SELECT ranked.*, u.nick FROM ranked JOIN users u ON u.id = ranked.user_id
       WHERE rn = 1 ORDER BY rating DESC, tiebreak DESC, created_at ASC LIMIT 5000`,
    ),
    myBest: db.prepare(
      `SELECT rating, tiebreak FROM results WHERE user_id = ? AND board = ? AND id <> ?
       ORDER BY rating DESC, tiebreak DESC LIMIT 1`,
    ),
    myLast: db.prepare(
      'SELECT rating FROM results WHERE user_id = ? AND board = ? AND id <> ? ORDER BY created_at DESC, id DESC LIMIT 1',
    ),
    myHistory: db.prepare(
      `SELECT id, board, reps, clean_reps, avg_score, duration_sec, rating, tiebreak, created_at
       FROM results WHERE user_id = ? ORDER BY created_at ASC, id ASC`,
    ),
  };

  function currentUser(req: IncomingMessage): User | null {
    const token = readCookie(req, COOKIE);
    if (!token) return null;
    const row = q.session.get(hashToken(token), now()) as User | undefined;
    return row ?? null;
  }

  function startSession(res: ServerResponse, userId: number): void {
    const token = newToken();
    q.purgeSessions.run(now());
    q.insertSession.run(hashToken(token), userId, now() + SESSION_DAYS * DAY_MS);
    setCookie(res, `${COOKIE}=${token}; Max-Age=${SESSION_DAYS * 86400}`, opts.secureCookies);
  }

  function leaderboard(board: Board, period: Period) {
    return (q.board.all(board, periodStart(period, now())) as unknown as ResultRow[]).map((r, i) => ({
      rank: i + 1,
      userId: r.user_id,
      nick: r.nick,
      rating: r.rating,
      tiebreak: r.tiebreak,
      reps: r.reps,
      cleanReps: r.clean_reps,
      avgScore: Math.round(r.avg_score),
      durationSec: r.duration_sec,
      createdAt: r.created_at,
    }));
  }

  const routes: Record<
    string,
    (req: IncomingMessage, res: ServerResponse, url: URL) => Promise<unknown> | unknown
  > = {
    // Заодно держит ссылку на базу: без неё сборщик мусора закрывает DatabaseSync и «финализирует» запросы.
    'GET /api/health': () => ({ ok: db.prepare('SELECT 1 AS ok').get()?.ok === 1 }),

    'GET /api/me': (req) => {
      const u = currentUser(req);
      return { user: u ? { id: u.id, nick: u.nick, email: u.email } : null };
    },

    'POST /api/register': async (req, res) => {
      if (!authLimit.allow(ip(req))) throw new HttpError(429, 'Слишком много попыток — подожди минуту');
      const b = await readJson(req);
      const err = checkEmail(b.email) ?? checkNick(b.nick) ?? checkPassword(b.password);
      if (err) throw new HttpError(400, err);
      const email = String(b.email).trim().toLowerCase();
      const nick = String(b.nick).trim().replace(/\s+/g, ' ');
      if (q.userByEmail.get(email)) throw new HttpError(409, 'Эта почта уже зарегистрирована — войди');
      if (q.userByNick.get(nick)) throw new HttpError(409, 'Такой ник уже занят');
      const r = q.insertUser.run(email, nick, hashPassword(String(b.password)), now());
      const id = Number(r.lastInsertRowid);
      startSession(res, id);
      return { user: { id, nick, email } };
    },

    'POST /api/login': async (req, res) => {
      if (!authLimit.allow(ip(req))) throw new HttpError(429, 'Слишком много попыток — подожди минуту');
      const b = await readJson(req);
      const row =
        typeof b.email === 'string'
          ? (q.userByEmail.get(b.email.trim().toLowerCase()) as (User & { pass: string }) | undefined)
          : undefined;
      if (!row || typeof b.password !== 'string' || !verifyPassword(b.password, row.pass))
        throw new HttpError(401, 'Неверная почта или пароль');
      startSession(res, row.id);
      return { user: { id: row.id, nick: row.nick, email: row.email } };
    },

    'POST /api/logout': (req, res) => {
      const token = readCookie(req, COOKIE);
      if (token) q.deleteSession.run(hashToken(token));
      setCookie(res, `${COOKIE}=; Max-Age=0`, opts.secureCookies);
      return { ok: true };
    },

    'POST /api/results': async (req) => {
      const u = currentUser(req);
      if (!u) throw new HttpError(401, 'Войди, чтобы сохранить результат');
      if (!saveLimit.allow(String(u.id))) throw new HttpError(429, 'Слишком часто — подожди минуту');
      const b = await readJson(req);
      const input: ResultInput = {
        board: b.board as Board,
        reps: Number(b.reps),
        cleanReps: Number(b.cleanReps),
        avgScore: Number(b.avgScore),
        durationSec: Number(b.durationSec),
        errorCounts: sanitizeErrors(b.errorCounts),
      };
      const bad = validate(input);
      if (bad) throw new HttpError(400, bad);
      const { rating, tiebreak } = rate(input);
      const r = q.insertResult.run(
        u.id,
        input.board,
        input.reps,
        input.cleanReps,
        input.avgScore,
        input.durationSec,
        rating,
        tiebreak,
        JSON.stringify(input.errorCounts ?? {}),
        now(),
      );
      const id = Number(r.lastInsertRowid);
      const prevBest = q.myBest.get(u.id, input.board, id) as
        { rating: number; tiebreak: number } | undefined;
      const prevLast = q.myLast.get(u.id, input.board, id) as { rating: number } | undefined;
      const all = leaderboard(input.board, 'all');
      const mine = all.find((row) => row.userId === u.id);
      return {
        result: { id, board: input.board, rating, tiebreak },
        personalBest:
          !prevBest ||
          rating > prevBest.rating ||
          (rating === prevBest.rating && tiebreak > prevBest.tiebreak),
        prevBest: prevBest?.rating ?? null,
        prevLast: prevLast?.rating ?? null,
        rank: mine?.rank ?? null,
        players: all.length,
      };
    },

    'GET /api/leaderboard': (req, _res, url) => {
      const board = url.searchParams.get('board') ?? 'quick';
      const period = (url.searchParams.get('period') ?? 'all') as Period;
      if (!isBoard(board)) throw new HttpError(400, 'Неизвестный режим');
      if (!['day', 'week', 'all'].includes(period)) throw new HttpError(400, 'Неизвестный период');
      const u = currentUser(req);
      const rows = leaderboard(board, period);
      const limit = Math.min(100, Math.max(1, Number(url.searchParams.get('limit')) || 50));
      const strip = ({ userId, ...row }: (typeof rows)[number]) => ({ ...row, me: !!u && userId === u.id });
      const mine = u ? rows.find((r) => r.userId === u.id) : undefined;
      return {
        board,
        period,
        rule: BOARD_INFO[boardKind(board)].rule,
        players: rows.length,
        rows: rows.slice(0, limit).map(strip),
        me: mine ? strip(mine) : null,
      };
    },

    'GET /api/me/progress': (req) => {
      const u = currentUser(req);
      if (!u) throw new HttpError(401, 'Войди, чтобы видеть свой прогресс');
      const rows = q.myHistory.all(u.id) as unknown as Omit<ResultRow, 'nick' | 'user_id'>[];
      const boards: Record<string, { history: unknown[]; best: unknown; count: number }> = {};
      for (const r of rows) {
        const item = {
          id: r.id,
          rating: r.rating,
          tiebreak: r.tiebreak,
          reps: r.reps,
          cleanReps: r.clean_reps,
          avgScore: Math.round(r.avg_score),
          durationSec: r.duration_sec,
          createdAt: r.created_at,
        };
        const b = (boards[r.board] ??= { history: [], best: item, count: 0 });
        b.history.push(item);
        b.count += 1;
        const best = b.best as typeof item;
        if (item.rating > best.rating || (item.rating === best.rating && item.tiebreak > best.tiebreak))
          b.best = item;
      }
      return { boards };
    },
  };

  // Кубки арены — те же таблицы видят и вызовы, и онлайн-бой.
  const arena = createArena(db);

  // E-25: вызовы на дуэль — свой модуль и свои таблицы (server/duels.ts).
  Object.assign(
    routes,
    duelRoutes({
      db,
      now,
      currentUser,
      readJson,
      ip,
      arena,
      fail: (status, message) => {
        throw new HttpError(status, message);
      },
    }),
  );

  // E-26: онлайн-дуэль по WebSocket — index.ts вешает live.upgrade на 'upgrade' сервера.
  const live = createDuelLive(currentUser, { now, ...opts.duel, arena });

  const handle = async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const route = routes[`${req.method} ${url.pathname}`];
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    try {
      if (!route) throw new HttpError(404, 'Не найдено');
      const body = await route(req, res, url);
      res.statusCode = 200;
      res.end(JSON.stringify(body));
    } catch (e) {
      const status = e instanceof HttpError ? e.status : 500;
      if (status === 500) console.error(e);
      res.statusCode = status;
      res.end(JSON.stringify({ error: e instanceof HttpError ? e.message : 'Ошибка сервера' }));
    }
  };
  return Object.assign(handle, { upgrade: live.upgrade, close: live.close });
}

function ip(req: IncomingMessage): string {
  const fwd = req.headers['x-real-ip'] ?? req.headers['x-forwarded-for'];
  const v = Array.isArray(fwd) ? fwd[0] : fwd;
  return (v?.split(',')[0] ?? req.socket.remoteAddress ?? '?').trim();
}

function readCookie(req: IncomingMessage, name: string): string | null {
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return v.join('=') || null;
  }
  return null;
}

function setCookie(res: ServerResponse, value: string, secure?: boolean): void {
  res.setHeader('Set-Cookie', `${value}; Path=/; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`);
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY) throw new HttpError(413, 'Слишком большой запрос');
    chunks.push(chunk as Buffer);
  }
  try {
    const v = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') as unknown;
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  } catch {
    throw new HttpError(400, 'Некорректный JSON');
  }
}

/** Счётчики ошибок: только короткие коды и небольшие целые числа. */
function sanitizeErrors(v: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (!v || typeof v !== 'object') return out;
  for (const [k, n] of Object.entries(v as Record<string, unknown>).slice(0, 20)) {
    if (/^[a-z_]{1,40}$/.test(k) && Number.isInteger(n) && (n as number) >= 0 && (n as number) < 1000)
      out[k] = n as number;
  }
  return out;
}
