// ИИ-конструктор плана тренировок: анкета → жёсткий фильтр по ограничениям → модель OpenAI (structured output)
// → проверка и нормализация ответа (src/shared/coach.ts). Ключ — только на сервере (OPENAI_API_KEY).
// Последний план вошедшего пользователя хранится в базе: открывается с любого устройства.

import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  COACH_EXERCISES,
  SYSTEM_PROMPT,
  checkProfile,
  hardExclusions,
  normalizePlan,
  planSchema,
  userPrompt,
  type CoachPlan,
  type CoachProfile,
} from '../src/shared/coach.ts';
import { RateLimiter } from './auth.ts';
import type { Db } from './db.ts';

export interface CoachContext {
  db: Db;
  now: () => number;
  currentUser: (req: IncomingMessage) => { id: number; nick: string } | null;
  readJson: (req: IncomingMessage) => Promise<Record<string, unknown>>;
  ip: (req: IncomingMessage) => string;
  fail: (status: number, message: string) => never;
  apiKey?: string;
  model?: string;
  /** Подмена запроса к модели в тестах: получает тело запроса, отдаёт JSON плана. */
  complete?: (body: Record<string, unknown>) => Promise<unknown>;
}

type Handler = (req: IncomingMessage, res: ServerResponse, url: URL) => unknown;

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS coach_plans (
    user_id    INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    profile    TEXT NOT NULL,
    plan       TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
`;

const TIMEOUT_MS = 90_000;

export function coachRoutes(ctx: CoachContext): Record<string, Handler> {
  ctx.db.exec(SCHEMA);
  const model = ctx.model ?? 'gpt-5.4-mini';
  // Запрос к модели стоит денег: гостю — 4 плана за 10 минут, вошедшему — 8.
  const guestLimit = new RateLimiter(4, 600_000);
  const userLimit = new RateLimiter(8, 600_000);
  const q = {
    save: ctx.db.prepare(
      `INSERT INTO coach_plans (user_id, profile, plan, created_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET profile = excluded.profile, plan = excluded.plan, created_at = excluded.created_at`,
    ),
    load: ctx.db.prepare('SELECT profile, plan FROM coach_plans WHERE user_id = ?'),
  };

  const complete =
    ctx.complete ??
    (async (body: Record<string, unknown>) => {
      if (!ctx.apiKey) ctx.fail(503, 'ИИ-тренер сейчас не настроен');
      const r = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${ctx.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      }).catch(() => ctx.fail(504, 'ИИ-тренер не ответил — попробуй ещё раз'));
      const data = (await r.json().catch(() => null)) as {
        choices?: { message?: { content?: string | null; refusal?: string | null } }[];
        error?: { message?: string };
      } | null;
      if (!r.ok) {
        console.error('openai', r.status, data?.error?.message);
        ctx.fail(502, 'ИИ-тренер сейчас недоступен — попробуй через минуту');
      }
      const msg = data?.choices?.[0]?.message;
      if (msg?.refusal) ctx.fail(422, 'ИИ-тренер не смог составить план по этой анкете');
      try {
        return JSON.parse(msg?.content ?? '') as unknown;
      } catch {
        return ctx.fail(502, 'ИИ-тренер ответил непонятно — попробуй ещё раз');
      }
    });

  return {
    'POST /api/coach/plan': async (req) => {
      const u = ctx.currentUser(req);
      const allowedNow = u ? userLimit.allow(`u${u.id}`) : guestLimit.allow(ctx.ip(req));
      if (!allowedNow) ctx.fail(429, 'Слишком много планов подряд — подожди пару минут');
      const b = await ctx.readJson(req);
      const bad = checkProfile(b.profile);
      if (bad) ctx.fail(400, bad);
      const profile = b.profile as CoachProfile;
      const hard = hardExclusions(profile.limits);
      const allowed = COACH_EXERCISES.filter((e) => !hard.has(e));
      if (!allowed.length)
        ctx.fail(422, 'С такими ограничениями в каталоге не осталось безопасных упражнений');

      const raw = await complete({
        model,
        reasoning_effort: 'low',
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: userPrompt(profile, allowed, hard) },
        ],
        response_format: {
          type: 'json_schema',
          json_schema: { name: 'workout_plan', strict: true, schema: planSchema(allowed) },
        },
      });
      const plan: CoachPlan = normalizePlan(raw, profile, hard, { now: ctx.now(), model });
      if (!plan.sessions.length) ctx.fail(502, 'ИИ-тренер не собрал ни одной тренировки — попробуй ещё раз');
      if (u) q.save.run(u.id, JSON.stringify(profile), JSON.stringify(plan), ctx.now());
      return { plan, saved: !!u };
    },

    'GET /api/coach/plan': (req) => {
      const u = ctx.currentUser(req);
      if (!u) return { plan: null, profile: null };
      const row = q.load.get(u.id) as { profile: string; plan: string } | undefined;
      return row
        ? { plan: JSON.parse(row.plan) as CoachPlan, profile: JSON.parse(row.profile) as CoachProfile }
        : { plan: null, profile: null };
    },
  };
}
