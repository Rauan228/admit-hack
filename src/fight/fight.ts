// Бокс с ботом (E-36): бой как в файтинге — две полосы здоровья, раунды, нокаут. Чистая логика со временем
// снаружи, без DOM и таймеров (как DuelMatch). Страница зовёт tick(now) каждый кадр и получает события.
//
// Ход боя: подготовка 5 с («Приготовься») → «Раунд 1 … Бой!» → раунд → «Нокаут!» или «Время!» → … → итог.
// Твой удар — событие rep движка (бокс): чистый бьёт сильнее, серия ударов подряд — бонус (комбо), бот может
// заблокировать. Атаки бота расписаны заранее (botTimeline): за windupMs до удара он замахивается — если
// в момент удара кулаки у подбородка — блок (крошечный урон), если корпус ушёл в сторону или вниз — уклон.

import { botTimeline, mulberry32, type BotId } from '../duel/bot';

export type FightPhase = 'prep' | 'intro' | 'fight' | 'round_over' | 'over';
export type Fighter = 'me' | 'bot';
export type Outcome = 'win' | 'lose' | 'draw';
export type HitResult = 'landed' | 'blocked' | 'dodged';

export interface FightBot {
  id: BotId;
  name: string;
  level: 1 | 2 | 3;
  /** Атак в минуту. */
  attacksPerMin: number;
  /** Урон одной атаки, когда ты не закрылся. */
  damage: number;
  /** Вероятность заблокировать твой удар, 0..1. */
  blockChance: number;
}

export const FIGHT_BOTS: readonly FightBot[] = [
  { id: 'novice', name: 'Новичок', level: 1, attacksPerMin: 16, damage: 8, blockChance: 0.08 },
  { id: 'athlete', name: 'Атлет', level: 2, attacksPerMin: 26, damage: 10, blockChance: 0.22 },
  { id: 'machine', name: 'Машина', level: 3, attacksPerMin: 40, damage: 13, blockChance: 0.4 },
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
  /** Замах бота: от «!» до удара. */
  windupMs: 700,
  /** Твой урон: чистый удар, удар с ошибкой техники, удар в блок бота. */
  punchDamage: 5,
  shortPunchDamage: 3,
  blockedPunchDamage: 1,
  /** Урон бота, когда ты в блоке. */
  guardChip: 2,
  /** Удары не реже — комбо; каждый следующий удар серии +1 к урону, но не больше comboBonusMax. */
  comboWindowMs: 1500,
  comboBonusMax: 3,
  /** Блок засчитан, если стойка защиты была не раньше чем за столько до удара (дрожание точек). */
  guardGraceMs: 200,
  /** Уклон засчитан, если корпус ушёл не раньше чем за столько до удара. */
  dodgeWindowMs: 600,
} as const;

export type FightRules = typeof FIGHT_RULES;

export interface FightOptions {
  bot: FightBot;
  rules?: Partial<FightRules>;
  seed?: number;
}

export type FightEvent =
  | { type: 'phase'; phase: FightPhase; round: number }
  | { type: 'bot_windup'; side: 'left' | 'right' }
  | { type: 'bot_hit'; result: HitResult; damage: number; ko: boolean }
  | { type: 'round_end'; winner: Fighter | null; why: 'ko' | 'time'; round: number }
  | { type: 'over'; outcome: Outcome };

export interface PunchResult {
  damage: number;
  /** Бот заблокировал. */
  blocked: boolean;
  /** Номер удара в серии (1 — одиночный). */
  combo: number;
  ko: boolean;
}

export interface FightStats {
  punches: number;
  landed: number;
  blockedByBot: number;
  damageDealt: number;
  botAttacks: number;
  blocked: number;
  dodged: number;
  damageTaken: number;
  bestCombo: number;
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
  private timeline: number[] = [];
  private nextAttack = 0;
  private windupSent = false;
  private guardUp = false;
  private guardAt = -Infinity;
  private dodgeAt = -Infinity;
  private lastPunchAt = -Infinity;
  private combo = 0;
  private gaveUp = false;
  /** События, случившиеся вне tick (нокаут бота внутри punch) — отдаём следующим tick. */
  private readonly pending: FightEvent[] = [];
  private readonly stats: FightStats = {
    punches: 0,
    landed: 0,
    blockedByBot: 0,
    damageDealt: 0,
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
    this.hpMe = this.rules.hp;
    this.hpBot = this.rules.hp;
  }

  // ——— Ввод игрока ———

