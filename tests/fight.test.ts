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
  dodgeChance: 0,
  counterChance: 0,
  feintChance: 0,
  smart: 0,
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
/** Здоровье в начале боя. */
const HP = FIGHT_RULES.hp;

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
    expect(m.snapshot(0)).toMatchObject({ phase: 'prep', prepLeftMs: PREP, round: 0, hpMe: HP, hpBot: HP });
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
    expect(m.snapshot(FIGHT + 2200)).toMatchObject({ hpBot: HP - 32, combo: 5 });
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
    expect(m.snapshot(h.t)).toMatchObject({ hpMe: HP - jabber.jabDamage, windup: false });
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
  /** Бить чистыми каждые 0,3 с, пока бот не упадёт; вернуть момент нокдауна (бой идёт дальше). */
  function floorBot(m: FightMatch, from: number): number {
    for (let t = from; t < from + 120_000; t += 300) {
      const r = m.punch(t, true);
      if (r?.knockdown) return t;
    }
    throw new Error('бот не упал');
  }
  /** Ронять бота, пока не нокаут; вернуть момент нокаута. */
  function knockOut(m: FightMatch, from: number): number {
    for (let t = from; t < from + 200_000; t += 300) {
      const r = m.punch(t, true);
      if (r?.ko) return t;
      m.tick(t);
      if (m.snapshot(t).phase !== 'fight' && m.snapshot(t).phase !== 'intro') {
        if (m.snapshot(t).phase === 'over') break;
      }
    }
    throw new Error('нет нокаута');
  }
  const kdEvents = (ev: FightEvent[]) =>
    ev.filter((e) => e.type === 'knockdown' || e.type === 'count' || e.type === 'getup');

  it('здоровье кончилось — нокдаун, а не конец раунда: бот на настиле, лежачего не бьют', () => {
    const m = new FightMatch({ bot: dummy }, 0);
    m.tick(FIGHT);
    const kd = floorBot(m, FIGHT + 100);
    const ev = m.tick(kd);
    expect(ev.find((e) => e.type === 'knockdown')).toMatchObject({ who: 'bot', count: 1 });
    expect(ev.some((e) => e.type === 'round_end')).toBe(false);
    const s = m.snapshot(kd);
    expect(s).toMatchObject({
      phase: 'fight',
      hpBot: 0,
      kdBot: 1,
      bot: { state: 'down' },
      down: { who: 'bot' },
    });
    expect(s.maxHpBot).toBe(Math.round(HP * (1 - FIGHT_RULES.kdMaxLoss)));
    expect(s.stats.kdScored).toBe(1);
    expect(m.punch(kd + 200, true)).toBeNull();
  });

  it('рефери считает раз в kdCountMs, бот встаёт на 3–6 с частью здоровья от нового максимума', () => {
    const m = new FightMatch({ bot: dummy }, 0);
    m.tick(FIGHT);
    const kd = floorBot(m, FIGHT + 100);
    const ev: FightEvent[] = [];
    let up = 0;
    for (let t = kd; t < kd + 15_000 && !up; t += 50) {
      for (const e of m.tick(t)) {
        ev.push(e);
        if (e.type === 'getup') up = t;
      }
    }
    expect(up).toBeGreaterThan(0);
    const counts = ev.filter((e) => e.type === 'count').map((e) => (e as { n: number }).n);
    expect(counts[0]).toBe(1);
    expect(counts).toEqual(counts.map((_, i) => i + 1));
    expect(counts.length).toBeGreaterThanOrEqual(FIGHT_RULES.botGetUp1[0]);
    expect(counts.length).toBeLessThanOrEqual(FIGHT_RULES.botGetUp1[1] + 1);
    const s = m.snapshot(up);
    expect(s.hpBot).toBe(Math.round(s.maxHpBot * FIGHT_RULES.kdGetUpHp));
    expect(s.bot.state).toBe('getup');
    expect(s.down).toBeNull();
    // Пока встаёт — тоже не бьют; встал — бой дальше.
    expect(m.punch(up + 100, true)).toBeNull();
    expect(m.punch(up + FIGHT_RULES.getUpMs + 100, true)).toMatchObject({ kind: 'hit' });
  });

  it('третий нокдаун в раунде — нокаут: бой окончен победой сразу, бот так и лежит', () => {
    const m = new FightMatch({ bot: dummy }, 0);
    m.tick(FIGHT);
    const ko = knockOut(m, FIGHT + 100);
    const ev = m.tick(ko);
    expect(ev.find((e) => e.type === 'round_end')).toMatchObject({ winner: 'me', why: 'ko', round: 1 });
    expect(m.snapshot(ko)).toMatchObject({ phase: 'round_over', koWinner: 'me', kdBot: FIGHT_RULES.kdLimit });
    expect(m.snapshot(ko).bot.state).toBe('down');
    const end = m.tick(ko + FIGHT_RULES.roundOverMs);
    expect(types(end)).toEqual(['phase', 'over']);
    expect(m.snapshot(ko + FIGHT_RULES.roundOverMs)).toMatchObject({
      phase: 'over',
      outcome: 'win',
      round: 1,
    });
    expect(m.snapshot(ko + FIGHT_RULES.roundOverMs).bot.state).toBe('down');
  });

  it('ты на настиле: встать — обе руки вверх, но не раньше счёта meMinCount; встал — бот ждёт', () => {
    const hard: FightBot = { ...slugger, attacksPerMin: 60, powerDamage: 200 };
    const m = new FightMatch({ bot: hard, seed: 2 }, 0);
    const kd = runUntil(m, 0, (e) => e.type === 'knockdown');
    expect(kd.e).toMatchObject({ who: 'me', count: 1 });
    expect(m.snapshot(kd.t)).toMatchObject({ hpMe: 0, kdMe: 1, down: { who: 'me', canGetUp: false } });
    expect(m.getUp(kd.t + 100)).toBe(false);
    const ready = runUntil(m, kd.t, (e) => e.type === 'count' && e.n === FIGHT_RULES.meMinCount);
    expect(m.snapshot(ready.t).down).toMatchObject({ canGetUp: true });
    expect(m.getUp(ready.t + 10)).toBe(true);
    const s = m.snapshot(ready.t + 10);
    expect(s.down).toBeNull();
    expect(s.hpMe).toBe(Math.round(s.maxHpMe * FIGHT_RULES.kdGetUpHp));
    expect(s.stats.kdTaken).toBe(1);
    // Бот не бьёт сразу: даёт встать.
    const ev: FightEvent[] = [];
    for (let t = ready.t + 10; t < ready.t + FIGHT_RULES.resumeMs - 10; t += 10) ev.push(...m.tick(t));
    expect(ev.some((e) => e.type === 'bot_hit')).toBe(false);
    expect(ev.find((e) => e.type === 'getup')).toMatchObject({ who: 'me' });
  });

  it('не встал до 10 — нокаут, поражение', () => {
    const hard: FightBot = { ...slugger, attacksPerMin: 60, powerDamage: 200 };
    const m = new FightMatch({ bot: hard, seed: 2 }, 0);
    let s = m.snapshot(0);
    const ev: FightEvent[] = [];
    for (let t = 0; t < 200_000 && s.phase !== 'over'; t += 20) {
      ev.push(...m.tick(t));
      s = m.snapshot(t);
    }
    expect(s).toMatchObject({ phase: 'over', outcome: 'lose', koWinner: 'bot', round: 1 });
    const counts = ev.filter((e) => e.type === 'count').map((e) => (e as { n: number }).n);
    expect(Math.max(...counts)).toBe(FIGHT_RULES.kdCountTo);
    expect(ev.find((e) => e.type === 'round_end')).toMatchObject({ winner: 'bot', why: 'ko' });
  });

  it('время вышло — раунд по очкам: урон плюс нокдауны; лежавшего в гонг поднимают', () => {
    const m = new FightMatch({ bot: jabber, seed: 1 }, 0);
    m.setGuard(0, true); // бот снимает по 1
    m.tick(FIGHT);
    for (let i = 0; i < 10; i++) m.punch(FIGHT + 100 + i * 1500, true); // ты — по 5
    const end = FIGHT + FIGHT_RULES.roundMs;
    const ev: FightEvent[] = [];
    for (let t = FIGHT; t <= end + 10; t += 50) ev.push(...m.tick(t));
    const re = ev.find((e) => e.type === 'round_end');
    expect(re).toMatchObject({ why: 'time', round: 1, winner: 'me' });
    expect(m.snapshot(end + 10)).toMatchObject({ phase: 'round_over', timeLeftMs: 0, winsMe: 1 });

    // Нокдаун перевешивает урон: бота уронили — раунд твой, даже если он потом набил больше.
    const k = new FightMatch({ bot: dummy, rules: { hp: 30, roundMs: 20_000 } }, 0);
    k.tick(FIGHT);
    const kd = floorBot(k, FIGHT + 100);
    const after = runUntil(k, kd, (e) => e.type === 'round_end');
    expect(after.e).toMatchObject({ winner: 'me', why: 'time' });
  });

  it('между раундами здоровье восстанавливается наполовину от потерянного, до сниженного максимума', () => {
    const m = new FightMatch({ bot: dummy, rules: { roundMs: 30_000 } }, 0);
    m.tick(FIGHT);
    floorBot(m, FIGHT + 100);
    const over = runUntil(m, FIGHT + 100, (e) => e.type === 'round_end');
    const before = m.snapshot(over.t);
    const intro = runUntil(m, over.t, (e) => e.type === 'phase' && e.phase === 'intro');
    const s = m.snapshot(intro.t);
    expect(s.round).toBe(2);
    expect(s.hpBot).toBe(
      Math.round(before.hpBot + (before.maxHpBot - before.hpBot) * FIGHT_RULES.roundRecover),
    );
    expect(s.hpBot).toBeLessThan(HP);
    expect(s.hpMe).toBe(HP);
  });

  it('два раунда по очкам — победа', () => {
    const m = new FightMatch({ bot: dummy, rules: { roundMs: 5000 } }, 0);
    m.tick(FIGHT);
    m.punch(FIGHT + 100, true);
    const r1 = runUntil(m, FIGHT + 100, (e) => e.type === 'round_end');
    const f2 = runUntil(m, r1.t, (e) => e.type === 'phase' && e.phase === 'fight');
    m.punch(f2.t + 100, true);
    const ev = runUntil(m, f2.t + 100, (e) => e.type === 'over');
    expect(ev.e).toMatchObject({ outcome: 'win' });
    expect(m.snapshot(ev.t)).toMatchObject({ phase: 'over', winsMe: 2, winsBot: 0, koWinner: null });
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

  it('раунд стал длиннее, здоровья больше: средний бот за раунд не выбивает тебя в защите', () => {
    expect(FIGHT_RULES.roundMs).toBeGreaterThanOrEqual(60_000);
    expect(FIGHT_RULES.hp).toBeGreaterThanOrEqual(150);
    const m = new FightMatch({ bot: findFightBot('athlete'), seed: 5 }, 0);
    m.setGuard(0, true);
    const ev: FightEvent[] = [];
    for (let t = 0; t <= FIGHT + FIGHT_RULES.roundMs; t += 20) ev.push(...m.tick(t));
    expect(kdEvents(ev).length).toBe(0);
  });
});

