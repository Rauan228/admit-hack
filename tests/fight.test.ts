import {
  FIGHT_BOTS,
  FIGHT_RULES,
  FightMatch,
  findFightBot,
  type BotState,
  type FightBot,
  type FightEvent,
} from '../src/fight/fight';

/** Бот без защиты, который никогда не бьёт: удобно проверять свой урон. */
const dummy: FightBot = {
  ...FIGHT_BOTS[0]!,
  name: 'Груша',
  attacksPerMin: 0,
  guardBlock: 0,
  shellChance: 0,
  openChance: 0,
  followUp: 0,
};
/** Бот, который блокирует всё в голову. */
const wall: FightBot = { ...dummy, name: 'Стена', guardBlock: 1 };
/** Бот, который только бьёт джебами. */
const jabber: FightBot = { ...dummy, name: 'Джебер', attacksPerMin: 20, powerShare: 0 };
/** Бот, который только бьёт мощными. */
const slugger: FightBot = { ...dummy, name: 'Панчер', attacksPerMin: 20, powerShare: 1 };

const PREP = FIGHT_RULES.prepMs;
const INTRO = FIGHT_RULES.introMs;
/** Начало первого раунда. */
const FIGHT = PREP + INTRO;

const types = (events: FightEvent[]) => events.map((e) => e.type);

/** Прогнать бой шагами по 10 мс до условия; вернуть время и события. */
function runUntil(m: FightMatch, from: number, stop: (e: FightEvent, t: number) => boolean, to = 200_000) {
  const all: FightEvent[] = [];
  for (let t = from; t < to; t += 10) {
    for (const e of m.tick(t)) {
      all.push(e);
      if (stop(e, t)) return { t, e, all };
    }
  }
  throw new Error('не дождались');
}

const stateIs = (s: BotState) => (e: FightEvent) => e.type === 'bot_state' && e.state === s;

