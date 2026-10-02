// Бокс с ботом (E-36, U-25): бой как в файтинге — две полосы здоровья, раунды, нокаут. Чистая логика со
// временем снаружи, без DOM и таймеров (как DuelMatch). Страница зовёт tick(now) каждый кадр и получает события.
//
// Ход боя: подготовка 5 с («Приготовься») → «Раунд 1 … Бой!» → раунд → «Нокаут!» или «Время!» → … → итог.
//
// Бот — машина состояний (U-25), а не расписание ударов:
// - guard — стойка, кулаки у подбородка: удар в голову он иногда блокирует (guardBlock), в корпус — реже;
// - shell — глухая защита (закрылся после пропущенной серии): голова закрыта, корпус открыт;
// - open — опустил руки (устал, дразнит): любой удар проходит и бьёт сильнее;
// - windup — замах: джеб — короткий, мощный — долгий и широкий. Попал на замахе — «поймал»: двойной урон,
//   удар бота сорван, он потрясён;
// - strike — удар летит; в конце — касание: уклон (корпус ушёл) — мимо, кулаки у подбородка — блок, иначе попал;
// - recover — возврат после удара: он раскрыт, твой удар — контратака (×1,5). Промахнулся мимо уклона —
//   провалился, раскрыт дольше;
// - stagger — потрясён (сорванный замах, серия в лицо): не бьёт, всё проходит.
// Твой удар — событие страницы (детектор ударов от первого лица или повтор движка сбоку): чистый бьёт
// сильнее, серия подряд — бонус (комбо).

import { mulberry32, type BotId } from '../duel/bot';

export type FightPhase = 'prep' | 'intro' | 'fight' | 'round_over' | 'over';
export type Fighter = 'me' | 'bot';
export type Outcome = 'win' | 'lose' | 'draw';
export type HitResult = 'landed' | 'blocked' | 'dodged';
export type BotState = 'guard' | 'shell' | 'open' | 'windup' | 'strike' | 'recover' | 'stagger';
export type AttackKind = 'jab' | 'power';
export type Side = 'left' | 'right';
/** Чем кончился твой удар: блок, просто попал, по открытому, контратака, сорвал замах, в корпус мимо блока. */
export type PunchKind = 'blocked' | 'hit' | 'open' | 'counter' | 'interrupt' | 'body';

export interface BotAttack {
  kind: AttackKind;
  /** Какой рукой: джеб — левой (передней), мощный — правой или левым боковым. */
  side: Side;
}

export interface FightBot {
  id: BotId;
  name: string;
  level: 1 | 2 | 3;
  /** Атак в минуту (в среднем, вместе с паузами). */
  attacksPerMin: number;
  /** Урон джеба и мощного удара, когда ты не закрылся. */
  jabDamage: number;
  powerDamage: number;
  /** Доля мощных ударов среди атак. */
  powerShare: number;
  /** Замах: джеб и мощный, мс — сколько у тебя есть, чтобы закрыться, уклониться или поймать. */
  jabWindupMs: number;
  powerWindupMs: number;
  /** Вероятность заблокировать твой удар в голову в обычной стойке. */
  guardBlock: number;
  /** Вероятность уйти в глухую защиту, когда пропустил серию. */
  shellChance: number;
  /** Вероятность опустить руки вместо атаки. */
  openChance: number;
  /** Вероятность после джеба сразу добавить мощный (двойка). */
  followUp: number;
}

export const FIGHT_BOTS: readonly FightBot[] = [
  {
    id: 'novice',
    name: 'Новичок',
    level: 1,
    attacksPerMin: 14,
    jabDamage: 5,
    powerDamage: 12,
    powerShare: 0.25,
    jabWindupMs: 460,
    powerWindupMs: 1000,
    guardBlock: 0.15,
    shellChance: 0.15,
    openChance: 0.35,
    followUp: 0.1,
  },
  {
    id: 'athlete',
    name: 'Атлет',
    level: 2,
    attacksPerMin: 22,
    jabDamage: 6,
    powerDamage: 16,
    powerShare: 0.33,
    jabWindupMs: 380,
    powerWindupMs: 880,
    guardBlock: 0.35,
    shellChance: 0.35,
    openChance: 0.22,
    followUp: 0.25,
  },
  {
    id: 'machine',
    name: 'Машина',
    level: 3,
    attacksPerMin: 32,
    jabDamage: 7,
    powerDamage: 20,
    powerShare: 0.4,
    jabWindupMs: 320,
    powerWindupMs: 760,
    guardBlock: 0.55,
    shellChance: 0.55,
    openChance: 0.12,
    followUp: 0.4,
  },
];

