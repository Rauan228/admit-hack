// Пароли — scrypt с солью; сессия — случайный токен в HttpOnly-cookie, в базе храним только его SHA-256.

import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

const KEY_LEN = 64;

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, KEY_LEN);
  return `scrypt:${salt.toString('hex')}:${hash.toString('hex')}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, saltHex, hashHex] = stored.split(':');
  if (scheme !== 'scrypt' || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = scryptSync(password, Buffer.from(saltHex, 'hex'), expected.length);
  return timingSafeEqual(expected, actual);
}

export function newToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,24}$/;
const NICK = /^[\p{L}\p{N}_\- ]{3,20}$/u;

export function checkEmail(v: unknown): string | null {
  return typeof v === 'string' && EMAIL.test(v.trim()) ? null : 'Проверь почту — похоже, в ней опечатка';
}

export function checkPassword(v: unknown): string | null {
  if (typeof v !== 'string' || v.length < 8) return 'Пароль — минимум 8 символов';
  if (v.length > 200) return 'Слишком длинный пароль';
  return null;
}

export function checkNick(v: unknown): string | null {
  if (typeof v !== 'string' || !NICK.test(v.trim()))
    return 'Ник — 3–20 символов: буквы, цифры, пробел, _ или -';
  return null;
}

/** Простой лимит попыток: не больше `max` за `windowMs` с одного ключа (IP). */
export class RateLimiter {
  private readonly hits = new Map<string, number[]>();
  private readonly max: number;
  private readonly windowMs: number;

  constructor(max: number, windowMs: number) {
    this.max = max;
    this.windowMs = windowMs;
  }

  allow(key: string, now = Date.now()): boolean {
    const list = (this.hits.get(key) ?? []).filter((t) => now - t < this.windowMs);
    if (list.length >= this.max) {
      this.hits.set(key, list);
      return false;
    }
    list.push(now);
    this.hits.set(key, list);
    if (this.hits.size > 5000) this.hits.clear(); // защита памяти от перебора адресов
    return true;
  }
}