describe('бокс с ботом: ход боя', () => {
  it('подготовка 5 с, потом «Раунд 1», потом бой; до боя удары не считаются', () => {
    const m = new FightMatch({ bot: dummy }, 0);
    expect(m.snapshot(0)).toMatchObject({ phase: 'prep', prepLeftMs: PREP, round: 0, hpMe: 100, hpBot: 100 });
    expect(m.punch(1000, true)).toBeNull();
    expect(m.snapshot(1000).prepLeftMs).toBe(PREP - 1000);
    expect(types(m.tick(PREP))).toEqual(['phase']);
    expect(m.snapshot(PREP)).toMatchObject({ phase: 'intro', round: 1, introLeftMs: INTRO });
    expect(m.punch(PREP + 500, true)).toBeNull();
    expect(types(m.tick(FIGHT))).toEqual(['phase', 'bot_state']);
    expect(m.snapshot(FIGHT)).toMatchObject({
      phase: 'fight',
      round: 1,
      timeLeftMs: FIGHT_RULES.roundMs,
      bot: { state: 'guard' },
    });
  });

  it('большой скачок времени проходит все фазы разом, события по порядку', () => {
    const m = new FightMatch({ bot: dummy }, 0);
    const ev = m.tick(FIGHT + 100);
    expect(ev.filter((e) => e.type === 'phase').map((e) => (e as { phase: string }).phase)).toEqual([
      'intro',
      'fight',
    ]);
  });

  it('удар бьёт бота: чистый — 5, с ошибкой — 3; серия даёт бонус до +3', () => {
    const m = new FightMatch({ bot: dummy }, 0);
    m.tick(FIGHT);
    expect(m.punch(FIGHT + 100, true)).toMatchObject({ damage: 5, blocked: false, kind: 'hit', combo: 1 });
    expect(m.punch(FIGHT + 600, false)).toMatchObject({ damage: 4, combo: 2 }); // 3 + 1
    expect(m.punch(FIGHT + 1100, true)).toMatchObject({ damage: 7, combo: 3 }); // 5 + 2
    expect(m.punch(FIGHT + 1600, true)).toMatchObject({ damage: 8, combo: 4 }); // 5 + 3
    expect(m.punch(FIGHT + 2100, true)).toMatchObject({ damage: 8, combo: 5 }); // бонус не растёт
    expect(m.snapshot(FIGHT + 2200)).toMatchObject({ hpBot: 100 - 32, combo: 5 });
    // Пауза дольше окна — серия обрывается.
    expect(m.punch(FIGHT + 2100 + FIGHT_RULES.comboWindowMs + 1, true)).toMatchObject({
      damage: 5,
      combo: 1,
    });
    expect(m.snapshot(FIGHT + 10_000).combo).toBe(0);
    expect(m.snapshot(FIGHT + 10_000).stats).toMatchObject({ punches: 6, landed: 6, bestCombo: 5 });
  });

  it('блок бота в стойке: в голову — урон 1, серия всё равно считается; в корпус чаще проходит', () => {
    const m = new FightMatch({ bot: wall, rules: { hp: 10_000 } }, 0);
    m.tick(FIGHT);
    expect(m.punch(FIGHT + 100, true)).toMatchObject({ damage: 1, blocked: true, kind: 'blocked', combo: 1 });
    expect(m.punch(FIGHT + 400, true)).toMatchObject({ damage: 1, blocked: true, combo: 2 });
    expect(m.snapshot(FIGHT + 500)).toMatchObject({ hpBot: 10_000 - 2 });
    expect(m.snapshot(FIGHT + 500).stats).toMatchObject({ blockedByBot: 2, landed: 0 });
    // В корпус блок срабатывает с вероятностью ×0,35 — у «стены» это 35 %.
    const body = Array.from({ length: 40 }, (_, i) => m.punch(FIGHT + 3000 + i * 1000, true, true)!.blocked);
    expect(body.filter(Boolean).length).toBeGreaterThan(4);
    expect(body.filter(Boolean).length).toBeLessThan(26);
  });

  it('блоки бота детерминированы зерном', () => {
    const run = (seed: number) => {
      const m = new FightMatch({ bot: { ...dummy, guardBlock: 0.5 }, seed }, 0);
      m.tick(FIGHT);
      return Array.from({ length: 12 }, (_, i) => m.punch(FIGHT + 100 + i * 2000, true)!.blocked);
    };
    expect(run(7)).toEqual(run(7));
    expect(run(7)).not.toEqual(run(8));
    expect(run(7)).toContain(true);
    expect(run(7)).toContain(false);
  });
});

