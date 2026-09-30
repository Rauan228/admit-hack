// Кубки арены в SQLite. Одна доска — упражнение × разряд (пуля / блиц / рапид).
// Повторный вызов с тем же id боя ничего не меняет: поздний повтор и реванш не начисляют дважды.

import {
  ARENA_FORMATS,
  applyCups,
  cupDelta,
  isArenaFormat,
  levelProgress,
  nextTitle,
  titleFor,
  xpGain,
  type ArenaBoardStanding,
  type ArenaFormatId,
  type ArenaOutcome,
  type ArenaStanding,
  type AwardView,
  type LadderData,
  type LadderEntry,
} from '../src/shared/arena.ts';
import type { Db } from './db.ts';

export interface MatchSide {
  userId: number;
  reps: number;
}

export interface MatchInput {
  /** Уникальный id: live:<комната>:<раунд> или async:<вызов>:<кто ответил>. */
  id: string;
  exercise: string;
  format: ArenaFormatId;
  a: MatchSide;
  b: MatchSide;
  /** null — ничья. Сдача тоже поражение, даже если повторов было больше. */
  winnerUserId: number | null;
}

export interface PlayerAward {
  userId: number;
  outcome: ArenaOutcome;
  cupsDelta: number;
  xpDelta: number;
  boardCups: number;
  totalCups: number;
  totalXp: number;
  title: string | null;
  frame: AwardView['frame'];
  titleChanged: boolean;
}

export interface MatchAwards {
  a: PlayerAward;
  b: PlayerAward;
}

interface BoardRow {
  cups: number;
  xp: number;
  wins: number;
  losses: number;
  draws: number;
}

interface RawRow {
  user_id: number;
  nick: string;
  exercise: string;
  format: string;
  cups: number;
  xp: number;
  wins: number;
  losses: number;
  draws: number;
}

const EMPTY: BoardRow = { cups: 0, xp: 0, wins: 0, losses: 0, draws: 0 };

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS arena_ratings (
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    exercise   TEXT NOT NULL,
    format     TEXT NOT NULL,
    cups       INTEGER NOT NULL DEFAULT 0 CHECK (cups >= 0),
    xp         INTEGER NOT NULL DEFAULT 0 CHECK (xp >= 0),
    wins       INTEGER NOT NULL DEFAULT 0,
    losses     INTEGER NOT NULL DEFAULT 0,
    draws      INTEGER NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (user_id, exercise, format)
  );
  CREATE TABLE IF NOT EXISTS arena_matches (
    id         TEXT PRIMARY KEY,
    exercise   TEXT NOT NULL,
    format     TEXT NOT NULL,
    a_user     INTEGER NOT NULL,
    b_user     INTEGER NOT NULL,
    a_reps     INTEGER NOT NULL,
    b_reps     INTEGER NOT NULL,
    winner     INTEGER,
    a_cups     INTEGER NOT NULL,
    b_cups     INTEGER NOT NULL,
    a_xp       INTEGER NOT NULL,
    b_xp       INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  );