  /** Твой удар (rep движка). null — сейчас не бой. */
  punch(now: number, clean: boolean): PunchResult | null {
    this.tick(now);
    if (this.phase !== 'fight') return null;
    const r = this.rules;
    this.combo = now - this.lastPunchAt <= r.comboWindowMs ? this.combo + 1 : 1;
    this.lastPunchAt = now;
    this.stats.punches += 1;
    this.stats.bestCombo = Math.max(this.stats.bestCombo, this.combo);
    const blocked = this.rnd() < this.bot.blockChance;
    const base = clean ? r.punchDamage : r.shortPunchDamage;
    const damage = blocked ? r.blockedPunchDamage : base + Math.min(r.comboBonusMax, this.combo - 1);
    if (blocked) this.stats.blockedByBot += 1;
    else this.stats.landed += 1;
    this.stats.damageDealt += damage;
    this.hpBot = Math.max(0, this.hpBot - damage);
    const ko = this.hpBot === 0;
    // Нокаут внутри удара: события раунда отдаст следующий tick.
    if (ko) this.endRound('me', 'ko', now, this.pending);
    return { damage, blocked, combo: this.combo, ko };
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
          const elapsed = Math.min(now - this.phaseAt, r.roundMs);
          // Атаки бота, чей момент уже наступил.
          while (this.nextAttack < this.timeline.length && this.timeline[this.nextAttack]! <= elapsed) {
            const at = this.phaseAt + this.timeline[this.nextAttack]!;
            if (!this.windupSent)
              events.push({ type: 'bot_windup', side: this.nextAttack % 2 ? 'right' : 'left' });
            this.windupSent = false;
            this.nextAttack += 1;
            events.push(this.resolveAttack(at));
            if (this.hpMe === 0) {
              this.endRound('bot', 'ko', at, events);
              break;
            }
          }
          if (this.phase !== 'fight') break;
          if (elapsed >= r.roundMs) {
            const winner = this.hpMe > this.hpBot ? 'me' : this.hpBot > this.hpMe ? 'bot' : null;
            this.endRound(winner, 'time', this.phaseAt + r.roundMs, events);
            break;
          }
          // Замах перед следующей атакой.
          const next = this.timeline[this.nextAttack];
          if (next !== undefined && !this.windupSent && elapsed >= next - r.windupMs) {
            this.windupSent = true;
            events.push({ type: 'bot_windup', side: this.nextAttack % 2 ? 'right' : 'left' });
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
    return {
      phase: this.phase,
      round: this.round,
      hpMe: this.hpMe,
      hpBot: this.hpBot,
      winsMe: this.winsMe,
      winsBot: this.winsBot,
      prepLeftMs: this.phase === 'prep' ? left(r.prepMs) : 0,
      introLeftMs: this.phase === 'intro' ? left(r.introMs) : 0,
      timeLeftMs: this.phase === 'fight' ? left(r.roundMs) : this.phase === 'round_over' ? 0 : r.roundMs,
      combo: this.phase === 'fight' && now - this.lastPunchAt <= r.comboWindowMs ? this.combo : 0,
      windup: this.phase === 'fight' && this.windupSent,
      outcome: this.phase === 'over' ? this.outcome() : null,
      gaveUp: this.gaveUp,
      stats: { ...this.stats },
    };
  }

  /** Поза бота для анимации: замах/удар — какой рукой. */
  attackSide(): 'left' | 'right' {
    return this.nextAttack % 2 ? 'right' : 'left';
  }

  // ——— Внутреннее ———

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
    const total = Math.max(1, Math.round((this.bot.attacksPerMin * this.rules.roundMs) / 60_000));
    this.timeline = botTimeline(total, this.rules.roundMs, Math.floor(this.rnd() * 2 ** 31));
    this.nextAttack = 0;
    this.windupSent = false;
    this.dodgeAt = -Infinity;
    events.push({ type: 'phase', phase: 'fight', round: this.round });
  }

  private resolveAttack(at: number): FightEvent {
    const r = this.rules;
    this.stats.botAttacks += 1;
    let result: HitResult;
    let damage: number;
    if (at - this.dodgeAt <= r.dodgeWindowMs) {
      result = 'dodged';
      damage = 0;
      this.stats.dodged += 1;
    } else if (this.guardUp || at - this.guardAt <= r.guardGraceMs) {
      result = 'blocked';
      damage = r.guardChip;
      this.stats.blocked += 1;
    } else {
      result = 'landed';
      damage = this.bot.damage;
    }
    this.stats.damageTaken += damage;
    this.hpMe = Math.max(0, this.hpMe - damage);
    return { type: 'bot_hit', result, damage, ko: this.hpMe === 0 };
  }

  private endRound(winner: Fighter | null, why: 'ko' | 'time', at: number, events?: FightEvent[]): void {
    if (winner === 'me') this.winsMe += 1;
    if (winner === 'bot') this.winsBot += 1;
    this.phase = 'round_over';
    this.phaseAt = at;
    this.windupSent = false;
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
