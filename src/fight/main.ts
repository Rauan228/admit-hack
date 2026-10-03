// E-36: бокс с ботом — отдельная страница /fight.html (без React и экранов платформы), как дуэль.
// Бой от первого лица (fpv.ts): весь экран — 3D-ринг, камера в игре — твоя голова, внизу твои перчатки,
// твоя камера со скелетом — окошко в углу, сверху табло как в трансляции UFC: здоровье, выносливость,
// нокдауны, раунды. Нокдаун — счёт рефери; ты встаёшь, подняв обе руки. Вид «сбоку» убран.
// Экраны: menu (выбор бота) → setup (камера) → arena (подготовка 5 с → раунды) → result.
// Время, здоровье и исход — в FightMatch; стойка (блок, уклон) — StanceTracker; здесь движок, DOM и звук.
// Для проверок: ?mock=1 (мок-движок), ?bot=machine.

import '../ui/styles/global.css';
import './fight.css';

import { CameraError } from '../engine/camera';
import { createEngine } from '../engine/createEngine';
import { isMobileDevice } from '../engine/perf';
import { prefetchPoseAssetsWhenIdle } from '../engine/pose';
import type { Engine, EngineEvent, Landmark } from '../engine/types';
import { numberWord, say, unlockVoice } from '../ui/audio/voice';
import { coverView, drawSkeleton } from '../ui/lib/skeleton';
import { COLORS } from '../ui/theme';
import { formatClock } from '../duel/match';
import {
  FIGHT_BOTS,
  FIGHT_RULES,
  FightMatch,
  findFightBot,
  type BotView,
  type FightBot,
  type FightEvent,
  type FightSnapshot,
  type PunchResult,
  type Side,
} from './fight';
import { DAZE_MS, PUNCH_DECIDE_MS, type FpvPunch, type FpvState, type FpvView } from './fpv';
import { FRAMING_HINT, GloveTracker, framing, type Framing, type GloveSide } from './gloves';
import { PunchDetector } from './punch';
import { crowdSfx, fightSfx, unlockFightAudio } from './sfx';
import { StanceTracker } from './stance';

type Screen = 'menu' | 'setup' | 'arena' | 'result';

/** Потолок подхода для движка: раунд держит таймер страницы, не цель по ударам. */
const ENGINE_TARGET = 1000;
const HINT_MS = 2200;
/** От первого лица: тряска камеры от блока, мс; ты падаешь на канву и встаёшь, мс. */
const SHAKE_BLOCK_MS = 180;
const ME_FALL_MS = 650;
const ME_RISE_MS = 900;
/** Встать с настила: обе кисти выше носа столько мс подряд. */
const ARMS_UP_MS = 250;
/** Подсказки «это мах», «выдохся», «бот выдохся» — не чаще, мс. */
const SWING_HINT_EVERY_MS = 3500;
const TIRED_HINT_EVERY_MS = 7000;
/** Выносливость ниже — «выдохся» (полоса оранжевая, края экрана темнеют). */
const TIRED_AT = FIGHT_RULES.tiredBelow;
/** Кадр плохой дольше — подсказка; в бою повторяем не чаще. */
const FRAMING_BAD_MS = 1200;
const FRAMING_HINT_EVERY_MS = 4000;
const BOT_ABOUT: Record<FightBot['id'], string> = {
  novice: 'Часто опускает руки, замах видно издалека',
  athlete: 'Держит блок, бьёт двойки, уходит от одиночных',
  machine: 'Читает тебя: финтит, уклоняется и сразу отвечает',
};
/** Бой стоит дольше — трибуны гудят «буу» (не чаще раза в BOO_EVERY_MS). */
const BOO_IDLE_MS = 9000;
const BOO_EVERY_MS = 14000;

const params = new URLSearchParams(location.search);
const MOBILE = isMobileDevice();

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const app = $<HTMLElement>('app');
const video = $<HTMLVideoElement>('video');
const canvas = $<HTMLCanvasElement>('overlay');
const ctx = canvas.getContext('2d')!;
const ui = {
  sideMe: $<HTMLDivElement>('side-me'),
  sideBot: $<HTMLDivElement>('side-bot'),
  floatMe: $<HTMLDivElement>('float-me'),
  floatBot: $<HTMLDivElement>('float-bot'),
  guardPill: $<HTMLSpanElement>('guard-pill'),
  hudBot: $<HTMLSpanElement>('hud-bot'),
  hpMe: $<HTMLSpanElement>('hp-me'),
  hpMeGhost: $<HTMLSpanElement>('hp-me-ghost'),
  hpBot: $<HTMLSpanElement>('hp-bot'),
  hpBotGhost: $<HTMLSpanElement>('hp-bot-ghost'),
  hpMeCap: $<HTMLSpanElement>('hp-me-cap'),
  hpBotCap: $<HTMLSpanElement>('hp-bot-cap'),
  stMe: $<HTMLSpanElement>('st-me'),
  stBot: $<HTMLSpanElement>('st-bot'),
  kdMe: $<HTMLSpanElement>('kd-me'),
  kdBot: $<HTMLSpanElement>('kd-bot'),
  pipsMe: $<HTMLSpanElement>('pips-me'),
  pipsBot: $<HTMLSpanElement>('pips-bot'),
  clock: $<HTMLSpanElement>('clock'),
  roundLabel: $<HTMLSpanElement>('round-label'),
  roundOf: $<HTMLSpanElement>('round-of'),
  kd: $<HTMLDivElement>('kd'),
  kdLabel: $<HTMLSpanElement>('kd-label'),
  kdCount: $<HTMLElement>('kd-count'),
  kdSub: $<HTMLSpanElement>('kd-sub'),
  kdUp: $<HTMLButtonElement>('kd-up'),
  combo: $<HTMLDivElement>('combo'),
  comboNum: $<HTMLElement>('combo-num'),
  banner: $<HTMLDivElement>('banner'),
  bannerBig: $<HTMLElement>('banner-big'),
  bannerSub: $<HTMLElement>('banner-sub'),
  tips: $<HTMLUListElement>('tips'),
  hintBox: $<HTMLDivElement>('hint-box'),
  hint: $<HTMLElement>('hint'),
  giveUp: $<HTMLButtonElement>('give-up'),
  bots: $<HTMLDivElement>('bots'),
  cameraOn: $<HTMLButtonElement>('camera-on'),
  introError: $<HTMLParagraphElement>('intro-error'),
  setupMeta: $<HTMLParagraphElement>('setup-meta'),
  setupStatus: $<HTMLParagraphElement>('setup-status'),
  start: $<HTMLButtonElement>('start'),
  resultTitle: $<HTMLHeadingElement>('result-title'),
  resultMe: $<HTMLSpanElement>('result-me'),
  resultBot: $<HTMLSpanElement>('result-bot'),
  resultBotName: $<HTMLSpanElement>('result-bot-name'),
  resultNote: $<HTMLParagraphElement>('result-note'),
  resultStats: $<HTMLElement>('result-stats'),
};
$<HTMLAnchorElement>('home').href = import.meta.env.BASE_URL;
$<HTMLAnchorElement>('arena-link').href = `${import.meta.env.BASE_URL}duel.html`;
$<HTMLAnchorElement>('result-arena').href = `${import.meta.env.BASE_URL}duel.html`;

