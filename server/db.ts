// SQLite (встроенный node:sqlite): пользователи, сессии, результаты. Один файл, без внешних зависимостей.

import { DatabaseSync } from 'node:sqlite';

export type Db = DatabaseSync;

export function openDb(path: string): Db {
  const db = new DatabaseSync(path);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS users (
      id         INTEGER PRIMARY KEY,
      email      TEXT NOT NULL UNIQUE COLLATE NOCASE,
      nick       TEXT NOT NULL UNIQUE COLLATE NOCASE,
      pass       TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS results (
      id           INTEGER PRIMARY KEY,
      user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      board        TEXT NOT NULL,
      reps         INTEGER NOT NULL,
      clean_reps   INTEGER NOT NULL,
      avg_score    REAL NOT NULL,
      duration_sec REAL NOT NULL,
      rating       INTEGER NOT NULL,
      tiebreak     REAL NOT NULL,
      errors       TEXT NOT NULL DEFAULT '{}',
      created_at   INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS results_board ON results(board, created_at);
    CREATE INDEX IF NOT EXISTS results_user ON results(user_id, board, created_at);
  `);
  return db;
}