export function findFightBot(id: string | null): FightBot {
  return FIGHT_BOTS.find((b) => b.id === id) ?? FIGHT_BOTS[1]!;
}

/** Правила боя — всё в одном месте. */
export const FIGHT_RULES = {
  hp: 100,
  /** «Приготовься»: отсчёт перед первым раундом. */
  prepMs: 5000,
  /** «Раунд N» → «Бой!» */
  introMs: 2000,
  roundMs: 45_000,
  /** «Нокаут!» / «Время!» на экране. */
  roundOverMs: 2600,
  roundsToWin: 2,
  maxRounds: 3,
  /** Удар бота летит (от конца замаха до касания), мс. */
  jabStrikeMs: 130,
  powerStrikeMs: 190,
  /** Возврат после удара — бот раскрыт, мс; промах мимо уклона — дольше на столько. */
  jabRecoverMs: 420,
  powerRecoverMs: 800,
  whiffExtraMs: 450,
  /** Потрясён, мс. */
  staggerMs: 900,
  /** Опустил руки, глухая защита: от и до, мс. */
  openMs: [800, 1400] as const,
  shellMs: [900, 1600] as const,
  /** Стойка между действиями — не короче, мс. */
  minGuardMs: 300,
  /** Глухая защита — после стольких твоих попаданий за shellWindowMs. */
  shellAfterHits: 3,
  shellWindowMs: 1600,
  /** Твой урон: чистый удар, удар с ошибкой техники, удар в блок бота. */
  punchDamage: 5,
  shortPunchDamage: 3,
  blockedPunchDamage: 1,
  /** Бонусы: по открытому, в корпус мимо глухой защиты; множители контратаки и сорванного замаха. */
  openBonus: 2,
  bodyBonus: 2,
  counterMul: 1.5,
  interruptMul: 2,
  /** Уклонился или заблокировал — столько мс твой удар считается контратакой. */
  counterWindowMs: 900,
  /** Урон бота, когда ты в блоке: джеб и мощный (мощный пробивает блок сильнее). */
  guardChip: 1,
  powerGuardChip: 4,
  /** Удары не реже — комбо; каждый следующий удар серии +1 к урону, но не больше comboBonusMax. */
  comboWindowMs: 1500,
  comboBonusMax: 3,
  /** Блок засчитан, если стойка защиты была не раньше чем за столько до касания (дрожание точек). */
  guardGraceMs: 200,
  /** Уклон засчитан, если корпус ушёл не раньше чем за столько до касания. */
  dodgeWindowMs: 600,
} as const;

type Widen<T> = T extends number ? number : T;
export type FightRules = { readonly [K in keyof typeof FIGHT_RULES]: Widen<(typeof FIGHT_RULES)[K]> };

export interface FightOptions {
  bot: FightBot;
  rules?: Partial<FightRules>;
  seed?: number;
}

export type FightEvent =
  | { type: 'phase'; phase: FightPhase; round: number }
  | { type: 'bot_state'; state: BotState; attack: BotAttack | null; at: number; until: number }
  | { type: 'bot_windup'; side: Side; kind: AttackKind }
  | { type: 'bot_hit'; result: HitResult; damage: number; ko: boolean; kind: AttackKind; side: Side }
  | { type: 'round_end'; winner: Fighter | null; why: 'ko' | 'time'; round: number }
  | { type: 'over'; outcome: Outcome };