let bot: FightBot = findFightBot(params.get('bot'));
let engine: Engine | null = null;
let engineReady = false;
let match: FightMatch | null = null;
let page: Screen = 'menu';
let phaseShown = '';
let errorJoints = new Set<number>();
let hintUntil = 0;
let lastLandmarks: Landmark[] | null = null;
let lastImage: HTMLCanvasElement | null = null;
let lastFrameAt = 0;
let wakeLock: { release(): Promise<void> } | null = null;
const stance = new StanceTracker();
let guardShown = false;
const SHOWN_RESET = {
  hpMe: -1,
  hpBot: -1,
  maxMe: -1,
  maxBot: -1,
  stMe: -1,
  stBot: -1,
  tiredMe: false,
  tiredBot: false,
  kdMe: -1,
  kdBot: -1,
  second: -1,
  combo: -1,
  round: -1,
  lastTen: false,
  winsMe: -1,
  winsBot: -1,
  /** Нокдаун на экране: кто и счёт («» — нет). */
  down: '',
};
let shown = { ...SHOWN_RESET };
/** Боец в меню — та же 3D-модель, что на ринге (отдельный чанк, грузится сразу). */
let menuBoxer: { setActive(on: boolean): void } | null = null;
/** Что делает бот (из матча) — для анимации. */
const BOT_IDLE: BotView = { state: 'guard', since: 0, until: Infinity, attack: null };
let botView: BotView = BOT_IDLE;
/** Вид от первого лица: сцена (отдельный чанк three.js), перчатки, сдвиг корпуса, эффекты. */
let fpv: FpvView | null = null;
let fpvLoading: Promise<void> | null = null;
/** 3D-ринг не запустился (нет WebGL) — без него боя нет, кнопка «К бою» выключена. */
let fpvFailed = false;
const gloves = new GloveTracker();
let shift = { x: 0, y: 0 };
let botHurt: FpvState['botHurt'] = null;
let botBlockedAt = -Infinity;
let knock: FpvState['knock'] = null;
let lastActionAt = 0;
let booAt = -Infinity;
let shakeAt = -Infinity;
let shakeMs = 0;
let frameIs: Framing = 'none';
/** Ты на настиле: когда упал и когда встал (для камеры); сейчас лежишь ли. */
let meDownAt = -Infinity;
let meUpAt = -Infinity;
let meIsDown = false;
let armsUpSince = 0;
let swingHintAt = -Infinity;
let tiredHintAt = -Infinity;
let botTiredHintAt = -Infinity;
/**
 * Удар — событие детектора (punch.ts) в начале удара: перчатка летит сразу, урон — в момент
 * касания. Повтор движка приходит позже (рука уже вернулась) и путает руку — здесь он только для подсказок
 * по технике: удар с ошибкой техники за последние FLAWED_MS — «с ошибкой» (меньше урона).
 */
const punchDetector = new PunchDetector();
const punches: Partial<Record<GloveSide, FpvPunch>> = {};
let lastFormErrorAt = -Infinity;
const FLAWED_MS = 1500;
let frameBadSince = 0;
let frameHintAt = -Infinity;

/** Сцена от первого лица: грузим three.js и модель один раз, при первом входе в бой. */
function ensureFpv(): void {
  if (fpv || fpvLoading || fpvFailed) return;
  fpvLoading = import('./fpv')
    .then((m) => {
      fpv = new m.FpvView($<HTMLCanvasElement>('fpv'), MOBILE);
    })
    .catch((err) => {
      // Без WebGL ринга нет — говорим честно, бой не начинаем.
      console.error('[fight] 3D-ринг не запустился', err);
      fpvFailed = true;
      ui.start.disabled = true;
      setStatus(
        '3D-ринг не запустился: нужен браузер с WebGL (Chrome, Safari, Edge). Обнови страницу.',
        'bad',
      );
    })
    .finally(() => {
      fpvLoading = null;
    });
}

// ——— Меню: выбор бота ———
function paintBots(): void {
  ui.bots.replaceChildren(
    ...FIGHT_BOTS.map((b) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'bot';
      btn.setAttribute('role', 'radio');
      btn.setAttribute('aria-checked', String(b.id === bot.id));
      btn.classList.toggle('is-active', b.id === bot.id);
      const level = document.createElement('span');
      level.className = 'bot__level';
      level.append(
        ...[1, 2, 3].map((i) => {
          const s = document.createElement('span');
          if (i <= b.level) s.className = 'is-on';
          return s;
        }),
      );
      const who = document.createElement('span');
      who.className = 'bot__who';
      const name = document.createElement('b');
      name.className = 'bot__name';
      name.textContent = b.name;
      const about = document.createElement('span');
      about.className = 'bot__about';
      about.textContent = BOT_ABOUT[b.id];
      who.append(name, about);
      const stat = document.createElement('span');
      stat.className = 'bot__stat';
      stat.textContent = `${b.attacksPerMin} атак/мин · урон ${b.jabDamage}–${b.powerDamage}`;
      btn.append(level, who, stat);
      btn.addEventListener('click', () => {
        bot = b;
        paintBots();
      });
      return btn;
    }),
  );
}
paintBots();
void import('./menuBoxer')
  .then((m) => {
    menuBoxer = new m.MenuBoxer($('menu-ghost'));
    menuBoxer.setActive(page === 'menu');
  })
  .catch((err) => console.warn('[fight] боец в меню не загрузился', err));