`;

export interface ArenaStore {
  /** Записать исход. null — такой бой уже зачтён. Вызывать один раз, своей транзакцией. */
  settleMatch(now: number, input: MatchInput): MatchAwards | null;
  badge(userId: number): { title: string | null; frame: AwardView['frame'] };
  standing(userId: number): ArenaStanding;
  ladder(format: ArenaFormatId | null, exercise: string | null, meId: number | null): LadderData;
}

export function awardView(p: PlayerAward): AwardView {
  return {
    outcome: p.outcome,
    cupsDelta: p.cupsDelta,
    xpDelta: p.xpDelta,
    totalCups: p.totalCups,
    title: p.title,
    frame: p.frame,
    titleChanged: p.titleChanged,
  };
}

export function createArena(db: Db): ArenaStore {
  db.exec(SCHEMA);
  const q = {
    board: db.prepare(
      `SELECT cups, xp, wins, losses, draws FROM arena_ratings
       WHERE user_id = ? AND exercise = ? AND format = ?`,
    ),
    totals: db.prepare(
      `SELECT COALESCE(SUM(cups), 0) AS cups, COALESCE(SUM(xp), 0) AS xp
       FROM arena_ratings WHERE user_id = ?`,
    ),
    upsert: db.prepare(
      `INSERT INTO arena_ratings (user_id, exercise, format, cups, xp, wins, losses, draws, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id, exercise, format) DO UPDATE SET
         cups = excluded.cups, xp = excluded.xp, wins = excluded.wins,
         losses = excluded.losses, draws = excluded.draws, updated_at = excluded.updated_at`,
    ),
    insertMatch: db.prepare(
      `INSERT OR IGNORE INTO arena_matches
         (id, exercise, format, a_user, b_user, a_reps, b_reps, winner, a_cups, b_cups, a_xp, b_xp, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ),
    rows: db.prepare(
      `SELECT r.user_id, u.nick, r.exercise, r.format, r.cups, r.xp, r.wins, r.losses, r.draws
       FROM arena_ratings r JOIN users u ON u.id = r.user_id`,
    ),
    mine: db.prepare(
      `SELECT exercise, format, cups, xp, wins, losses, draws FROM arena_ratings WHERE user_id = ?`,
    ),
  };

  function boardOf(userId: number, exercise: string, format: string): BoardRow {
    return (q.board.get(userId, exercise, format) as BoardRow | undefined) ?? EMPTY;
  }

  function totalOf(userId: number): { cups: number; xp: number } {
    return q.totals.get(userId) as { cups: number; xp: number };
  }

  function outcomeFor(userId: number, winner: number | null): ArenaOutcome {
    if (winner === null) return 'draw';
    return winner === userId ? 'win' : 'lose';
  }

  function settleMatch(now: number, input: MatchInput): MatchAwards | null {
    if (!isArenaFormat(input.format)) return null;
    if (input.a.userId === input.b.userId) return null;
    if (
      input.winnerUserId !== null &&
      input.winnerUserId !== input.a.userId &&
      input.winnerUserId !== input.b.userId
    )
      return null;
    const beforeA = boardOf(input.a.userId, input.exercise, input.format);
    const beforeB = boardOf(input.b.userId, input.exercise, input.format);
    const outA = outcomeFor(input.a.userId, input.winnerUserId);
    const outB = outcomeFor(input.b.userId, input.winnerUserId);
    const moveA = applyCups(beforeA.cups, cupDelta(beforeA.cups, beforeB.cups, outA));
    const moveB = applyCups(beforeB.cups, cupDelta(beforeB.cups, beforeA.cups, outB));
    const xpA = xpGain(input.format, beforeA.cups, beforeB.cups, outA);
    const xpB = xpGain(input.format, beforeB.cups, beforeA.cups, outB);
    const totalA = totalOf(input.a.userId).cups;
    const totalB = totalOf(input.b.userId).cups;
    const titleA = titleFor(totalA);
    const titleB = titleFor(totalB);

    db.exec('BEGIN IMMEDIATE');
    try {
      const info = q.insertMatch.run(
        input.id,
        input.exercise,
        input.format,
        input.a.userId,
        input.b.userId,
        input.a.reps,
        input.b.reps,
        input.winnerUserId,
        moveA.applied,
        moveB.applied,
        xpA,
        xpB,
        now,
      );
      if (Number(info.changes) === 0) {
        db.exec('COMMIT');
        return null;
      }
      write(input.a.userId, input.exercise, input.format, beforeA, moveA.cups, beforeA.xp + xpA, outA, now);
      write(input.b.userId, input.exercise, input.format, beforeB, moveB.cups, beforeB.xp + xpB, outB, now);
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }

    const afterA = totalOf(input.a.userId);
    const afterB = totalOf(input.b.userId);
    return {
      a: player(input.a.userId, outA, moveA.applied, xpA, moveA.cups, afterA, titleA),
      b: player(input.b.userId, outB, moveB.applied, xpB, moveB.cups, afterB, titleB),
    };
  }

  function write(
    userId: number,
    exercise: string,
    format: string,
    before: BoardRow,
    cups: number,
    xp: number,
    outcome: ArenaOutcome,
    now: number,
  ): void {
    q.upsert.run(
      userId,
      exercise,
      format,
      cups,
      xp,
      before.wins + (outcome === 'win' ? 1 : 0),
      before.losses + (outcome === 'lose' ? 1 : 0),
      before.draws + (outcome === 'draw' ? 1 : 0),
      now,
    );
  }

  function player(
    userId: number,
    outcome: ArenaOutcome,
    cupsDelta: number,
    xpDelta: number,
    boardCups: number,
    total: { cups: number; xp: number },
    titleBefore: { id: string; name: string } | null,
  ): PlayerAward {
    const title = titleFor(total.cups);
    return {
      userId,
      outcome,
      cupsDelta,
      xpDelta,
      boardCups,
      totalCups: total.cups,
      totalXp: total.xp,
      title: title?.name ?? null,
      frame: title?.id ?? null,
      titleChanged: (titleBefore?.id ?? null) !== (title?.id ?? null),
    };
  }

  function badge(userId: number): { title: string | null; frame: AwardView['frame'] } {
    const t = titleFor(totalOf(userId).cups);
    return { title: t?.name ?? null, frame: t?.id ?? null };
  }

  function standing(userId: number): ArenaStanding {
    const rows = q.mine.all(userId) as unknown as Omit<RawRow, 'user_id' | 'nick'>[];
    const totals = rows.reduce((s, r) => ({ cups: s.cups + r.cups, xp: s.xp + r.xp }), { cups: 0, xp: 0 });
    const title = titleFor(totals.cups);
    const next = nextTitle(totals.cups);
    const lvl = levelProgress(totals.xp);
    const formats = ARENA_FORMATS.map((f) => {
      const part = rows.filter((r) => r.format === f.id);
      return {
        id: f.id,
        name: f.name,
        cups: part.reduce((s, r) => s + r.cups, 0),
        wins: part.reduce((s, r) => s + r.wins, 0),
        losses: part.reduce((s, r) => s + r.losses, 0),
        draws: part.reduce((s, r) => s + r.draws, 0),
      };
    });
    const boards: ArenaBoardStanding[] = rows
      .filter((r): r is ArenaBoardStanding => isArenaFormat(r.format))
      .map((r) => ({
        exercise: r.exercise,
        format: r.format,
        cups: r.cups,
        xp: r.xp,
        wins: r.wins,
        losses: r.losses,
        draws: r.draws,
      }))
      .sort((a, b) => b.cups - a.cups);
    return {
      cups: totals.cups,
      xp: totals.xp,
      level: lvl.level,
      into: lvl.into,
      span: lvl.span,
      title,
      frame: title?.id ?? null,
      nextTitle: next ? { name: next.name, left: next.left } : null,
      formats,
      boards,
    };
  }

  function ladder(format: ArenaFormatId | null, exercise: string | null, meId: number | null): LadderData {
    const raw = q.rows.all() as unknown as RawRow[];
    const byUser = new Map<
      number,
      { nick: string; cups: number; xp: number; wins: number; losses: number; draws: number; total: number }
    >();
    for (const r of raw) {
      let u = byUser.get(r.user_id);
      if (!u) {
        u = { nick: r.nick, cups: 0, xp: 0, wins: 0, losses: 0, draws: 0, total: 0 };
        byUser.set(r.user_id, u);
      }
      u.total += r.cups;
      if ((format === null || r.format === format) && (exercise === null || r.exercise === exercise)) {
        u.cups += r.cups;
        u.xp += r.xp;
        u.wins += r.wins;
        u.losses += r.losses;
        u.draws += r.draws;
      }
    }
    const ranked = [...byUser.entries()]
      .filter(([, u]) => u.wins + u.losses + u.draws > 0)
      .sort(
        (a, b) =>
          b[1].cups - a[1].cups ||
          b[1].wins - a[1].wins ||
          a[1].losses - b[1].losses ||
          a[1].nick.localeCompare(b[1].nick, 'ru'),
      );
    const entries: (LadderEntry & { id: number })[] = ranked.map(([id, u], i) => {
      const t = titleFor(u.total);
      return {
        id,
        rank: i + 1,
        nick: u.nick,
        cups: u.cups,
        xp: u.xp,
        wins: u.wins,
        losses: u.losses,
        draws: u.draws,
        title: t?.name ?? null,
        frame: t?.id ?? null,
        me: id === meId,
      };
    });
    const mine = entries.find((e) => e.me) ?? null;
    const top = entries.slice(0, 50).map(({ id: _id, ...row }) => row);
    return {
      format,
      exercise,
      rows: top,
      me: mine && mine.rank > 50 ? (({ id: _id, ...row }) => row)(mine) : null,
    };
  }

  return { settleMatch, badge, standing, ladder };
}
