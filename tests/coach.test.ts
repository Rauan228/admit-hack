// ИИ-конструктор плана: жёсткие ограничения, проверка ответа модели и маршрут API с подменённой моделью.

import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../server/app.ts';
import { openDb } from '../server/db.ts';
import {
  COACH_CATALOG,
  COACH_EXERCISES,
  checkProfile,
  hardExclusions,
  normalizePlan,
  planSchema,
  type CoachProfile,
} from '../src/shared/coach.ts';
import { RATED_EXERCISES } from '../src/shared/rating.ts';

const PROFILE: CoachProfile = {
  goal: 'lose_weight',
  sex: 'male',
  age: 34,
  heightCm: 178,
  weightKg: 96,
  level: 'beginner',
  daysPerWeek: 3,
  minutesPerSession: 20,
  limits: [],
  notes: '',
};

describe('каталог и ограничения', () => {
  it('в каталоге все упражнения платформы', () => {
    expect([...COACH_EXERCISES].sort()).toEqual([...RATED_EXERCISES].sort());
    for (const e of COACH_EXERCISES) expect(COACH_CATALOG[e].min).toBeLessThan(COACH_CATALOG[e].max);
  });

  it('«нельзя прыгать» убирает все прыжки, «одна рука» — отжимания и планку', () => {
    const jumps = hardExclusions(['no_jumps']);
    for (const e of ['jumping_jack', 'cross_jack', 'high_knees', 'jump_squat', 'burpee'] as const)
      expect(jumps.has(e)).toBe(true);
    expect(jumps.has('squat')).toBe(false);
    const arm = hardExclusions(['one_arm']);
    expect(arm.has('push_up')).toBe(true);
    expect(arm.has('plank')).toBe(true);
    expect(arm.has('calf_raise')).toBe(false);
  });

  it('проверяет анкету', () => {
    expect(checkProfile(PROFILE)).toBeNull();
    expect(checkProfile({ ...PROFILE, age: 5 })).toMatch(/Возраст/);
    expect(checkProfile({ ...PROFILE, limits: ['wings'] })).toMatch(/ограничение/);
    expect(checkProfile(null)).not.toBeNull();
  });

  it('схема разрешает только доступные упражнения', () => {
    const allowed = COACH_EXERCISES.filter((e) => !hardExclusions(['knees']).has(e));
    const s = planSchema(allowed) as {
      properties: {
        sessions: {
          items: { properties: { items: { items: { properties: { exercise: { enum: string[] } } } } } };
        };
      };
    };
    expect(s.properties.sessions.items.properties.items.items.properties.exercise.enum).not.toContain(
      'squat',
    );
  });
});

describe('ответ модели не принимаем на слово', () => {
  it('выкидывает запрещённые, неизвестные и повторы, зажимает цели и лишние дни', () => {
    const hard = hardExclusions(['no_jumps']);
    const plan = normalizePlan(
      {
        title: 'План',
        summary: 'ok',
        insights: ['a'],
        warnings: [],
        excluded: [{ exercise: 'side_bend', reason: 'грыжа' }],
        sessions: [
          {
            day: 'Пн',
            title: 'A',
            focus: 'ноги',
            items: [
              { exercise: 'burpee', sets: 3, target: 10, restSec: 30, note: '' }, // запрещено галочкой
              { exercise: 'side_bend', sets: 3, target: 10, restSec: 30, note: '' }, // модель сама убрала
              { exercise: 'flying', sets: 3, target: 10, restSec: 30, note: '' }, // нет в каталоге
              { exercise: 'squat', sets: 9, target: 500, restSec: 1, note: 'x' },
              { exercise: 'squat', sets: 2, target: 10, restSec: 30, note: 'повтор' },
            ],
          },
          {
            day: 'Ср',
            title: 'B',
            focus: '',
            items: [{ exercise: 'plank', sets: 2, target: 30, restSec: 30, note: '' }],
          },
          { day: 'Пт', title: 'C', focus: '', items: [] },
          {
            day: 'Сб',
            title: 'D',
            focus: '',
            items: [{ exercise: 'calf_raise', sets: 2, target: 12, restSec: 30, note: '' }],
          },
        ],
        progression: '',
        tips: [],
      },
      { daysPerWeek: 3 },
      hard,
      { now: 1, model: 'test' },
    );
    expect(plan.sessions.map((s) => s.day)).toEqual(['Пн', 'Ср']);
    expect(plan.sessions[0]!.items).toEqual([
      { exercise: 'squat', sets: 5, target: COACH_CATALOG.squat.max, restSec: 15, note: 'x' },
    ]);
    expect(plan.sessions[0]!.minutes).toBeGreaterThan(0);
    const excluded = plan.excluded.map((e) => e.exercise);
    expect(excluded).toContain('burpee');
    expect(excluded).toContain('side_bend');
  });
});