// ——— Экраны ———
function show(next: Screen): void {
  page = next;
  app.dataset.screen = next;
  for (const el of app.querySelectorAll<HTMLElement>('[data-for]')) {
    el.hidden = !el.dataset.for!.split(' ').includes(next);
  }
  if (next !== 'arena') {
    ui.hintBox.hidden = true;
    ui.combo.hidden = true;
    ui.banner.hidden = true;
    ui.tips.hidden = true;
    app.dataset.phase = '';
    phaseShown = '';
    ui.sideBot.classList.remove('is-windup', 'is-ko');
  }
  menuBoxer?.setActive(next === 'menu');
}

function setStatus(text: string, state: 'ok' | 'wait' | 'bad'): void {
  ui.setupStatus.textContent = text;
  ui.setupStatus.dataset.state = state;
}

// ——— Камера и движок ———
ui.cameraOn.addEventListener('click', () => {
  unlock();
  void goWide();
  void keepScreenOn();
  if (engine) return toSetup();
  void startEngine();
});

function unlock(): void {
  unlockFightAudio();
  unlockVoice();
}

/** Телефон: на весь экран и горизонтально (где браузер позволяет; иначе просим повернуть вручную). */
async function goWide(): Promise<void> {
  if (!MOBILE) return;
  try {
    await document.documentElement.requestFullscreen?.();
  } catch {
    /* без полного экрана тоже можно */
  }
  try {
    const o = (window.screen as { orientation?: { lock?(o: string): Promise<void> } }).orientation;
    await o?.lock?.('landscape');
  } catch {
    /* iOS не даёт — покажем «поверни телефон» */
  }
}

async function startEngine(): Promise<void> {
  ui.cameraOn.disabled = true;
  ui.introError.hidden = true;
  toSetup();
  setStatus('Загружаю модель…', 'wait');
  try {
    engine = await createEngine();
    engine.on(onEvent);
    engine.setMode('menu');
    await engine.start(video);
    engineReady = true;
    ui.start.disabled = fpvFailed;
    setStatus('Камера включена — встань так, чтобы тебя было видно по пояс.', 'wait');
  } catch (err) {
    console.error('[fight] движок не запустился', err);
    engine?.stop();
    engine = null;
    show('menu');
    ui.introError.textContent =
      err instanceof CameraError ? err.message : 'Не удалось запустить распознавание. Обнови страницу.';
    ui.introError.hidden = false;
  } finally {
    ui.cameraOn.disabled = false;
  }
}

function toSetup(): void {
  show('setup');
  frameIs = 'none';
  engine?.setMode('menu');
  ui.start.disabled = !engineReady || fpvFailed;
  ui.setupMeta.textContent = `Против бота «${bot.name}» · ${FIGHT_RULES.maxRounds} раунда по ${Math.round(
    FIGHT_RULES.roundMs / 60_000,
  )} мин · нокаут или по очкам`;
  ensureFpv();
  botView = BOT_IDLE;
  ui.hudBot.textContent = bot.name;
}

$<HTMLButtonElement>('setup-back').addEventListener('click', () => {
  engine?.setMode('menu');
  show('menu');
});

function onEvent(e: EngineEvent): void {
  const now = performance.now();
  switch (e.type) {
    case 'frame': {
      lastLandmarks = e.landmarks;
      lastImage = e.image instanceof HTMLCanvasElement ? e.image : null;
      lastFrameAt = now;
      // Стойка: блок и уклон — по точкам каждого кадра.
      const aspect = video.videoWidth > 0 ? video.videoWidth / video.videoHeight : 16 / 9;
      if (!fpvFailed) checkFraming(framing(e.landmarks, aspect), now);
      const st = stance.update(e.landmarks, now, aspect);
      shift = { x: st.shiftX, y: st.shiftY };
      gloves.update(e.landmarks, now, aspect);
      onPunches(punchDetector.update(e.landmarks, now, aspect));
      if (meIsDown) checkArmsUp(e.landmarks, now);
      match?.setGuard(now, st.guard);
      if (st.dodge) match?.dodge(now);
      if (st.guard !== guardShown) {
        guardShown = st.guard;
        ui.guardPill.hidden = !st.guard || page !== 'arena';
      }
      break;
    }
    case 'calibration':
      // На подготовке кадр проверяет checkFraming, в бою — подсказка «вернись в кадр».
      if (page === 'arena' && e.status !== 'ok' && app.dataset.phase === 'fight') hint(e.hint, 'bad');
      break;
    case 'gesture':
      if (page === 'setup' && engineReady && !ui.start.disabled) startMatch();
      else if (page === 'result') startMatch();
      else if (page === 'arena' && meIsDown) tryGetUp(now);
      break;
    case 'form_error':
      // Во время счёта рефери подсказки по технике — шум.
      if (page !== 'arena' || !ui.kd.hidden) break;
      lastFormErrorAt = now;
      hint(e.message, 'bad');
      errorJoints = new Set(e.joints);
      break;
    case 'form_ok':
      errorJoints = new Set();
      break;
  }
}

/**
 * Удар виден по локтям: просим встать так, чтобы они были в кадре. На подготовке — статус
 * сразу, в бою — подсказка, если кадр плохой дольше FRAMING_BAD_MS (не чаще раза в FRAMING_HINT_EVERY_MS).
 */