export interface PunchResult {
  damage: number;
  /** Бот заблокировал. */
  blocked: boolean;
  kind: PunchKind;
  /** Номер удара в серии (1 — одиночный). */
  combo: number;
  ko: boolean;
}

export interface FightStats {
  punches: number;
  landed: number;
  blockedByBot: number;
  damageDealt: number;
  counters: number;
  botAttacks: number;
  blocked: number;
  dodged: number;
  damageTaken: number;
  bestCombo: number;
}

/** Что сейчас делает бот — для анимации. */
export interface BotView {
  state: BotState;
  since: number;
  until: number;
  attack: BotAttack | null;
}

export interface FightSnapshot {
  phase: FightPhase;
  round: number;
  hpMe: number;
  hpBot: number;
  winsMe: number;
  winsBot: number;
  prepLeftMs: number;
  introLeftMs: number;
  timeLeftMs: number;
  /** Текущая серия ударов (0 — серии нет). */
  combo: number;
  /** Бот замахнулся — сейчас ударит. */
  windup: boolean;
  bot: BotView;
  outcome: Outcome | null;
  gaveUp: boolean;
  stats: FightStats;
}

export class FightMatch {
  readonly rules: FightRules;
  private readonly bot: FightBot;
  private readonly rnd: () => number;
  private phase: FightPhase = 'prep';
  private phaseAt: number;
  private round = 0;
  private hpMe: number;
  private hpBot: number;
  private winsMe = 0;
  private winsBot = 0;
  private botState: BotState = 'guard';
  private botSince = 0;
  private botUntil = Infinity;
  private attack: BotAttack | null = null;
  /** После джеба — сразу мощный (двойка). */
  private queued: BotAttack | null = null;
  private guardUp = false;
  private guardAt = -Infinity;
  private dodgeAt = -Infinity;
  private counterUntil = -Infinity;
  private hitsAt: number[] = [];
  private lastPunchAt = -Infinity;
  private combo = 0;
  private gaveUp = false;
  /** События, случившиеся вне tick (нокаут бота, сорванный замах внутри punch) — отдаём следующим tick. */
  private readonly pending: FightEvent[] = [];
  private readonly stats: FightStats = {
    punches: 0,
    landed: 0,
    blockedByBot: 0,
    damageDealt: 0,
    counters: 0,
    botAttacks: 0,
    blocked: 0,
    dodged: 0,
    damageTaken: 0,
    bestCombo: 0,
  };

  /** startedAt — момент начала подготовки. */
  constructor(opts: FightOptions, startedAt: number) {
    this.rules = { ...FIGHT_RULES, ...opts.rules };
    this.bot = opts.bot;
    this.rnd = mulberry32(opts.seed ?? 1);
    this.phaseAt = startedAt;
    this.botSince = startedAt;
    this.hpMe = this.rules.hp;
    this.hpBot = this.rules.hp;
  }

  // ——— Ввод игрока ———

  /** Твой удар: clean — без ошибки техники, low — в корпус. null — сейчас не бой. */
  punch(now: number, clean: boolean, low = false): PunchResult | null {
    this.tick(now);
    if (this.phase !== 'fight') return null;
    const r = this.rules;
    this.combo = now - this.lastPunchAt <= r.comboWindowMs ? this.combo + 1 : 1;
    this.lastPunchAt = now;
    this.stats.punches += 1;
    this.stats.bestCombo = Math.max(this.stats.bestCombo, this.combo);
    const base = (clean ? r.punchDamage : r.shortPunchDamage) + Math.min(r.comboBonusMax, this.combo - 1);
    let kind: PunchKind;
    let damage: number;
    const counter = now <= this.counterUntil;
    switch (this.botState) {
      case 'shell':
        kind = low ? 'body' : 'blocked';
        break;
      case 'guard': {
        const block = this.bot.guardBlock * (low ? 0.35 : 1);
        kind = !counter && this.rnd() < block ? 'blocked' : counter ? 'counter' : 'hit';
        break;
      }
      case 'open':
        kind = 'open';
        break;
      case 'windup':
        kind = 'interrupt';
        break;
      case 'recover':
        kind = 'counter';
        break;
      case 'strike':
      case 'stagger':
        kind = counter ? 'counter' : 'hit';
        break;
    }
    switch (kind) {
      case 'blocked':
        damage = r.blockedPunchDamage;
        break;
      case 'body':
        damage = base + r.bodyBonus;
        break;
      case 'open':
        damage = base + r.openBonus;
        break;
      case 'counter':
        damage = Math.round(base * r.counterMul);
        break;
      case 'interrupt':
        damage = Math.round(base * r.interruptMul);
        break;
      case 'hit':
        damage = base;
        break;
    }
    const blocked = kind === 'blocked';
    if (blocked) this.stats.blockedByBot += 1;
    else this.stats.landed += 1;
    if (kind === 'counter' || kind === 'interrupt') this.stats.counters += 1;
    this.stats.damageDealt += damage;
    this.hpBot = Math.max(0, this.hpBot - damage);
    const ko = this.hpBot === 0;
    if (ko) {
      // Нокаут внутри удара: события раунда отдаст следующий tick.
      this.endRound('me', 'ko', now, this.pending);
    } else if (!blocked) this.react(now, kind);
    return { damage, blocked, kind, combo: this.combo, ko };
  }