describe('бокс с ботом: выносливость (U-27)', () => {
  it('удары тратят выносливость, отдых возвращает (в защите быстрее)', () => {
    const m = new FightMatch({ bot: dummy, rules: { hp: 10_000 } }, 0);
    m.tick(FIGHT);
    for (let i = 0; i < 5; i++) m.punch(FIGHT + 100 + i * 200, true);
    const tired = m.snapshot(FIGHT + 1000).staminaMe;
    expect(tired).toBeCloseTo(FIGHT_RULES.stamina - 5 * FIGHT_RULES.punchCost, 5);
    m.tick(FIGHT + 3000);
    const rested = m.snapshot(FIGHT + 3000).staminaMe;
    expect(rested).toBeGreaterThan(tired);

    const g = new FightMatch({ bot: dummy, rules: { hp: 10_000 } }, 0);
    g.tick(FIGHT);
    for (let i = 0; i < 5; i++) g.punch(FIGHT + 100 + i * 200, true);
    g.setGuard(FIGHT + 1000, true);
    g.tick(FIGHT + 3000);
    expect(g.snapshot(FIGHT + 3000).staminaMe).toBeGreaterThan(rested);
  });

  it('выдохся — удары слабее; мах руками урона не даёт, но силы тратит', () => {
    const m = new FightMatch({ bot: dummy, rules: { hp: 10_000 } }, 0);
    m.tick(FIGHT);
    const first = m.punch(FIGHT + 100, true)!;
    expect(first).toMatchObject({ damage: 5, tired: false });
    let last = first;
    for (let i = 1; i < 20; i++) last = m.punch(FIGHT + 100 + i * 2000 * 0 + i * 150, true)!;
    expect(m.snapshot(FIGHT + 3100).staminaMe).toBeLessThan(FIGHT_RULES.tiredBelow);
    expect(last.tired).toBe(true);
    // Серия +3, но усталость режет урон.
    expect(last.damage).toBeLessThan(5 + FIGHT_RULES.comboBonusMax);

    const s = new FightMatch({ bot: dummy }, 0);
    s.tick(FIGHT);
    s.swing(FIGHT + 100);
    expect(s.snapshot(FIGHT + 150)).toMatchObject({ hpBot: HP });
    expect(s.snapshot(FIGHT + 150).staminaMe).toBe(FIGHT_RULES.stamina - FIGHT_RULES.swingCost);
  });

  it('бот устаёт от своих ударов: замахи медленнее, руки опускает чаще', () => {
    const busy: FightBot = { ...slugger, attacksPerMin: 50 };
    const fresh = new FightMatch({ bot: busy, seed: 3 }, 0);
    const w1 = runUntil(fresh, 0, (e) => e.type === 'bot_windup');
    const s1 = fresh.snapshot(w1.t);
    const fast = s1.bot.until - s1.bot.since;
    expect(fast).toBe(busy.powerWindupMs);
    // Бот выдыхается: много мощных подряд, а ты в защите.
    const tired = new FightMatch({ bot: busy, seed: 3 }, 0);
    tired.setGuard(0, true);
    let slow = 0;
    for (let t = 0; t < FIGHT + 40_000 && !slow; t += 10) {
      for (const e of tired.tick(t)) {
        if (e.type !== 'bot_windup') continue;
        const s = tired.snapshot(t);
        if (s.staminaBot < 25) slow = s.bot.until - s.bot.since;
      }
    }
    expect(slow).toBeGreaterThan(fast);
    expect(tired.snapshot(FIGHT + 30_000).bot.fatigue).toBeGreaterThan(0);
  });

  it('удары в корпус выбивают у бота дыхание сильнее, чем в голову', () => {
    const run = (low: boolean) => {
      const m = new FightMatch({ bot: dummy, rules: { hp: 10_000 } }, 0);
      m.tick(FIGHT);
      for (let i = 0; i < 8; i++) m.punch(FIGHT + 100 + i * 250, true, low);
      return m.snapshot(FIGHT + 2100).staminaBot;
    };
    expect(run(true)).toBeLessThan(run(false));
    expect(run(false)).toBeLessThan(FIGHT_RULES.stamina);
  });
});

