import {
  FIGHT_BOTS,
  FIGHT_RULES,
  FightMatch,
  findFightBot,
  type FightBot,
  type FightEvent,
} from '../src/fight/fight';

/** Бот без защиты и с редкими атаками: удобно проверять свой урон. */
const dummy: FightBot = {
  id: 'novice',
  name: 'Груша',
  level: 1,
  attacksPerMin: 4,
  damage: 10,
  blockChance: 0,
};
/** Бот, который блокирует всё. */
const wall: FightBot = { ...dummy, name: 'Стена', blockChance: 1 };

const PREP = FIGHT_RULES.prepMs;
const INTRO = FIGHT_RULES.introMs;
/** Начало первого раунда. */
const FIGHT = PREP + INTRO;

const types = (events: FightEvent[]) => events.map((e) => e.type);

describe('бокс с ботом: ход боя', () => {
  it('подготовка 5 с, потом «Раунд 1», потом бой; до боя удары не считаются', () => {
    const m = new FightMatch({ bot: dummy }, 0);
    expect(m.snapshot(0)).toMatchObject({ phase: 'prep', prepLeftMs: PREP, round: 0, hpMe: 100, hpBot: 100 });
    expect(m.punch(1000, true)).toBeNull();
    expect(m.snapshot(1000).prepLeftMs).toBe(PREP - 1000);
    expect(types(m.tick(PREP))).toEqual(['phase']);
    expect(m.snapshot(PREP)).toMatchObject({ phase: 'intro', round: 1, introLeftMs: INTRO });
    expect(m.punch(PREP + 500, true)).toBeNull();
    expect(types(m.tick(FIGHT))).toEqual(['phase']);
    expect(m.snapshot(FIGHT)).toMatchObject({ phase: 'fight', round: 1, timeLeftMs: FIGHT_RULES.roundMs });
  });

  it('большой скачок времени проходит все фазы разом, события по порядку', () => {
    const m = new FightMatch({ bot: dummy }, 0);
    const ev = m.tick(FIGHT + 100);
    expect(ev.map((e) => (e.type === 'phase' ? e.phase : e.type))).toEqual(['intro', 'fight']);
  });

  it('удар бьёт бота: чистый — 5, с ошибкой — 3; серия даёт бонус до +3', () => {
    const m = new FightMatch({ bot: dummy }, 0);
    m.tick(FIGHT);
    expect(m.punch(FIGHT + 100, true)).toMatchObject({ damage: 5, blocked: false, combo: 1, ko: false });
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

  it('блок бота: урон 1, серия всё равно считается', () => {
    const m = new FightMatch({ bot: wall }, 0);
    m.tick(FIGHT);
    expect(m.punch(FIGHT + 100, true)).toMatchObject({ damage: 1, blocked: true, combo: 1 });
    expect(m.punch(FIGHT + 400, true)).toMatchObject({ damage: 1, blocked: true, combo: 2 });
    expect(m.snapshot(FIGHT + 500)).toMatchObject({ hpBot: 98 });
    expect(m.snapshot(FIGHT + 500).stats).toMatchObject({ blockedByBot: 2, landed: 0 });
  });

  it('вероятность блока детерминирована зерном', () => {
    const run = (seed: number) => {
      const m = new FightMatch({ bot: { ...dummy, blockChance: 0.5 }, seed }, 0);
      m.tick(FIGHT);
      return Array.from({ length: 12 }, (_, i) => m.punch(FIGHT + 100 + i * 400, true)!.blocked);
    };
    expect(run(7)).toEqual(run(7));
    expect(run(7)).not.toEqual(run(8));
    expect(run(7)).toContain(true);
    expect(run(7)).toContain(false);
  });
});

describe('бокс с ботом: атаки бота', () => {
  // Бот бьёт раз в секунду с нулевым разбросом усталости не получится — берём таймлайн как есть
  // и ищем первую атаку по событиям.
  function firstAttack(bot: FightBot, seed = 1) {
    const m = new FightMatch({ bot, seed }, 0);
    m.tick(FIGHT);
    // Шагаем по 10 мс и ловим замах и удар.
    let windupAt = -1;
    let hitAt = -1;
    let hit: Extract<FightEvent, { type: 'bot_hit' }> | null = null;
    for (let t = FIGHT; t < FIGHT + FIGHT_RULES.roundMs && hitAt < 0; t += 10) {
      for (const e of m.tick(t)) {
        if (e.type === 'bot_windup' && windupAt < 0) windupAt = t;
        if (e.type === 'bot_hit') {
          hitAt = t;
          hit = e;
        }
      }
    }
    return { m, windupAt, hitAt, hit: hit! };
  }

  it('замах за ~0,7 с до удара; без защиты — полный урон', () => {
    const { m, windupAt, hitAt, hit } = firstAttack(dummy);
    expect(windupAt).toBeGreaterThan(FIGHT);
    expect(hitAt - windupAt).toBeGreaterThanOrEqual(FIGHT_RULES.windupMs - 10);
    expect(hitAt - windupAt).toBeLessThanOrEqual(FIGHT_RULES.windupMs + 20);
    expect(hit).toMatchObject({ type: 'bot_hit', result: 'landed', damage: 10, ko: false });
    expect(m.snapshot(hitAt)).toMatchObject({ hpMe: 90, windup: false });
    expect(m.snapshot(windupAt).windup).toBe(false); // к моменту удара замах уже снят
  });

  it('кулаки у подбородка в момент удара — блок, урон 2', () => {
    const m = new FightMatch({ bot: dummy, seed: 1 }, 0);
    m.setGuard(0, true);
    let hit: FightEvent | undefined;
    for (let t = 0; t < FIGHT + FIGHT_RULES.roundMs && !hit; t += 10) {
      hit = m.tick(t).find((e) => e.type === 'bot_hit');
    }
    expect(hit).toMatchObject({ result: 'blocked', damage: FIGHT_RULES.guardChip });
    expect(m.snapshot(FIGHT + 20_000).stats.blocked).toBe(1);
  });

  it('защиту сняли за миг до удара — ещё блок (запас на дрожание), сняли раньше — пропущенный удар', () => {
    const probe = (gapMs: number) => {
      const m = new FightMatch({ bot: dummy, seed: 1 }, 0);
      // Узнаём момент удара пробным боем с тем же зерном.
      const { hitAt } = firstAttack(dummy, 1);
      m.setGuard(0, true);
      m.setGuard(hitAt - gapMs, false);
      let hit: FightEvent | undefined;
      for (let t = 0; t <= hitAt && !hit; t += 10) hit = m.tick(t).find((e) => e.type === 'bot_hit');
      return hit;
    };
    expect(probe(FIGHT_RULES.guardGraceMs - 50)).toMatchObject({ result: 'blocked' });
    expect(probe(FIGHT_RULES.guardGraceMs + 100)).toMatchObject({ result: 'landed' });
  });

  it('уклон перед ударом — ноль урона; уклон давно — не считается', () => {
    const probe = (gapMs: number) => {
      const { hitAt } = firstAttack(dummy, 1);
      const m = new FightMatch({ bot: dummy, seed: 1 }, 0);
      // Уклон — в реальном времени, посреди раунда (начало раунда уклоны из вступления сбрасывает).
      let hit: FightEvent | undefined;
      for (let t = 0; t <= hitAt && !hit; t += 10) {
        if (t === hitAt - gapMs) m.dodge(t);
        hit = m.tick(t).find((e) => e.type === 'bot_hit');
      }
      return hit;
    };
    expect(probe(300)).toMatchObject({ result: 'dodged', damage: 0 });
    expect(probe(FIGHT_RULES.dodgeWindowMs + 200)).toMatchObject({ result: 'landed' });
  });

  it('бот бьёт столько раз, сколько обещает его темп, и все удары внутри раунда', () => {
    const m = new FightMatch({ bot: FIGHT_BOTS[1]!, seed: 3 }, 0);
    m.setGuard(0, true);
    let hits = 0;
    for (let t = 0; t < FIGHT + FIGHT_RULES.roundMs + 100; t += 10) {
      for (const e of m.tick(t)) if (e.type === 'bot_hit') hits += 1;
    }
    expect(hits).toBe(Math.round((FIGHT_BOTS[1]!.attacksPerMin * FIGHT_RULES.roundMs) / 60_000));
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
    const m = new FightMatch({ bot: dummy, seed: 1 }, 0);
    m.setGuard(0, true); // бот снимает по 2
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
    // Кто впереди по здоровью, тот и взял раунд.
    const expected = s.hpMe > s.hpBot ? 'me' : s.hpBot > s.hpMe ? 'bot' : null;
    expect((re as Extract<FightEvent, { type: 'round_end' }>).winner).toBe(expected);
  });

  it('бот забивает: нокаут тебя, второй — поражение', () => {
    const hard: FightBot = { ...dummy, attacksPerMin: 60, damage: 50 };
    const m = new FightMatch({ bot: hard, seed: 2 }, 0);
    let s = m.snapshot(0);
    for (let t = 0; t < 120_000 && s.phase !== 'over'; t += 20) {
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
    const rate = FIGHT_BOTS.map((b) => b.attacksPerMin);
    expect(rate).toEqual([...rate].sort((a, b) => a - b));
    expect(findFightBot('machine').level).toBe(3);
    expect(findFightBot('нет').id).toBe('athlete');
  });
});