function checkFraming(f: Framing, now: number): void {
  if (f !== frameIs) {
    frameIs = f;
    frameBadSince = now;
    if (page === 'setup' && engineReady) {
      if (f === 'ok') setStatus('Вижу тебя — кулаки к подбородку', 'ok');
      else setStatus(FRAMING_HINT[f], 'bad');
    }
  }
  if (
    f !== 'ok' &&
    page === 'arena' &&
    app.dataset.phase === 'fight' &&
    now - frameBadSince > FRAMING_BAD_MS &&
    now - frameHintAt > FRAMING_HINT_EVERY_MS
  ) {
    frameHintAt = now;
    hint(FRAMING_HINT[f], 'bad');
  }
}

// ——— Бой ———
function startMatch(): void {
  unlock();
  match = new FightMatch({ bot, seed: (Math.random() * 2 ** 31) | 0 }, performance.now());
  punchDetector.reset();
  delete punches.left;
  delete punches.right;
  shown = { ...SHOWN_RESET };
  errorJoints = new Set();
  ui.hudBot.textContent = bot.name;
  ui.sideBot.classList.remove('is-ko', 'is-windup');
  ui.floatMe.replaceChildren();
  ui.floatBot.replaceChildren();
  botView = BOT_IDLE;
  botHurt = null;
  knock = null;
  botBlockedAt = -Infinity;
  meDownAt = meUpAt = -Infinity;
  meIsDown = false;
  armsUpSince = 0;
  app.classList.remove('is-down', 'is-tired');
  ui.kd.hidden = true;
  paintRounds(0);
  engine?.setMode('menu');
  show('arena');
  app.dataset.phase = 'prep';
  paintPips(0, 0);
  ui.tips.hidden = false;
  crowdSfx.start();
  say('Приготовься');
}

ui.start.addEventListener('click', () => {
  if (engineReady) startMatch();
});
ui.giveUp.addEventListener('click', () => match?.giveUp(performance.now()));
ui.kdUp.addEventListener('click', () => tryGetUp(performance.now()));
$<HTMLButtonElement>('again').addEventListener('click', startMatch);
$<HTMLButtonElement>('change').addEventListener('click', () => {
  match = null;
  engine?.setMode('menu');
  crowdSfx.stop();
  show('menu');
});

/**
 * Удары детектора: перчатка летит сразу, урон и эффекты — у цели (PUNCH_DECIDE_MS). К этому моменту детектор
 * видит, удар это или мах руками (confirm): мах урона не наносит, но тратит выносливость. Повтор движка —
 * только подсказки.
 */
function onPunches(list: ReturnType<PunchDetector['update']>): void {
  if (!match || page !== 'arena' || app.dataset.phase !== 'fight' || meIsDown) return;
  for (const p of list) {
    punches[p.side] = { start: p.t, low: p.low, hook: p.hook };
    // Бот видит начало удара — может уйти (уклон, нырок, отход) до касания.
    match.incoming(performance.now(), p.side, p.low);
    const clean = p.t - lastFormErrorAt > FLAWED_MS;
    setTimeout(() => {
      if (page !== 'arena' || app.dataset.phase !== 'fight' || !match) return;
      const now = performance.now();
      if (punchDetector.confirm(p.side, p.t)) onPunch(now, clean, p.side, p.low);
      else onSwing(now);
    }, PUNCH_DECIDE_MS);
  }
}

/** Мах руками, а не удар: урона нет, силы тратятся, подсказка — как бить. */
function onSwing(now: number): void {
  match?.swing(now);
  fightSfx.whoosh(false);
  if (now - swingHintAt > SWING_HINT_EVERY_MS) {
    swingHintAt = now;
    floater(ui.floatBot, 'Мах', 'floater--word');
    hint('Это мах, а не удар — бей прямо вперёд от подбородка и возвращай руку', 'bad');
  }
}

/** Ты на настиле: обе кисти выше носа ARMS_UP_MS подряд — встаёшь (если рефери уже досчитал до двух). */
function checkArmsUp(lm: Landmark[], now: number): void {
  const nose = lm[0];
  const l = lm[15];
  const r = lm[16];
  const up = !!nose && !!l && !!r && l.v > 0.4 && r.v > 0.4 && l.y < nose.y && r.y < nose.y;
  if (!up) {
    armsUpSince = 0;
    return;
  }
  armsUpSince ||= now;
  if (now - armsUpSince >= ARMS_UP_MS) tryGetUp(now);
}

function tryGetUp(now: number): void {
  if (!match || !meIsDown) return;
  if (match.getUp(now)) {
    armsUpSince = 0;
    // События (подъём) отдаст tick этого же кадра.
  }
}

/** Подпись над ботом для особых попаданий. */
const PUNCH_WORD: Partial<Record<PunchResult['kind'], string>> = {
  open: 'Открылся!',
  counter: 'Контратака!',
  interrupt: 'Поймал на замахе!',
  body: 'В корпус!',
};