describe('бокс с ботом: бот читает и уходит (U-26)', () => {
  /** Бот, который всегда уходит от удара и не бьёт сам. */
  const slipper: FightBot = { ...dummy, name: 'Уклонист', dodgeChance: 1 };

  it('уходит от удара: начало удара — уклон, касание — мимо, урона нет, серия обрывается', () => {
    const m = new FightMatch({ bot: slipper, seed: 1 }, 0);
    m.tick(FIGHT);
    expect(m.punch(FIGHT + 100, true)).toMatchObject({ kind: 'hit', combo: 1 });
    m.incoming(FIGHT + 1500, 'left');
    const s = m.snapshot(FIGHT + 1520);
    expect(s.bot.state).toBe('dodge');
    expect(['slip_left', 'duck']).toContain(s.bot.dodge);
    expect(m.punch(FIGHT + 1610, true)).toMatchObject({ kind: 'miss', damage: 0, combo: 0 });
    expect(m.snapshot(FIGHT + 1620)).toMatchObject({ hpBot: HP - 5 });
    expect(m.snapshot(FIGHT + 1620).stats.missed).toBe(1);
  });

  it('удар в корпус — отходит назад; правая — уклон в другую сторону', () => {
    const body = new FightMatch({ bot: slipper, seed: 1 }, 0);
    body.tick(FIGHT);
    body.incoming(FIGHT + 100, 'left', true);
    expect(body.snapshot(FIGHT + 110).bot.dodge).toBe('back');
    const kinds = new Set<string>();
    for (let seed = 1; seed < 30; seed++) {
      const m = new FightMatch({ bot: slipper, seed }, 0);
      m.tick(FIGHT);
      m.incoming(FIGHT + 100, 'right');
      const d = m.snapshot(FIGHT + 110).bot.dodge;
      // Шанс уйти ограничен 85 % — иногда не уходит вовсе.
      if (d) kinds.add(d);
    }
    expect([...kinds].sort()).toEqual(['duck', 'slip_right']);
  });

  it('не уходит чаще раза в botDodgeCooldownMs и не уходит из замаха — замах ловится', () => {
    const m = new FightMatch({ bot: slipper, seed: 1 }, 0);
    m.tick(FIGHT);
    m.incoming(FIGHT + 100, 'left');
    m.tick(FIGHT + 700);
    m.incoming(FIGHT + 700, 'left');
    expect(m.snapshot(FIGHT + 710).bot.state).not.toBe('dodge');
    const sl = new FightMatch({ bot: { ...slugger, dodgeChance: 1 }, seed: 1 }, 0);
    const w = runUntil(sl, 0, stateIs('windup'));
    sl.incoming(w.t + 10, 'left');
    expect(sl.snapshot(w.t + 20).bot.state).toBe('windup');
    expect(sl.punch(w.t + 30, true)).toMatchObject({ kind: 'interrupt' });
  });

  it('после уклона сразу отвечает — замах короче обычного', () => {
    const m = new FightMatch(
      { bot: { ...jabber, dodgeChance: 1, counterChance: 1, attacksPerMin: 1 }, seed: 1 },
      0,
    );
    m.tick(FIGHT);
    m.incoming(FIGHT + 200, 'left');
    const w = runUntil(m, FIGHT + 200, stateIs('windup'));
    const e = w.e as Extract<FightEvent, { type: 'bot_state' }>;
    expect(w.t).toBeLessThanOrEqual(FIGHT + 200 + FIGHT_RULES.botDodgeMs + 20);
    expect(e.attack?.counter).toBe(true);
    expect(e.until - e.at).toBeLessThan(jabber.jabWindupMs);
  });

  it('финт: «!» загорелся, удара нет — пауза и настоящий удар', () => {
    const m = new FightMatch({ bot: { ...jabber, feintChance: 1 }, seed: 1 }, 0);
    const w = runUntil(m, 0, stateIs('windup'));
    expect((w.e as Extract<FightEvent, { type: 'bot_state' }>).attack?.feint).toBe(true);
    const next = runUntil(m, w.t, (e) => e.type === 'bot_state' && e.state !== 'windup');
    expect(next.e).toMatchObject({ state: 'guard' });
    expect(next.all.some((e) => e.type === 'bot_hit')).toBe(false);
    const real = runUntil(m, next.t, stateIs('windup'));
    expect((real.e as Extract<FightEvent, { type: 'bot_state' }>).attack?.feint).toBeFalsy();
    expect(runUntil(m, real.t, (e) => e.type === 'bot_hit').e).toMatchObject({ type: 'bot_hit' });
  });

  it('опустил руки — умный бот бьёт сразу, не дожидаясь своей паузы', () => {
    const lazy: FightBot = { ...jabber, attacksPerMin: 2, smart: 1, readMs: 300 };
    const first = (guardDown: boolean) => {
      const m = new FightMatch({ bot: lazy, seed: 5 }, 0);
      m.setGuard(0, true);
      m.tick(FIGHT);
      if (guardDown) m.setGuard(FIGHT + 1000, false);
      return runUntil(m, FIGHT, stateIs('windup')).t;
    };
    const down = first(true);
    expect(down).toBeGreaterThanOrEqual(FIGHT + 1300);
    expect(down).toBeLessThanOrEqual(FIGHT + 1350);
    expect(first(false)).toBeGreaterThan(down + 1000);
  });

  it('против глухой защиты умный бот чаще бьёт мощно', () => {
    const count = (guard: boolean) => {
      let power = 0;
      for (let seed = 1; seed <= 6; seed++) {
        const m = new FightMatch(
          { bot: { ...jabber, powerShare: 0.2, smart: 1, attacksPerMin: 40 }, seed },
          0,
        );
        for (let t = 0; t < FIGHT + 40_000; t += 20) {
          m.setGuard(t, guard);
          for (const e of m.tick(t)) if (e.type === 'bot_windup' && e.kind === 'power') power += 1;
        }
      }
      return power;
    };
    expect(count(true)).toBeGreaterThan(count(false) * 1.4);
  });

  it('ходит по рингу: кружит, сближается, отходит — направление меняется', () => {
    const m = new FightMatch({ bot: FIGHT_BOTS[1]!, seed: 2 }, 0);
    m.setGuard(0, true);
    const moves = new Set<string>();
    for (let t = FIGHT; t < FIGHT + 20_000; t += 100) {
      m.tick(t);
      moves.add(String(m.snapshot(t).bot.move));
    }
    expect(moves.has('circle_left')).toBe(true);
    expect(moves.has('circle_right')).toBe(true);
    expect(moves.size).toBeGreaterThanOrEqual(3);
  });
});