  /** Стойка защиты: кулаки у подбородка (по кадрам камеры). */
  setGuard(now: number, up: boolean): void {
    if (this.guardUp && !up) this.guardAt = now;
    this.guardUp = up;
  }

  /** Корпус ушёл в сторону или вниз — уклон. */
  dodge(now: number): void {
    this.dodgeAt = now;
  }

  giveUp(now: number): void {
    this.tick(now);
    if (this.phase === 'over') return;
    this.gaveUp = true;
    this.phase = 'over';
    this.phaseAt = now;
  }

  // ——— Время ———

  /** Довести бой до момента now; события — что случилось с прошлого вызова. */
  tick(now: number): FightEvent[] {
    const events: FightEvent[] = this.pending.splice(0);
    const r = this.rules;
    for (;;) {
      switch (this.phase) {
        case 'prep':
          if (now < this.phaseAt + r.prepMs) return events;
          this.startIntro(this.phaseAt + r.prepMs, events);
          break;
        case 'intro':
          if (now < this.phaseAt + r.introMs) return events;
          this.startFight(this.phaseAt + r.introMs, events);
          break;
        case 'fight': {
          const end = this.phaseAt + r.roundMs;
          // Переходы бота, чей момент уже наступил (и не позже конца раунда).
          while (this.phase === 'fight' && this.botUntil <= Math.min(now, end)) this.advance(events);
          if (this.phase !== 'fight') break;
          if (now >= end) {
            const winner = this.hpMe > this.hpBot ? 'me' : this.hpBot > this.hpMe ? 'bot' : null;
            this.endRound(winner, 'time', end, events);
            break;
          }
          return events;
        }
        case 'round_over':
          if (now < this.phaseAt + r.roundOverMs) return events;
          if (this.decided()) {
            this.phase = 'over';
            this.phaseAt += r.roundOverMs;
            events.push({ type: 'phase', phase: 'over', round: this.round });
            events.push({ type: 'over', outcome: this.outcome() });
          } else this.startIntro(this.phaseAt + r.roundOverMs, events);
          break;
        case 'over':
          return events;
      }
    }
  }

  snapshot(now: number): FightSnapshot {
    const r = this.rules;
    const left = (ms: number) => Math.max(0, this.phaseAt + ms - now);
    const fighting = this.phase === 'fight';
    return {
      phase: this.phase,
      round: this.round,
      hpMe: this.hpMe,
      hpBot: this.hpBot,
      winsMe: this.winsMe,
      winsBot: this.winsBot,
      prepLeftMs: this.phase === 'prep' ? left(r.prepMs) : 0,
      introLeftMs: this.phase === 'intro' ? left(r.introMs) : 0,
      timeLeftMs: fighting ? left(r.roundMs) : this.phase === 'round_over' ? 0 : r.roundMs,
      combo: fighting && now - this.lastPunchAt <= r.comboWindowMs ? this.combo : 0,
      windup: fighting && this.botState === 'windup',
      bot: fighting
        ? { state: this.botState, since: this.botSince, until: this.botUntil, attack: this.attack }
        : { state: 'guard', since: this.phaseAt, until: Infinity, attack: null },
      outcome: this.phase === 'over' ? this.outcome() : null,
      gaveUp: this.gaveUp,
      stats: { ...this.stats },
    };
  }

