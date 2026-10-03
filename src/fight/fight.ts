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
// - stagger — потрясён (сорванный замах, серия в лицо): не бьёт, всё проходит;
// - dodge — ушёл от твоего удара (уклон, нырок, отход): удар мимо, бот часто сразу отвечает.
// Твой удар — событие страницы (детектор ударов punch.ts): чистый бьёт сильнее, серия подряд — бонус (комбо).
//
// Бот не только по расписанию (U-26): видит начало твоего удара (incoming) и может уйти от него; финтит —
// показывает замах и останавливается; читает тебя — бьёт, как только ты опустил руки, против глухой защиты
// чаще бьёт мощно, против частых уклонов — джебами и финтами, дожимает, когда у тебя мало здоровья. И ходит
// по рингу (move): кружит, сближается, отходит — это для анимации, на урон не влияет.
//
// Как в UFC (U-27): здоровье кончилось — не нокаут сразу, а нокдаун: боец на настиле, рефери считает до 10.
// Бот встаёт на каком-то счёте, ты — когда поднимешь обе руки (getUp), но не раньше meMinCount. Встал — с
// половиной здоровья, а максимум с каждым нокдауном ниже. Третий нокдаун в раунде или не встал до 10 — нокаут,
// бой окончен. Раунд по времени — по очкам: урон + kdPoints за каждый нокдаун. Между раундами здоровье
// восстанавливается наполовину. Выносливость у обоих: удары, промахи и махи тратят, отдых (особенно в защите)
// возвращает; уставший бьёт слабее, уставший бот медленнее замахивается, чаще опускает руки и реже уходит.

import { mulberry32, type BotId } from '../duel/bot';

export type FightPhase = 'prep' | 'intro' | 'fight' | 'round_over' | 'over';
export type Fighter = 'me' | 'bot';
export type Outcome = 'win' | 'lose' | 'draw';
export type HitResult = 'landed' | 'blocked' | 'dodged';
export type BotState =
  | 'guard'
  | 'shell'
  | 'open'
  | 'windup'
  | 'strike'
  | 'recover'
  | 'stagger'
  | 'dodge'
  /** На настиле после нокдауна (since — момент падения). */
  | 'down'
  /** Встаёт после нокдауна. */
  | 'getup';
/** Уклон бота (в его координатах): голова уходит влево или вправо, нырок вниз, отход назад. */
export type DodgeKind = 'slip_left' | 'slip_right' | 'duck' | 'back';
/** Перемещение по рингу: кружит влево или вправо (свои лево и право), сближается, отходит, стоит. */
export type Footwork = 'circle_left' | 'circle_right' | 'in' | 'out' | 'hold';
export type AttackKind = 'jab' | 'power';
export type Side = 'left' | 'right';
/**
 * Чем кончился твой удар: блок, просто попал, по открытому, контратака, сорвал замах, в корпус мимо блока,
 * мимо (бот ушёл).
 */
export type PunchKind = 'blocked' | 'hit' | 'open' | 'counter' | 'interrupt' | 'body' | 'miss';

export interface BotAttack {
  kind: AttackKind;
  /** Какой рукой: джеб — левой (передней), мощный — правой или левым боковым. */
  side: Side;
  /** Ответ после уклона: замах короче. */
  counter?: boolean;
  /** Ложный замах: «!» горит, но удара не будет — пауза, потом настоящий. */
  feint?: boolean;
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
  /** Вероятность уйти от твоего удара (из стойки или с опущенными руками). */
  dodgeChance?: number;
  /** Вероятность сразу ответить после уклона. */
  counterChance?: number;
  /** Доля ложных замахов среди атак. */
  feintChance?: number;
  /** Насколько бот подстраивается под тебя, 0…1 (0 — только по своим вероятностям). */
  smart?: number;
  /** Видит опущенную защиту через столько мс — и сразу атакует (если smart > 0). */
  readMs?: number;
  /** «Дыхалка»: множитель восстановления выносливости (1 — обычная). */
  cardio?: number;
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
    dodgeChance: 0.08,
    counterChance: 0.2,
    feintChance: 0.03,
    smart: 0.2,
    readMs: 650,
    cardio: 0.85,
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
    dodgeChance: 0.18,
    counterChance: 0.45,
    feintChance: 0.1,
    smart: 0.55,
    readMs: 420,
    cardio: 1,
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
    dodgeChance: 0.28,
    counterChance: 0.65,
    feintChance: 0.16,
    smart: 0.9,
    readMs: 260,
    cardio: 1.3,
  },
];

export function findFightBot(id: string | null): FightBot {
  return FIGHT_BOTS.find((b) => b.id === id) ?? FIGHT_BOTS[1]!;
}