/** Твой удар — касание перчатки. */
function onPunch(now: number, clean: boolean, side: Side, low: boolean): void {
  const r = match?.punch(now, clean, low);
  if (!r) return;
  lastActionAt = now;
  if (r.kind === 'miss') {
    // Бот ушёл: перчатка в воздух, трибуны ахают.
    fightSfx.whoosh(false);
    floater(ui.floatBot, 'Мимо!', 'floater--word');
    crowdSfx.ooh(0.3);
    ui.combo.hidden = true;
    return;
  }
  if (r.blocked) {
    botBlockedAt = now;
    fightSfx.blockedByBot();
    floater(ui.floatBot, 'Блок', 'floater--word');
  } else {
    botHurt = { at: now, side, low };
    const heavy = r.kind === 'interrupt' ? 1 : r.kind === 'counter' ? 0.7 : r.kind === 'open' ? 0.45 : 0.3;
    if (r.kind === 'body') fightSfx.body();
    else fightSfx.punch(r.combo, heavy);
    floater(ui.floatBot, `-${r.damage}`, r.combo >= 3 || heavy >= 0.7 ? 'floater--big' : 'floater--dmg');
    const word = PUNCH_WORD[r.kind];
    if (word) floater(ui.floatBot, word, 'floater--word floater--good');
    flash(ui.sideBot, 'is-hit', 300);
    // Трибуны: сорванный замах — рёв и залп вспышек, контратака и серия — рёв, просто попадание — «оох».
    if (r.kind === 'interrupt') {
      crowdSfx.roar(0.9);
      fpv?.crowd(1);
      fpv?.photoBurst(1400);
    } else if (r.kind === 'counter' || r.combo >= 3) {
      crowdSfx.roar(0.55);
      fpv?.crowd(0.75);
      fpv?.photoBurst(700);
    } else if (r.combo >= 2 || r.kind === 'open' || Math.random() < 0.35) {
      crowdSfx.ooh(0.35 + Math.min(0.4, r.combo * 0.1));
      fpv?.crowd(0.5);
    }
  }
  if (r.combo >= 2) {
    ui.comboNum.textContent = `×${r.combo}`;
    ui.combo.hidden = false;
    pop(ui.combo);
  }
  // Нокдаун и нокаут — событиями матча (onFightEvent), там же звук и трибуны.
}

/** Событие матча (из tick). */
function onFightEvent(e: FightEvent, now: number): void {
  switch (e.type) {
    case 'phase':
      onPhase(e.phase, e.round);
      break;
    case 'bot_state':
      botView = { state: e.state, since: e.at, until: e.until, attack: e.attack, dodge: e.dodge };
      // Знак «!» — пока бот замахивается; мощный — крупнее.
      ui.sideBot.classList.toggle('is-windup', e.state === 'windup');
      ui.sideBot.classList.toggle('is-power', e.state === 'windup' && e.attack?.kind === 'power');
      if (e.state === 'strike') fightSfx.whoosh(e.attack?.kind === 'power');
      if (e.state === 'stagger') fpv?.crowd(0.8);
      break;
    case 'bot_windup':
      if (e.kind === 'power') crowdSfx.ooh(0.25);
      break;
    case 'bot_hit': {
      lastActionAt = now;
      const power = e.kind === 'power';
      if (e.result === 'landed') {
        knock = { at: now, side: e.side, power };
        floater(meFloats(), `-${e.damage}`, 'floater--hurt');
        flash(ui.sideMe, 'is-hurt', 400);
        flash(app, 'is-shake', 300);
        if (power) {
          // Мощный: вспышка, в глазах мутнеет, звук глохнет, трибуны ахают и ревут.
          fightSfx.heavyHurt();
          flash(app, 'is-dazed', DAZE_MS);
          crowdSfx.gasp(0.9);
          crowdSfx.roar(0.6);
          fpv?.crowd(0.9);
          fpv?.photoBurst(1200);
          if (!e.ko) hint('Мощный видно по замаху — уклонись или поймай его ударом', 'bad');
        } else {
          fightSfx.hurt();
          crowdSfx.gasp(0.4);
          fpv?.crowd(0.45);
          if (!e.ko) hint('Закройся: кулаки у подбородка', 'bad');
        }
      } else if (e.result === 'blocked') {
        fightSfx.guard(power);
        shake(now, power ? SHAKE_BLOCK_MS * 1.8 : SHAKE_BLOCK_MS);
        floater(meFloats(), 'Блок', 'floater--word');
        flash(ui.sideMe, 'is-guard', 300);
        if (power) crowdSfx.ooh(0.3);
      } else {
        fightSfx.dodge();
        floater(meFloats(), 'Уклон!', 'floater--word floater--good');
        flash(ui.sideMe, 'is-dodge', 300);
        crowdSfx.ooh(power ? 0.55 : 0.3);
        fpv?.crowd(power ? 0.6 : 0.35);
        hint('Он провалился — бей!', 'ok');
      }
      break;
    }
    case 'knockdown':
      onKnockdown(e.who, now);
      break;
    case 'count':
      // Рефери считает вслух.
      say(numberWord(e.n), 'count');
      fightSfx.tick();
      break;
    case 'getup':
      if (e.who === 'me') {
        meUpAt = now;
        hint('Встал! Закройся и приди в себя', 'ok');
      } else {
        ui.sideBot.classList.remove('is-ko');
        hint('Он встал — добивай, пока шатается!', 'ok');
      }
      crowdSfx.roar(0.6);
      fpv?.crowd(0.7);
      break;
    case 'round_end': {
      ui.kd.hidden = true;
      if (e.why === 'ko') {
        banner(
          'Нокаут!',
          e.winner === 'me' ? 'Ты победил нокаутом' : 'Ты не встал до десяти',
          e.winner === 'me' ? 'win' : 'ko',
        );
        say('Нокаут!');
      } else {
        const sub =
          e.winner === 'me'
            ? 'Раунд за тобой по очкам'
            : e.winner === 'bot'
              ? 'Раунд за ботом по очкам'
              : 'Раунд вничью';
        banner('Время!', sub, e.winner === 'me' ? 'win' : e.winner === 'bot' ? 'ko' : '');
        say('Время!');
      }
      fightSfx.bell(3);
      crowdSfx.applause(e.why === 'ko' ? 6 : 4, e.why === 'ko' ? 1 : 0.7);
      fpv?.crowd(e.why === 'ko' ? 1 : 0.6);
      break;
    }
    case 'over':
      break;
  }
}