describe('бокс с ботом: атаки бота', () => {
  it('джеб: замах → удар → касание; без защиты — урон джеба', () => {
    const m = new FightMatch({ bot: jabber, seed: 1 }, 0);
    const w = runUntil(m, 0, (e) => e.type === 'bot_windup');
    expect(w.e).toMatchObject({ kind: 'jab', side: 'left' });
    expect(m.snapshot(w.t)).toMatchObject({
      windup: true,
      bot: { state: 'windup', attack: { kind: 'jab' } },
    });
    const h = runUntil(m, w.t, (e) => e.type === 'bot_hit');
    expect(h.t - w.t).toBeGreaterThanOrEqual(jabber.jabWindupMs + FIGHT_RULES.jabStrikeMs - 10);
    expect(h.t - w.t).toBeLessThanOrEqual(jabber.jabWindupMs + FIGHT_RULES.jabStrikeMs + 20);
    expect(h.e).toMatchObject({ result: 'landed', damage: jabber.jabDamage, kind: 'jab', ko: false });
    expect(m.snapshot(h.t)).toMatchObject({ hpMe: 100 - jabber.jabDamage, windup: false });
    expect(m.snapshot(h.t).bot.state).toBe('recover');
  });

  it('мощный: долгий замах; без защиты — тяжёлый урон, в блоке — пробивает на 4', () => {
    const open = new FightMatch({ bot: slugger, seed: 1 }, 0);
    const w = runUntil(open, 0, (e) => e.type === 'bot_windup');
    expect(w.e).toMatchObject({ kind: 'power' });
    const h = runUntil(open, w.t, (e) => e.type === 'bot_hit');
    expect(h.t - w.t).toBeGreaterThanOrEqual(slugger.powerWindupMs);
    expect(h.e).toMatchObject({ result: 'landed', damage: slugger.powerDamage, kind: 'power' });

    const guarded = new FightMatch({ bot: slugger, seed: 1 }, 0);
    guarded.setGuard(0, true);
    expect(runUntil(guarded, 0, (e) => e.type === 'bot_hit').e).toMatchObject({
      result: 'blocked',
      damage: FIGHT_RULES.powerGuardChip,
    });
  });

  it('кулаки у подбородка в момент касания — блок джеба, урон 1', () => {
    const m = new FightMatch({ bot: jabber, seed: 1 }, 0);
    m.setGuard(0, true);
    const h = runUntil(m, 0, (e) => e.type === 'bot_hit');
    expect(h.e).toMatchObject({ result: 'blocked', damage: FIGHT_RULES.guardChip });
    expect(m.snapshot(h.t).stats.blocked).toBe(1);
  });

  it('защиту сняли за миг до касания — ещё блок (запас на дрожание), сняли раньше — пропущенный удар', () => {
    const hitAt = runUntil(new FightMatch({ bot: jabber, seed: 1 }, 0), 0, (e) => e.type === 'bot_hit').t;
    const probe = (gapMs: number) => {
      const m = new FightMatch({ bot: jabber, seed: 1 }, 0);
      m.setGuard(0, true);
      m.setGuard(hitAt - gapMs, false);
      return runUntil(m, 0, (e) => e.type === 'bot_hit').e;
    };
    expect(probe(FIGHT_RULES.guardGraceMs - 50)).toMatchObject({ result: 'blocked' });
    expect(probe(FIGHT_RULES.guardGraceMs + 100)).toMatchObject({ result: 'landed' });
  });

  it('уклон перед касанием — ноль урона, бот провалился (раскрыт дольше); уклон давно — не считается', () => {
    const hitAt = runUntil(new FightMatch({ bot: jabber, seed: 1 }, 0), 0, (e) => e.type === 'bot_hit').t;
    const probe = (gapMs: number) => {
      const m = new FightMatch({ bot: jabber, seed: 1 }, 0);
      for (let t = 0; t <= hitAt; t += 10) {
        if (t === hitAt - gapMs) m.dodge(t);
        const hit = m.tick(t).find((e) => e.type === 'bot_hit');
        if (hit) return { hit, bot: m.snapshot(t).bot };
      }
      throw new Error('нет удара');
    };
    const dodged = probe(300);
    expect(dodged.hit).toMatchObject({ result: 'dodged', damage: 0 });
    expect(dodged.bot.until - dodged.bot.since).toBe(FIGHT_RULES.jabRecoverMs + FIGHT_RULES.whiffExtraMs);
    expect(probe(FIGHT_RULES.dodgeWindowMs + 200).hit).toMatchObject({ result: 'landed' });
  });

  it('удар на замахе — «поймал»: двойной урон, удар бота сорван, он потрясён', () => {
    const m = new FightMatch({ bot: slugger, seed: 1 }, 0);
    const w = runUntil(m, 0, (e) => e.type === 'bot_windup');
    const r = m.punch(w.t + 200, true);
    expect(r).toMatchObject({ kind: 'interrupt', damage: 10, blocked: false });
    expect(m.snapshot(w.t + 200).bot.state).toBe('stagger');
    // Удара не будет до конца «потрясён».
    const ev: FightEvent[] = [];
    for (let t = w.t + 200; t < w.t + 200 + FIGHT_RULES.staggerMs - 10; t += 10) ev.push(...m.tick(t));
    expect(ev.some((e) => e.type === 'bot_hit')).toBe(false);
    expect(m.snapshot(w.t + 300).stats.counters).toBe(1);
  });

  it('после удара бот раскрыт — контратака ×1,5; после твоего блока или уклона — тоже', () => {
    const m = new FightMatch({ bot: jabber, seed: 1 }, 0);
    const h = runUntil(m, 0, (e) => e.type === 'bot_hit');
    expect(m.punch(h.t + 50, true)).toMatchObject({ kind: 'counter', damage: 8 }); // round(5 × 1,5)

    const g = new FightMatch({ bot: { ...jabber, guardBlock: 1 }, seed: 1 }, 0);
    g.setGuard(0, true);
    const gh = runUntil(g, 0, (e) => e.type === 'bot_hit');
    // Ждём, пока бот вернётся в стойку: в стойке он блокирует всё, но контратака после блока проходит.
    const back = runUntil(g, gh.t, stateIs('guard'));
    if (back.t - gh.t < FIGHT_RULES.counterWindowMs) {
      expect(g.punch(back.t + 10, true)).toMatchObject({ kind: 'counter', blocked: false });
    }
  });

  it('серия попаданий — бот закрывается: голова закрыта, корпус открыт', () => {
    const m = new FightMatch({ bot: { ...dummy, shellChance: 1 }, seed: 1 }, 0);
    m.tick(FIGHT);
    for (let i = 0; i < FIGHT_RULES.shellAfterHits; i++) m.punch(FIGHT + 100 + i * 200, true);
    const t = FIGHT + 100 + FIGHT_RULES.shellAfterHits * 200;
    m.tick(t);
    expect(m.snapshot(t).bot.state).toBe('shell');
    expect(m.punch(t + 10, true)).toMatchObject({ kind: 'blocked', damage: 1 });
    expect(m.punch(t + 20, true, true)).toMatchObject({ kind: 'body', blocked: false });
  });

  it('опустил руки — удар проходит с бонусом', () => {
    const m = new FightMatch({ bot: { ...jabber, openChance: 2, guardBlock: 1 }, seed: 4 }, 0);
    const o = runUntil(m, 0, stateIs('open'));
    expect(m.punch(o.t + 10, true)).toMatchObject({ kind: 'open', damage: 5 + FIGHT_RULES.openBonus });
  });

  it('бот бьёт примерно в своём темпе, все удары — внутри раунда', () => {
    for (const bot of FIGHT_BOTS) {
      const m = new FightMatch({ bot, seed: 3 }, 0);
      m.setGuard(0, true);
      let hits = 0;
      let last = 0;
      for (let t = 0; t < FIGHT + FIGHT_RULES.roundMs + 100; t += 10) {
        for (const e of m.tick(t)) {
          if (e.type === 'bot_hit') {
            hits += 1;
            last = t;
          }
        }
      }
      const expected = (bot.attacksPerMin * FIGHT_RULES.roundMs) / 60_000;
      expect(hits).toBeGreaterThanOrEqual(expected * 0.6);
      expect(hits).toBeLessThanOrEqual(expected * 1.5);
      expect(last).toBeLessThanOrEqual(FIGHT + FIGHT_RULES.roundMs);
    }
  });
});