/** Правила боя — всё в одном месте. */
export const FIGHT_RULES = {
  hp: 150,
  /** «Приготовься»: отсчёт перед первым раундом. */
  prepMs: 5000,
  /** «Раунд N» → «Бой!» */
  introMs: 2000,
  roundMs: 60_000,
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
  /** Уклон бота: длится, мс; не чаще раза в столько мс. */
  botDodgeMs: 420,
  botDodgeCooldownMs: 1100,
  /** Ответ после уклона — замах короче во столько раз. */
  counterWindupMul: 0.6,
  /** Ложный замах — такая доля обычного, потом пауза перед настоящим ударом, мс. */
  feintShare: 0.55,
  feintPauseMs: 170,
  /** Перемещение по рингу меняется раз в столько мс. */
  moveMs: [1000, 2400] as const,
  /** Ты бьёшь без остановки (столько ударов за spamWindowMs) — бот читает и уходит чаще. */
  spamPunches: 3,
  spamWindowMs: 2500,
  /** Здоровье «мало» — меньше такой доли. */
  lowHp: 0.35,
  /** Нокдаун: падение до начала счёта, один счёт рефери, мс; до скольки считать. */
  kdFallMs: 900,
  kdCountMs: 900,
  kdCountTo: 10,
  /** Встал — столько здоровья от своего максимума; каждый нокдаун снижает максимум на долю, но не ниже. */
  kdGetUpHp: 0.55,
  kdMaxLoss: 0.15,
  kdMinMax: 0.4,
  /** Третий нокдаун в раунде — нокаут. */
  kdLimit: 3,
  /** Ты встаёшь не раньше этого счёта; бот встаёт на счёт: первый нокдаун раунда — от и до, второй — от и до. */
  meMinCount: 2,
  botGetUp1: [3, 6] as const,
  botGetUp2: [6, 9] as const,
  /** После второго нокдауна в раунде бот может не встать. */
  botStayDown: 0.25,
  /** Бот встаёт, мс; после твоего подъёма бот ждёт, мс. */
  getUpMs: 1100,
  resumeMs: 1200,
  /** Между раундами восстанавливается такая доля недостающего здоровья (до максимума) и выносливости. */
  roundRecover: 0.5,
  staminaRecover: 0.6,
  /** Выносливость: максимум; твои траты — удар, промах (сверх удара), мах руками, блок джеба и мощного. */
  stamina: 100,
  punchCost: 7,
  missCost: 5,
  swingCost: 6,
  blockCost: 3,
  powerBlockCost: 7,
  /** Восстановление в секунду (через regenDelayMs после последнего удара), в защите — больше на guardRegen. */
  staminaRegen: 11,
  guardRegen: 5,
  regenDelayMs: 650,
  /** Ниже такой выносливости удары слабее: при нуле — такая доля урона. */
  tiredBelow: 40,
  tiredDamage: 0.55,
  /** Бот: траты на джеб, мощный, уклон; восстановление в секунду (не в атаке). */
  botJabCost: 6,
  botPowerCost: 12,
  botDodgeCost: 5,
  botRegen: 7.5,
  /** Пропущенный ботом удар отнимает у него выносливость: доля урона; в корпус — больше. */
  hitDrain: 0.25,
  bodyDrain: 0.8,
  /** Очки раунда: за нокдаун сверх урона; раунд по очкам — при разнице больше decisionMargin. */
  kdPoints: 40,
  decisionMargin: 4,
} as const;

type Widen<T> = T extends number
  ? number
  : T extends readonly [number, number]
    ? readonly [number, number]
    : T;
export type FightRules = { readonly [K in keyof typeof FIGHT_RULES]: Widen<(typeof FIGHT_RULES)[K]> };

export interface FightOptions {
  bot: FightBot;
  rules?: Partial<FightRules>;
  seed?: number;
}

export type FightEvent =
  | { type: 'phase'; phase: FightPhase; round: number }
  | {
      type: 'bot_state';
      state: BotState;
      attack: BotAttack | null;
      at: number;
      until: number;
      dodge: DodgeKind | null;
    }
  | { type: 'bot_windup'; side: Side; kind: AttackKind }
  | { type: 'bot_hit'; result: HitResult; damage: number; ko: boolean; kind: AttackKind; side: Side }
  /** Нокдаун: кто упал, который это нокдаун в бою. */
  | { type: 'knockdown'; who: Fighter; count: number; at: number }
  /** Рефери считает: n = 1…10. */
  | { type: 'count'; who: Fighter; n: number }
  | { type: 'getup'; who: Fighter }
  | { type: 'round_end'; winner: Fighter | null; why: 'ko' | 'time'; round: number }
  | { type: 'over'; outcome: Outcome };

export interface PunchResult {
  damage: number;
  /** Бот заблокировал. */
  blocked: boolean;
  kind: PunchKind;
  /** Номер удара в серии (1 — одиночный). */
  combo: number;
  /** Бот упал (нокдаун) от этого удара. */
  knockdown: boolean;
  /** Нокаут — бой окончен. */
  ko: boolean;
  /** Ты устал — удар слабее обычного. */
  tired: boolean;
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
  /** Твои удары мимо (бот ушёл). */
  missed: number;
  /** Нокдауны: ты отправил бота на настил; тебя отправили. */
  kdScored: number;
  kdTaken: number;
}