describe('API /api/coach/plan', () => {
  let server: Server;
  let base = '';
  let lastBody: Record<string, unknown> | null = null;

  beforeEach(async () => {
    lastBody = null;
    const handle = createApp(openDb(':memory:'), {
      coach: {
        complete: async (body) => {
          lastBody = body;
          return {
            title: 'Мягкий старт',
            summary: 's',
            insights: [],
            warnings: [],
            excluded: [],
            sessions: [
              {
                day: 'Пн',
                title: 'Ноги',
                focus: 'ноги',
                items: [{ exercise: 'squat', sets: 3, target: 10, restSec: 45, note: '' }],
              },
            ],
            progression: '',
            tips: [],
          };
        },
      },
    });
    server = createServer((req, res) => void handle(req, res));
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterEach(() => new Promise<void>((r) => server.close(() => r())));

  const post = (profile: unknown, cookie = '') =>
    fetch(`${base}/api/coach/plan`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
      body: JSON.stringify({ profile }),
    });

  it('гость получает план, ограничения уходят в промпт и в схему', async () => {
    const r = await post({ ...PROFILE, limits: ['one_arm'], notes: 'нет левой руки' });
    expect(r.status).toBe(200);
    const data = (await r.json()) as {
      plan: { sessions: unknown[]; excluded: { exercise: string }[] };
      saved: boolean;
    };
    expect(data.saved).toBe(false);
    expect(data.plan.sessions).toHaveLength(1);
    expect(data.plan.excluded.map((e) => e.exercise)).toContain('push_up');
    const prompt = JSON.stringify(lastBody);
    expect(prompt).toContain('нет левой руки');
    expect(prompt).not.toContain('"push_up"],"type"'); // push_up нет в enum схемы
  });

  it('плохая анкета — 400, модель не зовём', async () => {
    const r = await post({ ...PROFILE, heightCm: 20 });
    expect(r.status).toBe(400);
    expect(lastBody).toBeNull();
  });

  it('вошедшему план сохраняется и отдаётся по GET', async () => {
    const reg = await fetch(`${base}/api/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'c@x.io', password: 'password1', nick: 'coachy' }),
    });
    const cookie = reg.headers.get('set-cookie')!.split(';')[0]!;
    expect(((await (await post(PROFILE, cookie)).json()) as { saved: boolean }).saved).toBe(true);
    const got = (await (await fetch(`${base}/api/coach/plan`, { headers: { cookie } })).json()) as {
      plan: { title: string };
      profile: CoachProfile;
    };
    expect(got.plan.title).toBe('Мягкий старт');
    expect(got.profile.weightKg).toBe(96);
  });
});

describe('ИИ-тренер: потолок на сервер', () => {
  it('сверх дневного потолка — 429, модель не зовём', async () => {
    let calls = 0;
    const handle = createApp(openDb(':memory:'), {
      coach: {
        dailyMax: 2,
        complete: async () => {
          calls += 1;
          return {
            title: 'П',
            summary: '',
            insights: [],
            warnings: [],
            excluded: [],
            sessions: [
              {
                day: 'Пн',
                title: 'Н',
                focus: '',
                items: [{ exercise: 'squat', sets: 2, target: 10, restSec: 30, note: '' }],
              },
            ],
            progression: '',
            tips: [],
          };
        },
      },
    });
    const srv = createServer((req, res) => void handle(req, res));
    await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
    const url = `http://127.0.0.1:${(srv.address() as AddressInfo).port}/api/coach/plan`;
    const codes: number[] = [];
    // Разные «IP» через X-Real-IP: лимит по адресу не мешает, срабатывает именно общий потолок.
    for (const ip of ['1.1.1.1', '2.2.2.2', '3.3.3.3']) {
      const r = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-real-ip': ip },
        body: JSON.stringify({ profile: PROFILE }),
      });
      codes.push(r.status);
    }
    await new Promise<void>((r) => srv.close(() => r()));
    expect(codes).toEqual([200, 200, 429]);
    expect(calls).toBe(2);
  });
});
