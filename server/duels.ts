// E-25: вызовы на дуэль. «Побей мой результат»: запись моих повторов уходит другу по ссылке
// или адресно (игроку из общего списка или из друзей) — он бьётся с ней на /duel.html и отвечает.
// Свои таблицы (duel_*), свои маршруты /api/duel/*; от app.ts — только текущий пользователь и разбор запроса.

import type { IncomingMessage, ServerResponse } from 'node:http';
import { randomInt } from 'node:crypto';
import { formatByMs, isArenaFormat, titleFor, type ArenaFormatId } from '../src/shared/arena.ts';
import {
  DEFAULT_DUEL_EXERCISE,
  checkTimeline,
  duelExerciseOf,
  isDuelExercise,
  type DuelExercise,
} from '../src/shared/duel.ts';
import { awardView, type ArenaStore } from './arena.ts';
import { RateLimiter, checkNick } from './auth.ts';
import type { Db } from './db.ts';

export interface DuelContext {
  db: Db;
  now: () => number;
  currentUser: (req: IncomingMessage) => { id: number; nick: string } | null;
  readJson: (req: IncomingMessage) => Promise<Record<string, unknown>>;
  ip: (req: IncomingMessage) => string;
  /** Ответить ошибкой с кодом: бросает HttpError приложения. */
  fail: (status: number, message: string) => never;
  arena: ArenaStore;
}

type Handler = (req: IncomingMessage, res: ServerResponse, url: URL) => unknown;

interface ChallengeRow {
  id: string;
  from_user: number;
  from_nick: string;
  to_user: number | null;
  to_nick: string | null;
  exercise: DuelExercise;
  duration_ms: number;
  reps: number;
  timeline: string;
  created_at: number;
}