/** Что сейчас делает бот — для анимации. */
export interface BotView {
  state: BotState;
  since: number;
  until: number;
  attack: BotAttack | null;
  /** Куда уклонился (в состоянии dodge). */
  dodge?: DodgeKind | null;
  /** Куда идёт по рингу. */
  move?: Footwork;
  /** Усталость 0…1 — руки ниже, тяжело дышит. */
  fatigue?: number;
}

/** Кто на настиле и как идёт счёт. */
export interface DownView {
  who: Fighter;
  /** Упал, мс. */
  at: number;
  /** Счёт рефери 0…10 (0 — ещё падает). */
  count: number;
  /** Можно вставать (ты): счёт дошёл до meMinCount. */
  canGetUp: boolean;
}

export interface FightSnapshot {
  phase: FightPhase;
  round: number;
  hpMe: number;
  hpBot: number;
  /** Максимум здоровья сейчас (падает с нокдаунами). */
  maxHpMe: number;
  maxHpBot: number;
  /** Выносливость 0…stamina. */
  staminaMe: number;
  staminaBot: number;
  /** Нокдауны за бой: сколько раз падал ты и бот. */
  kdMe: number;
  kdBot: number;
  /** Кто сейчас на настиле. */
  down: DownView | null;
  /** Чем кончился бой: нокаут — кто победил; null — по очкам или ещё идёт. */
  koWinner: Fighter | null;
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
  private botDodge: DodgeKind | null = null;
  private lastBotDodgeAt = -Infinity;
  /** Твои удары (начала) — бот читает темп и руку. */
  private yourPunchesAt: number[] = [];
  /** Твои уклоны (начала) — против частых уклонов бот бьёт джебами и финтит. */
  private yourDodgesAt: number[] = [];
  /** Доля времени в защите за последние секунды (0…1). */
  private guardShare = 0;
  private guardShareAt = 0;
  /** Когда ты опустил руки; на какое опускание бот уже ответил атакой. */
  private guardDownAt = -Infinity;
  private pouncedAt = -Infinity;
  private pounce = false;
  /** Бот только что попал — дожимает (следующая пауза короче). */
  private pressing = false;
  private move: Footwork = 'hold';
  private moveUntil = 0;
  /** Футворк — своя случайность: не сбивает решения боя. */
  private readonly moveRnd: () => number;
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
    missed: 0,
    kdScored: 0,
    kdTaken: 0,
  };
  private readonly maxHp: Record<Fighter, number>;
  private readonly kd: Record<Fighter, number> = { me: 0, bot: 0 };
  private roundKd: Record<Fighter, number> = { me: 0, bot: 0 };
  /** Очки раунда: урон, нанесённый каждым. */
  private roundDmg: Record<Fighter, number> = { me: 0, bot: 0 };
  private down: {
    who: Fighter;
    at: number;
    countStart: number;
    getUpAt: number | null;
    shown: number;
  } | null = null;
  private koWinner: Fighter | null = null;
  /** До этого момента бот не набрасывается (ты только встал). */
  private calmUntil = 0;
  /** Сколько оставалось в раунде, когда он кончился. */
  private leftAtEnd = 0;
  private staminaMe: number;
  private staminaBot: number;
  private staminaAt = 0;

  /** startedAt — момент начала подготовки. */
  constructor(opts: FightOptions, startedAt: number) {
    this.rules = { ...FIGHT_RULES, ...opts.rules };
    this.bot = opts.bot;
    this.rnd = mulberry32(opts.seed ?? 1);
    this.moveRnd = mulberry32(((opts.seed ?? 1) ^ 0x5bd1e995) >>> 0);
    this.phaseAt = startedAt;
    this.botSince = startedAt;
    this.hpMe = this.rules.hp;
    this.hpBot = this.rules.hp;
    this.maxHp = { me: this.rules.hp, bot: this.rules.hp };
    this.staminaMe = this.rules.stamina;
    this.staminaBot = this.rules.stamina;
    this.staminaAt = startedAt;
  }

  // ——— Ввод игрока ———

  /** Твой удар: clean — без ошибки техники, low — в корпус. null — сейчас не бой. */
  punch(now: number, clean: boolean, low = false): PunchResult | null {
    // События до этого момента (счёт рефери, подъём) не теряем — их отдаст следующий tick.
    this.pending.push(...this.tick(now));
    // Лежачего не бьют, с настила не бьют.
    if (this.phase !== 'fight' || this.down || this.botState === 'getup') return null;
    const r = this.rules;
    // Выносливость: удар тратит; уставший бьёт слабее.
    const tiredMul =
      this.staminaMe >= r.tiredBelow
        ? 1
        : r.tiredDamage + ((1 - r.tiredDamage) * Math.max(0, this.staminaMe)) / r.tiredBelow;
    this.staminaMe = Math.max(0, this.staminaMe - r.punchCost);
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
      case 'dodge':
      case 'down':
        kind = 'miss';
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
      case 'miss':
        damage = 0;
        break;
    }
    if (kind === 'miss') {
      // Мимо: серия оборвалась, урона нет, промах тратит силы сверх удара.
      this.combo = 0;
      this.stats.missed += 1;
      this.staminaMe = Math.max(0, this.staminaMe - r.missCost);
      return { damage: 0, blocked: false, kind, combo: 0, knockdown: false, ko: false, tired: tiredMul < 1 };
    }
    const blocked = kind === 'blocked';
    if (!blocked) damage = Math.max(1, Math.round(damage * tiredMul));
    if (blocked) this.stats.blockedByBot += 1;
    else this.stats.landed += 1;
    if (kind === 'counter' || kind === 'interrupt') this.stats.counters += 1;
    this.stats.damageDealt += damage;
    this.roundDmg.me += damage;
    // Пропущенные удары выбивают дыхание, удары в корпус — особенно.
    if (!blocked) this.staminaBot = Math.max(0, this.staminaBot - damage * (low ? r.bodyDrain : r.hitDrain));
    this.hpBot = Math.max(0, this.hpBot - damage);
    const knockdown = this.hpBot === 0;
    // Нокдаун внутри удара: события (падение, счёт, нокаут) отдаст следующий tick.
    if (knockdown) this.knockdown('bot', now, this.pending);
    else if (!blocked) this.react(now, kind);
    return {
      damage,
      blocked,
      kind,
      combo: this.combo,
      knockdown,
      ko: this.koWinner === 'me',
      tired: tiredMul < 1,
    };
  }

  /** Мах руками, а не удар (детектор не подтвердил): урона нет, силы тратятся. */
  swing(now: number): void {
    this.pending.push(...this.tick(now));
    if (this.phase !== 'fight' || this.down?.who === 'me') return;
    this.staminaMe = Math.max(0, this.staminaMe - this.rules.swingCost);
    this.lastPunchAt = now;
  }

  /**
   * Встать с настила (ты поднял обе руки): можно, когда счёт дошёл до meMinCount. Встал — здоровье
   * kdGetUpHp от максимума, бот даёт тебе resumeMs. false — сейчас нельзя.
   */
  getUp(now: number): boolean {
    this.pending.push(...this.tick(now));
    const d = this.down;
    if (this.phase !== 'fight' || !d || d.who !== 'me' || d.shown < this.rules.meMinCount) return false;
    this.down = null;
    this.hpMe = Math.round(this.maxHp.me * this.rules.kdGetUpHp);
    this.pending.push({ type: 'getup', who: 'me' });
    this.calmUntil = now + this.rules.resumeMs;
    this.setBot('guard', now, this.rules.resumeMs, null, this.pending);
    return true;
  }

  /**
   * Ты начал удар (детектор — в самом начале, касание будет позже): бот может уйти — уклон, нырок или отход.
   * Уходит из стойки или с опущенными руками (это приманка), не чаще раза в botDodgeCooldownMs; чаще — когда
   * ты бьёшь без остановки и когда у него мало здоровья. Часто сразу отвечает (counterChance).
   */
  incoming(now: number, side: Side, low = false): void {
    // События до этого момента не теряем — их отдаст следующий tick.
    this.pending.push(...this.tick(now));
    if (this.phase !== 'fight') return;
    const r = this.rules;
    this.yourPunchesAt = this.yourPunchesAt.filter((t) => now - t <= r.spamWindowMs);
    this.yourPunchesAt.push(now);
    const b = this.bot;
    const chance = (b.dodgeChance ?? 0) * (1 - 0.7 * this.botTired());
    if (this.down || chance <= 0 || (this.botState !== 'guard' && this.botState !== 'open')) return;
    if (now - this.lastBotDodgeAt < r.botDodgeCooldownMs || this.staminaBot < r.botDodgeCost) return;
    let p = chance;
    if (this.botState === 'open') p *= 1.5;
    if (this.yourPunchesAt.length >= r.spamPunches) p *= 1 + 0.5 * (b.smart ?? 0);
    if (this.hpBot < r.hp * r.lowHp) p *= 1.25;
    if (this.rnd() >= Math.min(0.85, p)) return;
    // Твоя левая — с его правой стороны: уходит влево (от удара); в корпус — отходит назад.
    const kind: DodgeKind = low
      ? 'back'
      : this.rnd() < 0.3
        ? 'duck'
        : side === 'left'
          ? 'slip_left'
          : 'slip_right';
    this.lastBotDodgeAt = now;
    this.staminaBot -= r.botDodgeCost;
    if ((b.counterChance ?? 0) > 0 && this.rnd() < b.counterChance!) {
      const power = this.rnd() < b.powerShare + 0.15;
      this.queued = {
        kind: power ? 'power' : 'jab',
        side: power && side === 'left' ? 'right' : 'left',
        counter: true,
      };
    }
    this.setBot('dodge', now, r.botDodgeMs, null, this.pending, kind);
  }

  /** Стойка защиты: кулаки у подбородка (по кадрам камеры). */
  setGuard(now: number, up: boolean): void {
    // Доля времени в защите — скользящее среднее с окном ~4 с.
    const dt = Math.max(0, now - this.guardShareAt);
    this.guardShareAt = now;
    const k = 1 - Math.exp(-dt / 4000);
    this.guardShare += ((this.guardUp ? 1 : 0) - this.guardShare) * k;
    if (this.guardUp && !up) {
      this.guardAt = now;
      this.guardDownAt = now;
    }
    this.guardUp = up;
  }

  /** Корпус ушёл в сторону или вниз — уклон. */
  dodge(now: number): void {
    // Новый уклон (а не тот же, что держится кадр за кадром) — бот запоминает привычку.
    if (now - this.dodgeAt > 300) {
      this.yourDodgesAt = this.yourDodgesAt.filter((t) => now - t <= 6000);
      this.yourDodgesAt.push(now);
    }
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
          this.regen(Math.min(now, end));
          if (this.down) this.downTick(Math.min(now, end), events);
          if (this.phase !== 'fight') break;
          this.readGuard(Math.min(now, end));
          // Переходы бота, чей момент уже наступил (и не позже конца раунда).
          while (this.phase === 'fight' && this.botUntil <= Math.min(now, end)) this.advance(events);
          this.footwork(Math.min(now, end));
          if (this.phase !== 'fight') break;
          if (now >= end) {
            // По очкам: урон + нокдауны. Лежавший в гонг — спасён гонгом.
            const me = this.roundDmg.me + r.kdPoints * this.roundKd.bot;
            const bot = this.roundDmg.bot + r.kdPoints * this.roundKd.me;
            const winner = me - bot > r.decisionMargin ? 'me' : bot - me > r.decisionMargin ? 'bot' : null;
            if (this.down) {
              const who = this.down.who;
              this.down = null;
              if (who === 'me') this.hpMe = Math.round(this.maxHp.me * r.kdGetUpHp);
              else this.hpBot = Math.round(this.maxHp.bot * r.kdGetUpHp);
            }
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
      maxHpMe: this.maxHp.me,
      maxHpBot: this.maxHp.bot,
      staminaMe: this.staminaMe,
      staminaBot: this.staminaBot,
      kdMe: this.kd.me,
      kdBot: this.kd.bot,
      down: this.down
        ? {
            who: this.down.who,
            at: this.down.at,
            count: this.down.shown,
            canGetUp: this.down.who === 'me' && this.down.shown >= r.meMinCount,
          }
        : null,
      koWinner: this.koWinner,
      winsMe: this.winsMe,
      winsBot: this.winsBot,
      prepLeftMs: this.phase === 'prep' ? left(r.prepMs) : 0,
      introLeftMs: this.phase === 'intro' ? left(r.introMs) : 0,
      timeLeftMs: fighting ? left(r.roundMs) : this.phase === 'round_over' ? this.leftAtEnd : r.roundMs,
      combo: fighting && now - this.lastPunchAt <= r.comboWindowMs ? this.combo : 0,
      windup: fighting && this.botState === 'windup',
      // После нокаута бот так и лежит (и на итогах).
      bot:
        fighting || (this.koWinner === 'me' && this.botState === 'down')
          ? {
              state: this.botState,
              since: this.botSince,
              until: this.botUntil,
              attack: this.attack,
              dodge: this.botDodge,
              move: this.move,
              fatigue: this.botTired(),
            }
          : { state: 'guard', since: this.phaseAt, until: Infinity, attack: null, dodge: null, move: 'hold' },
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
      case 'windup': {
        const a = this.attack!;
        if (a.feint) {
          // Ложный замах: остановился — и бьёт по-настоящему (быстрее обычного).
          this.queued = {
            kind: a.kind === 'power' ? 'jab' : 'power',
            side: a.kind === 'power' ? 'left' : 'right',
            counter: true,
          };
          this.setBot('guard', at, this.rules.feintPauseMs, null, events);
          break;
        }
        this.setBot('strike', at, this.strikeMs(), a, events);
        break;
      }
      case 'strike': {
        const hit = this.resolveAttack(at);
        events.push(hit);
        if (this.hpMe === 0) {
          this.knockdown('me', at, events);
          return;
        }
        const a = this.attack!;
        const r = this.rules;
        let ms = a.kind === 'jab' ? r.jabRecoverMs : r.powerRecoverMs;
        if (hit.result === 'dodged') ms += r.whiffExtraMs;
        this.pressing = hit.result === 'landed';
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
    const b = this.bot;
    const smart = b.smart ?? 0;
    // Ты опустил руки — бот это увидел и бьёт сразу, без «опущенных рук» и раздумий.
    const pounce = this.pounce;
    this.pounce = false;
    const roll = this.rnd();
    const lowMe = this.hpMe < r.hp * r.lowHp;
    const tired = this.botTired();
    // Выдохся — нет сил на удар: стоит, отдыхает.
    if (this.staminaBot < r.botJabCost && b.attacksPerMin > 0) {
      this.setBot(tired > 0.8 ? 'open' : 'guard', at, between(this.rnd(), r.openMs), null, events);
      return;
    }
    // Усталый чаще опускает руки.
    const openP = b.openChance * 0.5 * (lowMe ? 1 - 0.6 * smart : 1) + 0.25 * tired;
    if (!pounce && roll < openP) {
      this.setBot('open', at, between(this.rnd(), r.openMs), null, events);
      return;
    }
    if (b.attacksPerMin <= 0) {
      this.setBot('guard', at, this.guardMs(), null, events);
      return;
    }
    // Против глухой защиты — мощные (пробивают блок), против частых уклонов — джебы.
    const dodgy = this.yourDodgesAt.filter((t) => at - t <= 6000).length;
    let powerShare = b.powerShare + (smart * 0.35 * Math.max(0, this.guardShare - 0.55)) / 0.45;
    if (dodgy >= 2) powerShare *= 1 - 0.45 * smart;
    if (pounce) powerShare += 0.2 * smart;
    const power = this.rnd() < Math.min(0.9, powerShare);
    const attack: BotAttack = power
      ? { kind: 'power', side: this.rnd() < 0.6 ? 'right' : 'left' }
      : { kind: 'jab', side: 'left' };
    if (pounce) attack.counter = true;
    // Финт: чаще против того, кто уклоняется на каждый замах.
    const feint = (b.feintChance ?? 0) * (1 + (dodgy >= 2 ? smart : 0));
    if (!pounce && feint > 0 && this.rnd() < feint) attack.feint = true;
    this.windup(at, attack, events);
  }

  /**
   * Опущенная защита: держишь руки внизу дольше readMs, а бот в стойке и ждёт — он атакует сейчас
   * (раз на одно опускание рук).
   */
  private readGuard(now: number): void {
    const b = this.bot;
    if (!(b.smart ?? 0) || this.guardUp || this.botState !== 'guard' || b.attacksPerMin <= 0) return;
    // Лежачего не бьют, вставшему дают прийти в себя.
    if (this.down || now < this.calmUntil) return;
    if (this.pouncedAt === this.guardDownAt || now - this.guardDownAt < (b.readMs ?? 500)) return;
    if (this.botUntil - now < 120) return;
    this.pouncedAt = this.guardDownAt;
    this.pounce = true;
    this.botUntil = Math.max(this.botSince + 1, now);
  }

  /** Куда бот идёт по рингу: кружит, сближается, отходит — по ходу боя. */
  private footwork(now: number): void {
    // Нокдаун: ты на настиле — бот уходит в нейтральный угол; он сам на настиле — стоит на месте.
    if (this.down) {
      this.move = this.down.who === 'me' ? 'out' : 'hold';
      this.moveUntil = now;
      return;
    }
    if (now < this.moveUntil) return;
    const r = this.rules;
    const u = this.moveRnd();
    const lowBot = this.hpBot < r.hp * r.lowHp;
    const lowMe = this.hpMe < r.hp * r.lowHp;
    let next: Footwork;
    if (this.botState === 'recover' || this.botState === 'stagger') next = 'out';
    else if (this.botState === 'shell' || lowBot)
      next = u < 0.45 ? 'out' : u < 0.725 ? 'circle_left' : 'circle_right';
    else if (lowMe || this.pressing) next = u < 0.5 ? 'in' : u < 0.75 ? 'circle_left' : 'circle_right';
    else
      next =
        u < 0.32 ? 'circle_left' : u < 0.64 ? 'circle_right' : u < 0.78 ? 'in' : u < 0.9 ? 'out' : 'hold';
    // Не стоять на месте одним и тем же ходом дважды подряд.
    if (next === this.move && next !== 'in') next = next === 'circle_left' ? 'circle_right' : 'circle_left';
    this.move = next;
    this.moveUntil = now + between(this.moveRnd(), r.moveMs);
  }

  private windup(at: number, attack: BotAttack, events: FightEvent[]): void {
    const r = this.rules;
    let ms = attack.kind === 'jab' ? this.bot.jabWindupMs : this.bot.powerWindupMs;
    if (attack.counter) ms *= r.counterWindupMul;
    if (attack.feint) ms *= r.feintShare;
    // Усталый замахивается медленнее — его видно и проще поймать.
    ms *= 1 + 0.45 * this.botTired();
    if (!attack.feint)
      this.staminaBot = Math.max(
        0,
        this.staminaBot - (attack.kind === 'power' ? r.botPowerCost : r.botJabCost),
      );
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
    // Мало здоровья — «плывёт» от попаданий.
    if (
      this.hpBot < this.maxHp.bot * 0.25 &&
      (this.botState === 'guard' || this.botState === 'open') &&
      this.rnd() < 0.3
    ) {
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
    dodge: DodgeKind | null = null,
  ): void {
    this.botState = state;
    this.botSince = at;
    this.botUntil = at + Math.max(1, Math.round(ms));
    this.attack = attack;
    this.botDodge = dodge;
    events.push({ type: 'bot_state', state, attack, at, until: this.botUntil, dodge });
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
    let mean = Math.max(r.minGuardMs, 60_000 / b.attacksPerMin - cycle);
    // Дожимает: только что попал или у тебя мало здоровья — пауза короче.
    const smart = b.smart ?? 0;
    if (this.pressing || this.hpMe < r.hp * r.lowHp) mean *= 1 - 0.4 * smart;
    this.pressing = false;
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
      // Держать удар в блоке — тоже силы.
      this.staminaMe = Math.max(0, this.staminaMe - (a.kind === 'power' ? r.powerBlockCost : r.blockCost));
    } else {
      result = 'landed';
      damage = a.kind === 'power' ? this.bot.powerDamage : this.bot.jabDamage;
      // Усталый бот бьёт мягче.
      damage = Math.max(1, Math.round(damage * (1 - 0.3 * this.botTired())));
    }
    this.stats.damageTaken += damage;
    this.roundDmg.bot += damage;
    this.hpMe = Math.max(0, this.hpMe - damage);
    return { type: 'bot_hit', result, damage, ko: this.hpMe === 0, kind: a.kind, side: a.side };
  }

  // ——— Раунды ———

  private startIntro(at: number, events: FightEvent[]): void {
    this.phase = 'intro';
    this.phaseAt = at;
    this.round += 1;
    const r = this.rules;
    // Между раундами — половина потерянного (до максимума), выносливость тоже.
    this.hpMe = Math.round(this.hpMe + (this.maxHp.me - this.hpMe) * (this.round === 1 ? 1 : r.roundRecover));
    this.hpBot = Math.round(
      this.hpBot + (this.maxHp.bot - this.hpBot) * (this.round === 1 ? 1 : r.roundRecover),
    );
    this.staminaMe += (r.stamina - this.staminaMe) * (this.round === 1 ? 1 : r.staminaRecover);
    this.staminaBot += (r.stamina - this.staminaBot) * (this.round === 1 ? 1 : r.staminaRecover);
    this.roundKd = { me: 0, bot: 0 };
    this.roundDmg = { me: 0, bot: 0 };
    this.down = null;
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
    this.pounce = false;
    this.pressing = false;
    this.guardDownAt = Math.max(this.guardDownAt, at);
    this.yourPunchesAt = [];
    this.yourDodgesAt = [];
    this.lastBotDodgeAt = -Infinity;
    this.move = 'hold';
    this.moveUntil = at + 600;
    this.staminaAt = at;
    events.push({ type: 'phase', phase: 'fight', round: this.round });
    this.setBot('guard', at, this.guardMs(), null, events);
  }

  private endRound(winner: Fighter | null, why: 'ko' | 'time', at: number, events?: FightEvent[]): void {
    if (winner === 'me') this.winsMe += 1;
    if (winner === 'bot') this.winsBot += 1;
    // Часы замирают на моменте конца раунда (нокаут — не на нуле).
    this.leftAtEnd = Math.max(0, this.phaseAt + this.rules.roundMs - at);
    this.phase = 'round_over';
    this.phaseAt = at;
    // Нокаутированный бот так и лежит.
    if (!(why === 'ko' && winner === 'me')) this.botState = 'guard';
    this.botUntil = Infinity;
    this.attack = null;
    this.queued = null;
    this.botDodge = null;
    this.move = 'hold';
    events?.push({ type: 'round_end', winner, why, round: this.round });
    events?.push({ type: 'phase', phase: 'round_over', round: this.round });
  }

  /** Бой решён: нокаут, кто-то взял нужное число раундов или раунды кончились. */
  private decided(): boolean {
    const r = this.rules;
    return (
      this.koWinner !== null ||
      this.winsMe >= r.roundsToWin ||
      this.winsBot >= r.roundsToWin ||
      this.round >= r.maxRounds
    );
  }

  private outcome(): Outcome {
    if (this.gaveUp) return 'lose';
    if (this.koWinner) return this.koWinner === 'me' ? 'win' : 'lose';
    if (this.winsMe !== this.winsBot) return this.winsMe > this.winsBot ? 'win' : 'lose';
    // Поровну раундов — по очкам за весь бой.
    const r = this.rules;
    const me = this.stats.damageDealt + r.kdPoints * this.kd.bot;
    const bot = this.stats.damageTaken + r.kdPoints * this.kd.me;
    return me - bot > r.decisionMargin ? 'win' : bot - me > r.decisionMargin ? 'lose' : 'draw';
  }

  // ——— Нокдауны и выносливость ———

  /** Усталость бота 0…1: ниже половины выносливости — растёт. */
  private botTired(): number {
    return Math.min(1, Math.max(0, (50 - this.staminaBot) / 50));
  }

  /** Выносливость восстанавливается: ты — через паузу после удара (в защите быстрее), бот — не в атаке. */
  private regen(now: number): void {
    const dt = Math.max(0, now - this.staminaAt) / 1000;
    this.staminaAt = now;
    if (dt <= 0) return;
    const r = this.rules;
    if (this.down?.who !== 'me' && now - this.lastPunchAt > r.regenDelayMs)
      this.staminaMe = Math.min(
        r.stamina,
        this.staminaMe + (r.staminaRegen + (this.guardUp ? r.guardRegen : 0)) * dt,
      );
    const resting = this.botState !== 'windup' && this.botState !== 'strike' && this.botState !== 'recover';
    if (resting) {
      const k =
        this.botState === 'shell' ? 1.3 : this.botState === 'open' || this.botState === 'down' ? 1.2 : 1;
      this.staminaBot = Math.min(r.stamina, this.staminaBot + r.botRegen * (this.bot.cardio ?? 1) * k * dt);
    }
  }

  /** Здоровье кончилось — нокдаун: максимум ниже, третий в раунде — нокаут, иначе рефери считает. */
  private knockdown(who: Fighter, at: number, events: FightEvent[]): void {
    const r = this.rules;
    this.kd[who] += 1;
    this.roundKd[who] += 1;
    if (who === 'bot') this.stats.kdScored += 1;
    else this.stats.kdTaken += 1;
    this.maxHp[who] = Math.max(
      Math.round(r.hp * r.kdMinMax),
      Math.round(this.maxHp[who] * (1 - r.kdMaxLoss)),
    );
    this.queued = null;
    this.combo = 0;
    events.push({ type: 'knockdown', who, count: this.kd[who], at });
    if (this.roundKd[who] >= r.kdLimit) {
      if (who === 'bot') this.setBot('down', at, Infinity, null, events);
      this.ko(who === 'bot' ? 'me' : 'bot', at, events);
      return;
    }
    const countStart = at + r.kdFallMs;
    let getUpAt: number | null = null;
    if (who === 'bot') {
      const second = this.roundKd.bot >= 2;
      const stays = second && this.rnd() < r.botStayDown;
      const [a, b] = second ? r.botGetUp2 : r.botGetUp1;
      if (!stays) getUpAt = countStart + Math.round(a + (b - a) * this.rnd()) * r.kdCountMs;
      this.setBot('down', at, Infinity, null, events);
    } else {
      // Ты на настиле: бот уходит в нейтральный угол и ждёт.
      this.setBot('guard', at, Infinity, null, events);
      this.move = 'out';
    }
    this.down = { who, at, countStart, getUpAt, shown: 0 };
  }

  /** Счёт рефери; бот встаёт на своём счёте; на 10 — нокаут. */
  private downTick(now: number, events: FightEvent[]): void {
    const r = this.rules;
    const d = this.down!;
    const n =
      now >= d.countStart ? Math.min(r.kdCountTo, Math.floor((now - d.countStart) / r.kdCountMs) + 1) : 0;
    while (d.shown < n) {
      d.shown += 1;
      events.push({ type: 'count', who: d.who, n: d.shown });
      if (d.who === 'bot' && d.getUpAt !== null && d.countStart + (d.shown - 1) * r.kdCountMs >= d.getUpAt)
        break;
    }
    if (d.who === 'bot' && d.getUpAt !== null && now >= d.getUpAt) {
      this.down = null;
      this.hpBot = Math.round(this.maxHp.bot * r.kdGetUpHp);
      events.push({ type: 'getup', who: 'bot' });
      this.setBot('getup', d.getUpAt, r.getUpMs, null, events);
      return;
    }
    const tenAt = d.countStart + (r.kdCountTo - 1) * r.kdCountMs + r.kdCountMs;
    if (now >= tenAt) {
      this.down = null;
      this.ko(d.who === 'bot' ? 'me' : 'bot', tenAt, events);
    }
  }

  private ko(winner: Fighter, at: number, events: FightEvent[]): void {
    this.koWinner = winner;
    this.down = null;
    this.endRound(winner, 'ko', at, events);
  }
}

const between = (u: number, [a, b]: readonly [number, number]) => a + (b - a) * u;