/** Смена фазы матча: движок считает удары только в раунде. */
function onPhase(phase: FightSnapshot['phase'], round: number): void {
  app.dataset.phase = phase;
  switch (phase) {
    case 'intro':
      ui.tips.hidden = true;
      ui.combo.hidden = true;
      ui.kd.hidden = true;
      ui.sideBot.classList.remove('is-ko');
      app.classList.remove('is-down', 'is-tired');
      meDownAt = meUpAt = -Infinity;
      meIsDown = false;
      botView = BOT_IDLE;
      knock = null;
      paintRounds(round);
      banner(`Раунд ${round}`, '', '');
      fightSfx.bell();
      say(`Раунд ${numberWord(round)}`);
      break;
    case 'fight':
      // Кулак не проверяем: удары считает детектор, а модель кистей ждала бы видеокарту, занятую 3D-рингом.
      engine?.setMode({ exercise: 'boxing', targetReps: ENGINE_TARGET, hands: false });
      lastActionAt = performance.now();
      banner('Бой!', '', 'fight');
      fightSfx.go();
      crowdSfx.roar(0.5);
      fpv?.crowd(0.6);
      say('Бой!');
      setTimeout(() => {
        if (app.dataset.phase === 'fight') ui.banner.hidden = true;
      }, 900);
      break;
    case 'round_over':
      engine?.setMode('menu');
      ui.combo.hidden = true;
      ui.hintBox.hidden = true;
      errorJoints = new Set();
      break;
    case 'over':
      engine?.setMode('menu');
      crowdSfx.stop();
      if (match) showResult(match.snapshot(performance.now()));
      break;
    case 'prep':
      break;
  }
}

function showResult(s: FightSnapshot): void {
  const how = s.koWinner ? ' нокаутом' : s.outcome === 'draw' ? '' : ' по очкам';
  const title = s.gaveUp
    ? 'Ты сдался'
    : s.outcome === 'win'
      ? `Победа${how}`
      : s.outcome === 'lose'
        ? s.koWinner
          ? 'Нокаут'
          : 'Поражение по очкам'
        : 'Ничья';
  ui.resultTitle.textContent = title;
  ui.resultMe.textContent = String(s.winsMe);
  ui.resultBot.textContent = String(s.winsBot);
  ui.resultBotName.textContent = bot.name;
  app.dataset.outcome = s.outcome ?? '';
  const st = s.stats;
  ui.resultNote.textContent = s.gaveUp
    ? 'Сдача считается поражением.'
    : s.outcome === 'win'
      ? `Бот «${bot.name}» повержен. Попробуй соперника посильнее?`
      : s.outcome === 'lose'
        ? 'Закрывайся, когда бот замахивается, бей сериями и не трать силы на махи — реванш?'
        : 'Поровну — реванш?';
  const stat = (label: string, value: string | number) => {
    const d = document.createElement('div');
    const dt = document.createElement('dt');
    dt.textContent = label;
    const dd = document.createElement('dd');
    dd.textContent = String(value);
    d.append(dd, dt);
    return d;
  };
  ui.resultStats.replaceChildren(
    stat('ударов дошло', st.landed),
    stat('нокдаунов', `${st.kdScored} : ${st.kdTaken}`),
    stat('лучшая серия', `×${st.bestCombo}`),
    stat('блоков и уклонов', st.blocked + st.dodged),
  );
  show('result');
  if (s.outcome === 'win') fightSfx.fanfare();
  say(title);
}

// ——— Кадр ———
function frame(): void {
  requestAnimationFrame(frame);
  const now = performance.now();
  if (match && page === 'arena') {
    for (const e of match.tick(now)) onFightEvent(e, now);
    if (page === 'arena') render(match.snapshot(now), now);
  }
  crowdSfx.update(now);
  if (page === 'arena' && now > hintUntil && !ui.hintBox.hidden) {
    ui.hintBox.hidden = true;
    errorJoints = new Set();
  }
  draw();
  if (fpv && (page === 'setup' || page === 'arena' || page === 'result')) renderFpv(now);
}

function shake(now: number, ms: number): void {
  shakeAt = now;
  shakeMs = ms;
}

/** Кадр от первого лица: что делает бот, его реакции, нокдаун, перчатки, камера за корпусом. */
function renderFpv(now: number): void {
  const since = (t: number, ms: number) => Math.max(0, Math.min(1, (now - t) / ms));
  const shk = now - shakeAt < shakeMs ? 1 - since(shakeAt, shakeMs) : 0;
  const bv = page === 'arena' ? botView : BOT_IDLE;
  const rules = match?.rules ?? FIGHT_RULES;
  // Бот падает навзничь за kdFallMs и встаёт за getUpMs.
  const botKo =
    bv.state === 'down'
      ? since(bv.since, rules.kdFallMs)
      : bv.state === 'getup'
        ? 1 - since(bv.since, rules.getUpMs)
        : 0;
  // Ты: падаешь на канву и встаёшь.
  const meDown = meIsDown
    ? since(meDownAt, ME_FALL_MS)
    : meUpAt > meDownAt
      ? 1 - since(meUpAt, ME_RISE_MS)
      : 0;
  const s = match && page === 'arena' ? match.snapshot(now) : null;
  fpv!.render({
    now,
    bot: bv,
    botHurt,
    botBlockedAt,
    botKo,
    meDown,
    tired: s ? Math.max(0, Math.min(1, (TIRED_AT - s.staminaMe) / TIRED_AT)) : 0,
    gloves: gloves.read(now),
    shiftX: shift.x,
    shiftY: shift.y,
    shake: shk,
    knock,
    punches,
  });
}