interface AnswerRow {
  challenge_id: string;
  user_id: number | null;
  name: string;
  reps: number;
  created_at: number;
}

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS duel_challenges (
    id          TEXT PRIMARY KEY,
    from_user   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    to_user     INTEGER REFERENCES users(id) ON DELETE CASCADE,
    exercise    TEXT NOT NULL DEFAULT 'push_up',
    duration_ms INTEGER NOT NULL,
    reps        INTEGER NOT NULL,
    timeline    TEXT NOT NULL,
    created_at  INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS duel_challenges_to ON duel_challenges(to_user, created_at);
  CREATE INDEX IF NOT EXISTS duel_challenges_from ON duel_challenges(from_user, created_at);
  CREATE TABLE IF NOT EXISTS duel_answers (
    id           INTEGER PRIMARY KEY,
    challenge_id TEXT NOT NULL REFERENCES duel_challenges(id) ON DELETE CASCADE,
    user_id      INTEGER REFERENCES users(id) ON DELETE SET NULL,
    name         TEXT NOT NULL,
    reps         INTEGER NOT NULL,
    created_at   INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS duel_answers_challenge ON duel_answers(challenge_id, created_at);
  CREATE TABLE IF NOT EXISTS duel_friends (
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    friend_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (user_id, friend_id)
  );
`;

const CHALLENGE_COLUMNS = `c.id, c.from_user, f.nick AS from_nick, c.to_user, t.nick AS to_nick,
  c.exercise, c.duration_ms, c.reps, c.timeline, c.created_at
  FROM duel_challenges c JOIN users f ON f.id = c.from_user LEFT JOIN users t ON t.id = c.to_user`;

const ID_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const MINUTE = 60_000;

export function duelRoutes(ctx: DuelContext): Record<string, Handler> {
  const { db, now, fail } = ctx;
  db.exec(SCHEMA);
  // E-29: база до дуэлей на разных упражнениях — старые вызовы были на отжиманиях.
  const cols = db.prepare('PRAGMA table_info(duel_challenges)').all() as { name: string }[];
  if (!cols.some((col) => col.name === 'exercise'))
    db.exec(
      `ALTER TABLE duel_challenges ADD COLUMN exercise TEXT NOT NULL DEFAULT '${DEFAULT_DUEL_EXERCISE}'`,
    );
  const challengeLimit = new RateLimiter(20, 10 * MINUTE);
  const answerLimit = new RateLimiter(30, 10 * MINUTE);
  const socialLimit = new RateLimiter(120, MINUTE);

  const q = {
    userByNick: db.prepare('SELECT id, nick FROM users WHERE nick = ?'),
    insertChallenge: db.prepare(
      `INSERT INTO duel_challenges (id, from_user, to_user, exercise, duration_ms, reps, timeline, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ),
    challenge: db.prepare(`SELECT ${CHALLENGE_COLUMNS} WHERE c.id = ?`),
    incoming: db.prepare(
      `SELECT ${CHALLENGE_COLUMNS} WHERE c.to_user = ? ORDER BY c.created_at DESC LIMIT 30`,
    ),
    outgoing: db.prepare(
      `SELECT ${CHALLENGE_COLUMNS} WHERE c.from_user = ? ORDER BY c.created_at DESC LIMIT 30`,
    ),
    answers: db.prepare(
      `SELECT challenge_id, user_id, name, reps, created_at FROM duel_answers
       WHERE challenge_id = ? ORDER BY created_at ASC LIMIT 50`,
    ),
    answeredBy: db.prepare('SELECT reps FROM duel_answers WHERE challenge_id = ? AND user_id = ?'),
    insertAnswer: db.prepare(
      'INSERT INTO duel_answers (challenge_id, user_id, name, reps, created_at) VALUES (?, ?, ?, ?, ?)',
    ),
    // Общий список: друзья первыми, дальше — кто недавно тренировался.
    players: db.prepare(
      `SELECT u.nick,
         EXISTS (SELECT 1 FROM duel_friends f WHERE f.user_id = ? AND f.friend_id = u.id) AS friend,
         (SELECT MAX(r.created_at) FROM results r WHERE r.user_id = u.id) AS active,
         (SELECT COALESCE(SUM(ar.cups), 0) FROM arena_ratings ar WHERE ar.user_id = u.id) AS cups
       FROM users u WHERE u.id <> ? AND u.nick LIKE ? ESCAPE '\\'
       ORDER BY friend DESC, active DESC, u.nick COLLATE NOCASE LIMIT 50`,
    ),
    friends: db.prepare(
      `SELECT u.nick FROM duel_friends f JOIN users u ON u.id = f.friend_id
       WHERE f.user_id = ? ORDER BY u.nick COLLATE NOCASE`,
    ),
    addFriend: db.prepare(
      'INSERT OR IGNORE INTO duel_friends (user_id, friend_id, created_at) VALUES (?, ?, ?)',
    ),
    removeFriend: db.prepare('DELETE FROM duel_friends WHERE user_id = ? AND friend_id = ?'),
  };

  const signedIn = (req: IncomingMessage, why: string) => ctx.currentUser(req) ?? fail(401, why);
  const findUser = (nick: unknown) =>
    (typeof nick === 'string'
      ? (q.userByNick.get(nick.trim()) as { id: number; nick: string } | undefined)
      : null) ?? fail(404, 'Нет такого игрока');
  const findChallenge = (id: unknown) =>
    (typeof id === 'string' ? (q.challenge.get(id) as ChallengeRow | undefined) : null) ??
    fail(404, 'Вызов не найден — проверь ссылку');
  const answersOf = (id: string) => q.answers.all(id) as unknown as AnswerRow[];

  return {
    'POST /api/duel/challenge': async (req) => {
      const u = signedIn(req, 'Войди, чтобы бросить вызов');
      if (!challengeLimit.allow(String(u.id), now())) fail(429, 'Слишком много вызовов — подожди немного');
      const b = await ctx.readJson(req);
      // Старый клиент без поля — отжимания; чужое упражнение — отказ.
      const exercise = duelExerciseOf(b.exercise) ?? fail(400, 'Неизвестное упражнение');
      const bad = checkTimeline(b.timeline, b.durationMs, exercise);
      if (bad) fail(400, bad);
      let to: number | null = null;
      if (b.to !== undefined && b.to !== null && b.to !== '') {
        const target = findUser(b.to);
        if (target.id === u.id) fail(400, 'Нельзя вызвать самого себя');
        to = target.id;
      }
      const timeline = b.timeline as number[];
      const id = newId();
      q.insertChallenge.run(
        id,
        u.id,
        to,
        exercise,
        b.durationMs as number,
        timeline.length,
        JSON.stringify(timeline),
        now(),
      );
      return { id };
    },

    'GET /api/duel/challenge': (req, _res, url) => {
      const c = findChallenge(url.searchParams.get('id'));
      const u = ctx.currentUser(req);
      return {
        challenge: {
          ...challengeView(c),
          timeline: JSON.parse(c.timeline) as number[],
          mine: !!u && c.from_user === u.id,
          forMe: !!u && c.to_user === u.id,
          answers: answersOf(c.id).map((a) => ({ ...answerView(a), me: !!u && a.user_id === u.id })),
        },
      };
    },

    'POST /api/duel/answer': async (req) => {
      const b = await ctx.readJson(req);
      const c = findChallenge(b.id);
      const u = ctx.currentUser(req);
      if (c.to_user !== null) {
        if (!u) return fail(401, 'Этот вызов адресован лично тебе — войди, чтобы ответить');
        if (u.id !== c.to_user) return fail(403, 'Этот вызов адресован другому игроку');
      }
      if (u && u.id === c.from_user) fail(400, 'Нельзя ответить на свой вызов');
      // Ответ — в том же упражнении, что и вызов: запись проверяем по его правилам.
      const bad = checkTimeline(b.timeline, c.duration_ms, c.exercise);
      if (bad) fail(400, bad);
      if (!answerLimit.allow(u ? `u${u.id}` : ctx.ip(req), now()))
        fail(429, 'Слишком часто — подожди немного');
      if (u && q.answeredBy.get(c.id, u.id)) fail(409, 'Ты уже ответил на этот вызов');
      const guestName =
        typeof b.name === 'string' && !checkNick(b.name) ? b.name.trim().replace(/\s+/g, ' ') : null;
      const reps = (b.timeline as number[]).length;
      q.insertAnswer.run(c.id, u?.id ?? null, u?.nick ?? guestName ?? 'Гость', reps, now());
      const outcome = reps > c.reps ? 'win' : reps < c.reps ? 'lose' : 'draw';
      // Гость и старый бой не на 30 с / 1 мин / 3 мин в рейтинг не идут.
      const format = formatByMs(c.duration_ms);
      if (!u || !format) return { ok: true, reps, outcome, award: null, rival: null };
      const pair = ctx.arena.settleMatch(now(), {
        id: `async:${c.id}:${u.id}`,
        exercise: c.exercise,
        format: format.id,
        a: { userId: c.from_user, reps: c.reps },
        b: { userId: u.id, reps },
        winnerUserId: outcome === 'draw' ? null : outcome === 'win' ? u.id : c.from_user,
      });
      const mine = pair ? (pair.a.userId === u.id ? pair.a : pair.b) : null;
      const other = pair && mine ? (mine === pair.a ? pair.b : pair.a) : null;
      return {
        ok: true,
        reps,
        outcome,
        award: mine ? awardView(mine) : null,
        rival: other ? { title: other.title, frame: other.frame } : null,
      };
    },

    'GET /api/duel/inbox': (req) => {
      const u = signedIn(req, 'Войди, чтобы видеть вызовы');
      const incoming = (q.incoming.all(u.id) as unknown as ChallengeRow[]).map((c) => {
        const mine = q.answeredBy.get(c.id, u.id) as { reps: number } | undefined;
        return { ...challengeView(c), answered: mine ? { reps: mine.reps } : null };
      });
      const outgoing = (q.outgoing.all(u.id) as unknown as ChallengeRow[]).map((c) => ({
        ...challengeView(c),
        answers: answersOf(c.id).map(answerView),
      }));
      return { incoming, outgoing };
    },

    'GET /api/duel/players': (req, _res, url) => {
      const u = signedIn(req, 'Войди, чтобы видеть игроков');
      if (!socialLimit.allow(String(u.id), now())) fail(429, 'Слишком часто — подожди минуту');
      const prefix = (url.searchParams.get('q') ?? '')
        .trim()
        .slice(0, 20)
        .replace(/[\\%_]/g, '\\$&');
      const rows = q.players.all(u.id, u.id, `${prefix}%`) as {
        nick: string;
        friend: number;
        cups: number;
      }[];
      return {
        players: rows.map((r) => {
          const title = titleFor(r.cups);
          return {
            nick: r.nick,
            friend: r.friend === 1,
            cups: r.cups,
            title: title?.name ?? null,
            frame: title?.id ?? null,
          };
        }),
      };
    },

    'GET /api/duel/friends': (req) => {
      const u = signedIn(req, 'Войди, чтобы видеть друзей');
      return { friends: (q.friends.all(u.id) as { nick: string }[]).map((r) => ({ nick: r.nick })) };
    },

    'GET /api/duel/standing': (req) => {
      const u = signedIn(req, 'Войди, чтобы видеть кубки');
      return ctx.arena.standing(u.id);
    },

    // Арена: последние бои и кривая кубков для карточки «Твой рейтинг».
    'GET /api/duel/history': (req, _res, url) => {
      const u = signedIn(req, 'Войди, чтобы видеть свои дуэли');
      const limit = Math.min(50, Math.max(1, Number(url.searchParams.get('limit')) || 20));
      return ctx.arena.history(u.id, limit);
    },

    'GET /api/duel/ladder': (req, _res, url) => {
      const rawFormat = url.searchParams.get('format');
      const rawExercise = url.searchParams.get('exercise');
      const rawPeriod = url.searchParams.get('period');
      if (rawFormat && !isArenaFormat(rawFormat)) fail(400, 'Неизвестный разряд');
      if (rawExercise && !isDuelExercise(rawExercise)) fail(400, 'Неизвестное упражнение');
      if (rawPeriod && rawPeriod !== 'all' && rawPeriod !== 'week') fail(400, 'Неизвестный период');
      const u = ctx.currentUser(req);
      return ctx.arena.ladder(
        (rawFormat || null) as ArenaFormatId | null,
        rawExercise || null,
        u?.id ?? null,
        rawPeriod === 'week' ? 'week' : 'all',
        now(),
      );
    },

    'POST /api/duel/friends': async (req) => {
      const u = signedIn(req, 'Войди, чтобы добавлять друзей');
      if (!socialLimit.allow(String(u.id), now())) fail(429, 'Слишком часто — подожди минуту');
      const b = await ctx.readJson(req);
      const friend = findUser(b.nick);
      if (friend.id === u.id) fail(400, 'Себя в друзья добавить нельзя');
      if (b.add === false) q.removeFriend.run(u.id, friend.id);
      else q.addFriend.run(u.id, friend.id, now());
      return { ok: true };
    },
  };
}

function challengeView(c: ChallengeRow) {
  return {
    id: c.id,
    from: c.from_nick,
    to: c.to_nick,
    exercise: duelExerciseOf(c.exercise) ?? DEFAULT_DUEL_EXERCISE,
    reps: c.reps,
    durationMs: c.duration_ms,
    createdAt: c.created_at,
  };
}

function answerView(a: AnswerRow) {
  return { name: a.name, reps: a.reps, createdAt: a.created_at };
}

/** id вызова в ссылке: 10 символов base62 (~60 бит) — не подобрать перебором. */
function newId(): string {
  let id = '';
  for (let i = 0; i < 10; i += 1) id += ID_ALPHABET[randomInt(ID_ALPHABET.length)];
  return id;
}