describe('бокс с ботом: раунды и итог', () => {
  /** Нокаутировать бота серией чистых ударов (без блока, темп 0,3 с). */
  function knockOut(m: FightMatch, from: number): number {
    let t = from;
    for (;;) {
      const r = m.punch(t, true);
      if (r?.ko) return t;
      t += 300;
    }
  }

  it('нокаут бота: раунд за тобой, пауза, затем «Раунд 2» с полным здоровьем', () => {
    const m = new FightMatch({ bot: dummy }, 0);
    m.tick(FIGHT);
    const koAt = knockOut(m, FIGHT + 100);
    const ev = m.tick(koAt);
    expect(ev.find((e) => e.type === 'round_end')).toMatchObject({ winner: 'me', why: 'ko', round: 1 });
    expect(m.snapshot(koAt)).toMatchObject({ phase: 'round_over', winsMe: 1, winsBot: 0, hpBot: 0 });
    expect(m.punch(koAt + 100, true)).toBeNull();
    const t2 = koAt + FIGHT_RULES.roundOverMs;
    expect(types(m.tick(t2))).toEqual(['phase']);
    expect(m.snapshot(t2)).toMatchObject({ phase: 'intro', round: 2, hpMe: 100, hpBot: 100 });
  });

  it('два раунда подряд — победа', () => {
    const m = new FightMatch({ bot: dummy }, 0);
    m.tick(FIGHT);
    const ko1 = knockOut(m, FIGHT + 100);
    const fight2 = ko1 + FIGHT_RULES.roundOverMs + INTRO;
    m.tick(fight2);
    const ko2 = knockOut(m, fight2 + 100);
    const ev = m.tick(ko2 + FIGHT_RULES.roundOverMs);
    expect(types(ev)).toEqual(['round_end', 'phase', 'phase', 'over']);
    expect(m.snapshot(ko2 + FIGHT_RULES.roundOverMs)).toMatchObject({
      phase: 'over',
      outcome: 'win',
      winsMe: 2,
      winsBot: 0,
    });
  });

  it('время вышло: раунд тому, у кого больше здоровья', () => {
    const m = new FightMatch({ bot: jabber, seed: 1 }, 0);
    m.setGuard(0, true); // бот снимает по 1
    m.tick(FIGHT);
    m.punch(FIGHT + 100, true); // ты снял 5
    const end = FIGHT + FIGHT_RULES.roundMs;
    const ev: FightEvent[] = [];
    for (let t = FIGHT; t <= end + 10; t += 50) ev.push(...m.tick(t));
    const re = ev.find((e) => e.type === 'round_end');
    const s = m.snapshot(end + 10);
    expect(re).toMatchObject({ why: 'time', round: 1 });
    expect(s.phase).toBe('round_over');
    expect(s.timeLeftMs).toBe(0);
    const expected = s.hpMe > s.hpBot ? 'me' : s.hpBot > s.hpMe ? 'bot' : null;
    expect((re as Extract<FightEvent, { type: 'round_end' }>).winner).toBe(expected);
  });

  it('бот забивает: нокаут тебя, второй — поражение', () => {
    const hard: FightBot = { ...slugger, attacksPerMin: 60, powerDamage: 50 };
    const m = new FightMatch({ bot: hard, seed: 2 }, 0);
    let s = m.snapshot(0);
    for (let t = 0; t < 200_000 && s.phase !== 'over'; t += 20) {
      m.tick(t);
      s = m.snapshot(t);
    }
    expect(s).toMatchObject({ phase: 'over', outcome: 'lose', winsBot: 2, winsMe: 0 });
  });

  it('«Сдаться» — сразу поражение', () => {
    const m = new FightMatch({ bot: dummy }, 0);
    m.giveUp(FIGHT + 3000);
    expect(m.snapshot(FIGHT + 3000)).toMatchObject({ phase: 'over', outcome: 'lose', gaveUp: true });
    expect(m.punch(FIGHT + 3100, true)).toBeNull();
  });

  it('боты от слабого к сильному; неизвестный id — средний', () => {
    for (const key of ['attacksPerMin', 'guardBlock', 'powerDamage'] as const) {
      const v = FIGHT_BOTS.map((b) => b[key]);
      expect(v).toEqual([...v].sort((a, b) => a - b));
    }
    const windup = FIGHT_BOTS.map((b) => b.powerWindupMs);
    expect(windup).toEqual([...windup].sort((a, b) => b - a));
    expect(findFightBot('machine').level).toBe(3);
    expect(findFightBot('нет').id).toBe('athlete');
  });
});