function render(s: FightSnapshot, now: number): void {
  // Что делает бот и куда идёт по рингу — из снимка каждый кадр (после нокаута — лежит).
  if (s.phase === 'fight' || s.bot.state === 'down') botView = s.bot;
  if (s.phase === 'prep') {
    const left = Math.ceil(s.prepLeftMs / 1000);
    if (left !== shown.second) {
      shown.second = left;
      ui.banner.hidden = false;
      ui.banner.dataset.kind = '';
      ui.bannerBig.textContent = String(left);
      ui.bannerSub.textContent = 'Приготовься';
      pop(ui.bannerBig);
      fightSfx.tick();
      if (left <= 3 && left > 0) say(numberWord(left), 'count');
    }
  }
  if (s.phase !== phaseShown) {
    phaseShown = s.phase;
    shown.second = -1;
  }
  // Здоровье, потерянный в нокдаунах максимум, выносливость, нокдауны.
  const full = match!.rules.hp;
  if (s.hpMe !== shown.hpMe || s.maxHpMe !== shown.maxMe) {
    shown.hpMe = s.hpMe;
    shown.maxMe = s.maxHpMe;
    hp(ui.hpMe, ui.hpMeGhost, ui.hpMeCap, s.hpMe, s.maxHpMe, full);
  }
  if (s.hpBot !== shown.hpBot || s.maxHpBot !== shown.maxBot) {
    shown.hpBot = s.hpBot;
    shown.maxBot = s.maxHpBot;
    hp(ui.hpBot, ui.hpBotGhost, ui.hpBotCap, s.hpBot, s.maxHpBot, full);
  }
  const stMe = Math.round(s.staminaMe);
  if (stMe !== shown.stMe) {
    shown.stMe = stMe;
    ui.stMe.style.width = `${(100 * stMe) / match!.rules.stamina}%`;
  }
  const stBot = Math.round(s.staminaBot);
  if (stBot !== shown.stBot) {
    shown.stBot = stBot;
    ui.stBot.style.width = `${(100 * stBot) / match!.rules.stamina}%`;
  }
  const tiredMe = s.phase === 'fight' && s.staminaMe < TIRED_AT;
  if (tiredMe !== shown.tiredMe) {
    shown.tiredMe = tiredMe;
    ui.stMe.parentElement!.parentElement!.classList.toggle('is-tired', tiredMe);
  }
  // Совсем выдохся — края экрана темнеют в такт сердцу.
  app.classList.toggle('is-tired', tiredMe && s.staminaMe < TIRED_AT / 2);
  const tiredBot = s.phase === 'fight' && s.staminaBot < TIRED_AT;
  if (tiredBot !== shown.tiredBot) {
    shown.tiredBot = tiredBot;
    ui.stBot.parentElement!.parentElement!.classList.toggle('is-tired', tiredBot);
  }
  if (s.phase === 'fight' && !s.down) {
    if (s.staminaMe < TIRED_AT / 2 && now - tiredHintAt > TIRED_HINT_EVERY_MS) {
      tiredHintAt = now;
      hint('Выдохся — удары слабее. Закройся и отдышись', 'bad');
    } else if (s.staminaBot < TIRED_AT / 2 && now - botTiredHintAt > TIRED_HINT_EVERY_MS * 1.5) {
      botTiredHintAt = now;
      hint('Бот выдохся — руки опускает, дави сериями!', 'ok');
    }
  }
  if (s.kdMe !== shown.kdMe) {
    shown.kdMe = s.kdMe;
    kdMark(ui.kdMe, s.kdMe);
  }
  if (s.kdBot !== shown.kdBot) {
    shown.kdBot = s.kdBot;
    kdMark(ui.kdBot, s.kdBot);
  }
  paintDown(s);
  if (s.winsMe !== shown.winsMe || s.winsBot !== shown.winsBot) {
    shown.winsMe = s.winsMe;
    shown.winsBot = s.winsBot;
    paintPips(s.winsMe, s.winsBot);
  }
  if (s.round !== shown.round) {
    shown.round = s.round;
    ui.roundLabel.textContent = s.round ? `Раунд ${s.round} / ${match!.rules.maxRounds}` : 'Подготовка';
    paintRounds(s.round);
  }
  const lastTen = s.phase === 'fight' && s.timeLeftMs <= 10_000;
  if (lastTen && !shown.lastTen) say('Десять секунд!');
  shown.lastTen = lastTen;
  const clock = formatClock(s.phase === 'prep' || s.phase === 'intro' ? match!.rules.roundMs : s.timeLeftMs);
  if (ui.clock.textContent !== clock) ui.clock.textContent = clock;
  ui.clock.classList.toggle('is-last', lastTen);
  fpv?.screen({
    round: s.round ? `РАУНД ${s.round}` : 'ПОДГОТОВКА',
    clock,
    me: Math.round((100 * s.hpMe) / full),
    bot: Math.round((100 * s.hpBot) / full),
    botName: bot.name,
    big:
      s.phase === 'round_over'
        ? s.koWinner
          ? 'НОКАУТ'
          : 'ВРЕМЯ'
        : s.down
          ? `НОКДАУН ${s.down.count || ''}`.trim()
          : undefined,
  });
  // Бой стоит — трибуны недовольны.
  if (s.phase === 'fight' && now - lastActionAt > BOO_IDLE_MS && now - booAt > BOO_EVERY_MS) {
    booAt = now;
    crowdSfx.boo();
  }
  if (s.combo !== shown.combo) {
    shown.combo = s.combo;
    if (s.combo < 2) ui.combo.hidden = true;
  }
  ui.guardPill.hidden = !guardShown || s.phase !== 'fight' || !!s.down;
}

/** Полоса здоровья: значение и потерянный в нокдаунах максимум — в долях полного здоровья. */
function hp(
  fill: HTMLElement,
  ghost: HTMLElement,
  cap: HTMLElement,
  value: number,
  max: number,
  full: number,
): void {
  const pct = `${Math.max(0, Math.min(100, (100 * value) / full))}%`;
  fill.style.width = pct;
  ghost.style.width = pct;
  cap.style.width = `${Math.max(0, Math.min(100, 100 - (100 * max) / full))}%`;
  const share = value / full;
  fill.parentElement!.dataset.level = share <= 0.25 ? 'low' : share <= 0.5 ? 'mid' : 'ok';
}

/** «KD 2» у имени — сколько раз боец был на настиле. */
function kdMark(el: HTMLElement, n: number): void {
  el.hidden = n === 0;
  el.textContent = `KD ${n}`;
  if (n) pop(el);
}

/** Раунды под часами: прошедшие, текущий, оставшиеся. */
function paintRounds(round: number): void {
  const n = match?.rules.maxRounds ?? FIGHT_RULES.maxRounds;
  ui.roundOf.replaceChildren(
    ...Array.from({ length: n }, (_, i) => {
      const d = document.createElement('i');
      if (i + 1 < round) d.className = 'is-done';
      else if (i + 1 === round) d.className = 'is-now';
      return d;
    }),
  );
}