  // ——— Бот ———

  /** Текущее состояние бота кончилось (в момент botUntil) — следующее. */
  private advance(events: FightEvent[]): void {
    const at = this.botUntil;
    switch (this.botState) {
      case 'windup':
        this.setBot('strike', at, this.strikeMs(), this.attack, events);
        break;
      case 'strike': {
        const hit = this.resolveAttack(at);
        events.push(hit);
        if (this.hpMe === 0) {
          this.endRound('bot', 'ko', at, events);
          return;
        }
        const a = this.attack!;
        const r = this.rules;
        let ms = a.kind === 'jab' ? r.jabRecoverMs : r.powerRecoverMs;
        if (hit.result === 'dodged') ms += r.whiffExtraMs;
        // Двойка: после джеба сразу мощный — без возврата в стойку.
        if (a.kind === 'jab' && hit.result !== 'dodged' && this.rnd() < this.bot.followUp) {
          this.queued = { kind: 'power', side: 'right' };
          ms = Math.round(ms * 0.35);
        }
        this.setBot('recover', at, ms, a, events);
        break;
      }
      default:
        this.decide(at, events);
    }
  }

  /** Бот в стойке решает, что дальше: атака, опустить руки, закрыться — или постоять. */
  private decide(at: number, events: FightEvent[]): void {
    const r = this.rules;
    if (this.queued) {
      const a = this.queued;
      this.queued = null;
      this.windup(at, a, events);
      return;
    }
    if (this.botState !== 'guard') {
      this.setBot('guard', at, this.guardMs(), null, events);
      return;
    }
    const roll = this.rnd();
    if (roll < this.bot.openChance * 0.5) {
      this.setBot('open', at, between(this.rnd(), r.openMs), null, events);
      return;
    }
    if (this.bot.attacksPerMin <= 0) {
      this.setBot('guard', at, this.guardMs(), null, events);
      return;
    }
    const power = this.rnd() < this.bot.powerShare;
    this.windup(
      at,
      power ? { kind: 'power', side: this.rnd() < 0.6 ? 'right' : 'left' } : { kind: 'jab', side: 'left' },
      events,
    );
  }

  private windup(at: number, attack: BotAttack, events: FightEvent[]): void {
    const ms = attack.kind === 'jab' ? this.bot.jabWindupMs : this.bot.powerWindupMs;
    this.setBot('windup', at, ms, attack, events);
    events.push({ type: 'bot_windup', side: attack.side, kind: attack.kind });
  }

  /** Бот реагирует на твоё попадание: сорванный замах — потрясён, серия в голову — закрывается. */
  private react(now: number, kind: PunchKind): void {
    const r = this.rules;
    this.hitsAt = this.hitsAt.filter((t) => now - t <= r.shellWindowMs);
    this.hitsAt.push(now);
    if (kind === 'interrupt') {
      this.queued = null;
      this.setBot('stagger', now, r.staggerMs, null, this.pending);
      return;
    }
    if (
      this.hitsAt.length >= r.shellAfterHits &&
      (this.botState === 'guard' || this.botState === 'open' || this.botState === 'stagger')
    ) {
      this.hitsAt = [];
      const shell = this.rnd() < this.bot.shellChance;
      if (shell) this.setBot('shell', now, between(this.rnd(), r.shellMs), null, this.pending);
      else if (this.botState !== 'stagger')
        this.setBot('stagger', now, r.staggerMs * 0.6, null, this.pending);
    }
  }