/** Нокдаун: падение — звук, трибуны, вспышки; ты — камера на канву. */
function onKnockdown(who: 'me' | 'bot', now: number): void {
  fightSfx.ko();
  crowdSfx.roar(1);
  crowdSfx.gasp(0.8);
  fpv?.crowd(1);
  fpv?.photoBurst(2500);
  ui.combo.hidden = true;
  ui.hintBox.hidden = true;
  errorJoints = new Set();
  if (who === 'bot') {
    ui.sideBot.classList.add('is-ko');
    say('Нокдаун!');
  } else {
    meDownAt = now;
    meIsDown = true;
    armsUpSince = 0;
    flash(app, 'is-dazed', DAZE_MS);
  }
}

/** Плашка нокдауна: кто на настиле, счёт рефери, как встать. */
function paintDown(s: FightSnapshot): void {
  const d = s.phase === 'fight' ? s.down : null;
  // Нокаутировали тебя — так и лежишь до итогов.
  const meDown = d?.who === 'me' || (meIsDown && s.koWinner === 'bot');
  if (meIsDown && !meDown) meIsDown = false;
  app.classList.toggle('is-down', meDown);
  const key = d ? `${d.who}:${d.count}:${d.canGetUp}` : '';
  if (key === shown.down) return;
  const countChanged = d && shown.down.split(':')[1] !== String(d.count);
  shown.down = key;
  ui.kd.hidden = !d;
  if (!d) {
    ui.kdUp.hidden = true;
    return;
  }
  ui.kd.dataset.who = d.who;
  ui.kdLabel.textContent = d.who === 'me' ? 'Ты в нокдауне' : 'Нокдаун!';
  ui.kdCount.textContent = d.count ? String(d.count) : '';
  if (countChanged && d.count) pop(ui.kdCount);
  ui.kdSub.textContent =
    d.who === 'bot'
      ? 'Бот на настиле — рефери считает'
      : d.canGetUp
        ? 'Подними обе руки над головой — встань!'
        : 'Приходи в себя…';
  ui.kdUp.hidden = !(d.who === 'me' && d.canGetUp);
}

function paintPips(me: number, botWins: number): void {
  const n = match?.rules.roundsToWin ?? 2;
  const make = (wins: number) =>
    Array.from({ length: n }, (_, i) => {
      const p = document.createElement('i');
      if (i < wins) p.className = 'is-on';
      return p;
    });
  ui.pipsMe.replaceChildren(...make(me));
  ui.pipsBot.replaceChildren(...make(botWins));
}

function banner(big: string, sub: string, kind: string): void {
  ui.banner.hidden = false;
  ui.banner.dataset.kind = kind;
  ui.bannerBig.textContent = big;
  ui.bannerSub.textContent = sub;
  pop(ui.bannerBig);
}

function hint(text: string, kind: 'ok' | 'bad'): void {
  ui.hint.textContent = text;
  ui.hintBox.dataset.kind = kind;
  ui.hintBox.hidden = false;
  hintUntil = performance.now() + HINT_MS;
}

/** Твои числа и слова — посреди экрана: окошко камеры маленькое. */
function meFloats(): HTMLElement {
  return ui.floatBot;
}

/** Летящее число или слово над бойцом. */
function floater(host: HTMLElement, text: string, cls: string): void {
  const el = document.createElement('span');
  el.className = `floater ${cls}`;
  el.textContent = text;
  el.style.left = `${42 + Math.random() * 16}%`;
  el.style.top = `${38 + Math.random() * 16}%`;
  host.append(el);
  setTimeout(() => el.remove(), 950);
  // Не копим мусор, если кадров много.
  while (host.childElementCount > 8) host.firstElementChild?.remove();
}

const flashTimers = new Map<string, number>();
function flash(el: HTMLElement, cls: string, ms: number): void {
  const key = `${el.id || el.className}:${cls}`;
  el.classList.remove(cls);
  void el.offsetWidth;
  el.classList.add(cls);
  clearTimeout(flashTimers.get(key));
  flashTimers.set(
    key,
    window.setTimeout(() => el.classList.remove(cls), ms),
  );
}

function pop(el: HTMLElement): void {
  el.classList.remove('pop');
  void el.offsetWidth;
  el.classList.add('pop');
}

function draw(): void {
  const W = canvas.clientWidth;
  const H = canvas.clientHeight;
  if (!W || !H) return;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) {
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);
  if (!lastLandmarks || page === 'menu' || page === 'result') return;
  const image = lastImage && lastImage.width > 0 && performance.now() - lastFrameAt < 700 ? lastImage : null;
  const view = coverView(
    W,
    H,
    image?.width ?? (video.videoWidth || 1280),
    image?.height ?? (video.videoHeight || 720),
    true,
  );
  if (image) {
    ctx.save();
    ctx.translate(W, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(image, view.ox, view.oy, view.dw, view.dh);
    ctx.restore();
  }
  drawSkeleton(ctx, view, lastLandmarks, {
    color: guardShown ? COLORS.info : COLORS.good,
    glow: guardShown ? COLORS.info : COLORS.good,
    errorJoints,
    pulse: (Math.sin(performance.now() / 120) + 1) / 2,
  });
}

// ——— Мелочи ———
async function keepScreenOn(): Promise<void> {
  try {
    const nav = navigator as Navigator & {
      wakeLock?: { request(type: 'screen'): Promise<{ release(): Promise<void> }> };
    };
    wakeLock ??= (await nav.wakeLock?.request('screen')) ?? null;
  } catch {
    /* экран может погаснуть — не критично */
  }
}

document.addEventListener('pointerdown', unlock, { once: true });
window.addEventListener('pagehide', () => {
  engine?.stop();
  void wakeLock?.release();
});

// Для проверок в dev (скрипты Playwright): window.__fight() — текущий матч. В сборку не попадает.
if (import.meta.env.DEV) (window as unknown as { __fight?: () => FightMatch | null }).__fight = () => match;

show('menu');
requestAnimationFrame(frame);
if (!params.has('mock')) prefetchPoseAssetsWhenIdle();