  private setBot(
    state: BotState,
    at: number,
    ms: number,
    attack: BotAttack | null,
    events: FightEvent[],
  ): void {
    this.botState = state;
    this.botSince = at;
    this.botUntil = at + Math.max(1, Math.round(ms));
    this.attack = attack;
    events.push({ type: 'bot_state', state, attack, at, until: this.botUntil });
  }

  private strikeMs(): number {
    return this.attack?.kind === 'power' ? this.rules.powerStrikeMs : this.rules.jabStrikeMs;
  }

  /** Стойка между действиями: средний темп атак минус время самих атак, с разбросом. */
  private guardMs(): number {
    const b = this.bot;
    const r = this.rules;
    if (b.attacksPerMin <= 0) return 60_000;
    const cycle =
      (1 - b.powerShare) * (b.jabWindupMs + r.jabStrikeMs + r.jabRecoverMs) +
      b.powerShare * (b.powerWindupMs + r.powerStrikeMs + r.powerRecoverMs);
    const mean = Math.max(r.minGuardMs, 60_000 / b.attacksPerMin - cycle);
    return Math.max(r.minGuardMs, mean * (0.5 + this.rnd()));
  }

  private resolveAttack(at: number): Extract<FightEvent, { type: 'bot_hit' }> {
    const r = this.rules;
    const a = this.attack!;
    this.stats.botAttacks += 1;
    let result: HitResult;
    let damage: number;
    if (at - this.dodgeAt <= r.dodgeWindowMs) {
      result = 'dodged';
      damage = 0;
      this.stats.dodged += 1;
      this.counterUntil = at + r.counterWindowMs;
    } else if (this.guardUp || at - this.guardAt <= r.guardGraceMs) {
      result = 'blocked';
      damage = a.kind === 'power' ? r.powerGuardChip : r.guardChip;
      this.stats.blocked += 1;
      this.counterUntil = at + r.counterWindowMs;
    } else {
      result = 'landed';
      damage = a.kind === 'power' ? this.bot.powerDamage : this.bot.jabDamage;
    }
    this.stats.damageTaken += damage;
    this.hpMe = Math.max(0, this.hpMe - damage);
    return { type: 'bot_hit', result, damage, ko: this.hpMe === 0, kind: a.kind, side: a.side };
  }

  // ——— Раунды ———

  private startIntro(at: number, events: FightEvent[]): void {
    this.phase = 'intro';
    this.phaseAt = at;
    this.round += 1;
    this.hpMe = this.rules.hp;
    this.hpBot = this.rules.hp;
    this.combo = 0;
    this.lastPunchAt = -Infinity;
    events.push({ type: 'phase', phase: 'intro', round: this.round });
  }

  private startFight(at: number, events: FightEvent[]): void {
    this.phase = 'fight';
    this.phaseAt = at;
    this.dodgeAt = -Infinity;
    this.counterUntil = -Infinity;
    this.hitsAt = [];
    this.queued = null;
    events.push({ type: 'phase', phase: 'fight', round: this.round });
    this.setBot('guard', at, this.guardMs(), null, events);
  }

  private endRound(winner: Fighter | null, why: 'ko' | 'time', at: number, events?: FightEvent[]): void {
    if (winner === 'me') this.winsMe += 1;
    if (winner === 'bot') this.winsBot += 1;
    this.phase = 'round_over';
    this.phaseAt = at;
    this.botState = 'guard';
    this.botUntil = Infinity;
    this.attack = null;
    this.queued = null;
    events?.push({ type: 'round_end', winner, why, round: this.round });
    events?.push({ type: 'phase', phase: 'round_over', round: this.round });
  }

  /** Бой решён: кто-то взял нужное число раундов или раунды кончились. */
  private decided(): boolean {
    const r = this.rules;
    return this.winsMe >= r.roundsToWin || this.winsBot >= r.roundsToWin || this.round >= r.maxRounds;
  }

  private outcome(): Outcome {
    if (this.gaveUp) return 'lose';
    return this.winsMe > this.winsBot ? 'win' : this.winsMe < this.winsBot ? 'lose' : 'draw';
  }
}

const between = (u: number, [a, b]: readonly [number, number]) => a + (b - a) * u;
