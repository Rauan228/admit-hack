// E-36: бокс с ботом — отдельная страница /fight.html (без React и экранов платформы), как дуэль.
// Файтинг на широком экране: слева ты (камера и скелет), справа бот (3D-атлет), сверху здоровье.
// Экраны: menu (выбор бота) → setup (камера) → arena (подготовка 5 с → раунды) → result.
// Время, здоровье и исход — в FightMatch; стойка (блок, уклон) — StanceTracker; здесь движок, DOM и звук.
// Два вида: «от первого лица» (fpv.ts — 3D-ринг, камера в игре — твоя голова, внизу твои перчатки, твоя
// камера — в углу) и «сбоку» (ты слева, бот справа). Логика боя у них общая.
// Для проверок: ?mock=1 (мок-движок), ?bot=machine, ?view=side|fpv.

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
import { mountGhost, type GhostMount } from '../duel/ghost';
import { formatClock } from '../duel/match';
import {
  FIGHT_BOTS,
  FightMatch,
  findFightBot,
  type FightBot,
  type FightEvent,
  type FightSnapshot,
} from './fight';
import type { FpvView } from './fpv';
import { FRAMING_HINT, GloveTracker, framing, type Framing } from './gloves';
import { fightSfx, unlockFightAudio } from './sfx';
import { StanceTracker } from './stance';

type Screen = 'menu' | 'setup' | 'arena' | 'result';
type View = 'fpv' | 'side';

/** Потолок подхода для движка: раунд держит таймер страницы, не цель по ударам. */
const ENGINE_TARGET = 1000;
const HINT_MS = 2200;
/** Удар бота на экране: от замаха до касания — windupMs матча, сам удар и возврат в стойку. */
const HIT_MS = 110;
const RECOVER_MS = 320;
/** Кадры эталона бокса (athleteMotion.json, 2,4 с): джеб левой и кросс правой — стойка, пик, возврат в стойку. */
const SWING = {
  left: { start: 0, peak: 240, end: 600 },
  right: { start: 960, peak: 1200, end: 1560 },
} as const;
/** Бот стоит почти боком и смотрит на тебя — влево. */
const BOT_YAW = -1.0;
/** От первого лица: отдача бота от твоего удара, тряска камеры, падение при нокауте, мс. */
const RECOIL_MS = 260;
const SHAKE_HIT_MS = 380;
const SHAKE_BLOCK_MS = 180;
const KO_FALL_MS = 900;
const VIEW_KEY = 'forma.fight.view.v1';
/** Кадр плохой дольше — подсказка; в бою повторяем не чаще. */
const FRAMING_BAD_MS = 1200;
const FRAMING_HINT_EVERY_MS = 4000;
const BOT_ABOUT: Record<FightBot['id'], string> = {
  novice: 'Редкие атаки, почти не блокирует',
  athlete: 'Держит темп, каждый пятый удар — в блок',
  machine: 'Бьёт без пауз, блокирует почти половину',
};

const params = new URLSearchParams(location.search);
const MOBILE = isMobileDevice();
let view: View = readView();

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
  pipsMe: $<HTMLSpanElement>('pips-me'),
  pipsBot: $<HTMLSpanElement>('pips-bot'),
  clock: $<HTMLSpanElement>('clock'),
  roundLabel: $<HTMLSpanElement>('round-label'),
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
let seen: boolean | null = null;
let wakeLock: { release(): Promise<void> } | null = null;
const stance = new StanceTracker();
let guardShown = false;
let shown = {
  hpMe: -1,
  hpBot: -1,
  second: -1,
  combo: -1,
  round: -1,
  lastTen: false,
  winsMe: -1,
  winsBot: -1,
};
let botGhost: GhostMount | null = null;
let menuGhost: GhostMount | null = null;
/** Анимация бота: стойка, замах, удар, возврат. */
let botAnim: { kind: 'idle' | 'windup' | 'hit' | 'recover'; since: number; side: 'left' | 'right' } = {
  kind: 'idle',
  since: 0,
  side: 'left',
};
let botAnimGen = 0;
/** Вид от первого лица: сцена (отдельный чанк three.js), перчатки, сдвиг корпуса, эффекты. */
let fpv: FpvView | null = null;
let fpvLoading: Promise<void> | null = null;
const gloves = new GloveTracker();
let shift = { x: 0, y: 0 };
let recoilAt = -Infinity;
let shakeAt = -Infinity;
let shakeMs = 0;
let koAt = -Infinity;
let frameIs: Framing = 'none';
let frameBadSince = 0;
let frameHintAt = -Infinity;

function readView(): View {
  const q = params.get('view');
  if (q === 'fpv' || q === 'side') return q;
  try {
    const v = localStorage.getItem(VIEW_KEY);
    if (v === 'fpv' || v === 'side') return v;
  } catch {
    /* без хранилища — по умолчанию */
  }
  return 'fpv';
}

function setView(next: View): void {
  view = next;
  app.dataset.view = next;
  try {
    localStorage.setItem(VIEW_KEY, next);
  } catch {
    /* не запомним — не страшно */
  }
  for (const b of document.querySelectorAll<HTMLButtonElement>('[data-view-pick]')) {
    const on = b.dataset.viewPick === next;
    b.classList.toggle('is-active', on);
    b.setAttribute('aria-checked', String(on));
  }
}
for (const b of document.querySelectorAll<HTMLButtonElement>('[data-view-pick]')) {
  b.addEventListener('click', () => setView(b.dataset.viewPick as View));
}
setView(view);

/** Сцена от первого лица: грузим three.js и модель один раз, при первом входе в бой. */
function ensureFpv(): void {
  if (fpv || fpvLoading) return;
  fpvLoading = import('./fpv')
    .then((m) => {
      fpv = new m.FpvView($<HTMLCanvasElement>('fpv'), MOBILE);
    })
    .catch((err) => {
      // Без WebGL — вид сбоку, он работает и на 2D.
      console.error('[fight] вид от первого лица не запустился', err);
      setView('side');
      mountBotGhost();
    })
    .finally(() => {
      fpvLoading = null;
    });
}

function mountBotGhost(): void {
  botGhost ??= mountGhost($('bot-ghost'), { exercise: 'boxing', yaw: BOT_YAW, clock: botClock });
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
      stat.textContent = `${b.attacksPerMin} атак/мин · урон ${b.damage}`;
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
menuGhost = mountGhost($('menu-ghost'), { exercise: 'boxing', yaw: 0.9 });

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
  if (next === 'menu') menuGhost?.set({ exercise: 'boxing' });
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
    ui.start.disabled = false;
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
  seen = null;
  frameIs = 'none';
  engine?.setMode('menu');
  ui.start.disabled = !engineReady;
  ui.setupMeta.textContent = `Против бота «${bot.name}» · до двух побед, раунд 45 с`;
  if (view === 'fpv') ensureFpv();
  else mountBotGhost();
  botAnim = { kind: 'idle', since: performance.now(), side: 'left' };
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
      if (view === 'fpv') checkFraming(framing(e.landmarks, aspect), now);
      else if (page === 'setup' && engineReady && e.landmarks.length > 0 !== seen) {
        seen = e.landmarks.length > 0;
        if (seen) setStatus('Вижу тебя — кулаки к подбородку', 'ok');
        else setStatus('Тебя не видно — встань так, чтобы в кадре были голова, плечи и пояс.', 'bad');
      }
      const st = stance.update(e.landmarks, now, aspect);
      shift = { x: st.shiftX, y: st.shiftY };
      gloves.update(e.landmarks, now, aspect);
      match?.setGuard(now, st.guard);
      if (st.dodge) match?.dodge(now);
      if (st.guard !== guardShown) {
        guardShown = st.guard;
        ui.guardPill.hidden = !st.guard || page !== 'arena';
      }
      break;
    }
    case 'calibration':
      if (page === 'setup' && view === 'fpv') break; // от первого лица кадр проверяет checkFraming
      if (page === 'setup') {
        if (e.status === 'ok') setStatus('Вижу тебя — кулаки к подбородку', 'ok');
        else setStatus(e.hint, 'bad');
      } else if (page === 'arena' && e.status !== 'ok' && app.dataset.phase === 'fight') hint(e.hint, 'bad');
      break;
    case 'gesture':
      if (page === 'setup' && engineReady && !ui.start.disabled) startMatch();
      else if (page === 'result') startMatch();
      break;
    case 'rep':
      onPunch(now, e.errors.length === 0);
      break;
    case 'form_error':
      if (page !== 'arena') break;
      hint(e.message, 'bad');
      errorJoints = new Set(e.joints);
      break;
    case 'form_ok':
      errorJoints = new Set();
      break;
  }
}

/**
 * От первого лица удар виден по локтям: просим встать так, чтобы они были в кадре. На подготовке — статус
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
  shown = { hpMe: -1, hpBot: -1, second: -1, combo: -1, round: -1, lastTen: false, winsMe: -1, winsBot: -1 };
  errorJoints = new Set();
  ui.hudBot.textContent = bot.name;
  ui.sideBot.classList.remove('is-ko', 'is-windup');
  ui.floatMe.replaceChildren();
  ui.floatBot.replaceChildren();
  botAnim = { kind: 'idle', since: performance.now(), side: 'left' };
  koAt = -Infinity;
  recoilAt = -Infinity;
  engine?.setMode('menu');
  show('arena');
  app.dataset.phase = 'prep';
  paintPips(0, 0);
  ui.tips.hidden = false;
  say('Приготовься');
}

ui.start.addEventListener('click', () => {
  if (engineReady) startMatch();
});
ui.giveUp.addEventListener('click', () => match?.giveUp(performance.now()));
$<HTMLButtonElement>('again').addEventListener('click', startMatch);
$<HTMLButtonElement>('change').addEventListener('click', () => {
  match = null;
  engine?.setMode('menu');
  show('menu');
});

/** Твой удар (rep движка). */
function onPunch(now: number, clean: boolean): void {
  const r = match?.punch(now, clean);
  if (!r) return;
  gloves.punch(now);
  if (!r.blocked) recoilAt = now;
  if (r.blocked) {
    fightSfx.blockedByBot();
    floater(ui.floatBot, 'Блок', 'floater--word');
  } else {
    fightSfx.punch(r.combo);
    floater(ui.floatBot, `-${r.damage}`, r.combo >= 3 ? 'floater--big' : 'floater--dmg');
    flash(ui.sideBot, 'is-hit', 300);
  }
  if (r.combo >= 2) {
    ui.comboNum.textContent = `×${r.combo}`;
    ui.combo.hidden = false;
    pop(ui.combo);
  }
  if (r.ko) {
    koAt = now;
    ui.sideBot.classList.add('is-ko');
    fightSfx.ko();
  }
}

/** Событие матча (из tick). */
function onFightEvent(e: FightEvent, now: number): void {
  switch (e.type) {
    case 'phase':
      onPhase(e.phase, e.round);
      break;
    case 'bot_windup':
      ui.sideBot.classList.add('is-windup');
      botAnim = { kind: 'windup', since: now, side: e.side };
      fightSfx.whoosh();
      break;
    case 'bot_hit': {
      ui.sideBot.classList.remove('is-windup');
      const gen = ++botAnimGen;
      botAnim = { kind: 'hit', since: now, side: botAnim.side };
      setTimeout(() => {
        if (gen !== botAnimGen) return;
        botAnim = { kind: 'recover', since: performance.now(), side: botAnim.side };
        setTimeout(() => {
          if (gen === botAnimGen) botAnim = { kind: 'idle', since: performance.now(), side: botAnim.side };
        }, RECOVER_MS);
      }, HIT_MS);
      if (e.result === 'landed') {
        fightSfx.hurt();
        floater(meFloats(), `-${e.damage}`, 'floater--hurt');
        flash(ui.sideMe, 'is-hurt', 400);
        flash(app, 'is-shake', 300);
        shake(now, SHAKE_HIT_MS);
        if (!e.ko) hint('Закройся: кулаки у подбородка', 'bad');
      } else if (e.result === 'blocked') {
        fightSfx.guard();
        shake(now, SHAKE_BLOCK_MS);
        floater(meFloats(), 'Блок', 'floater--word');
        flash(ui.sideMe, 'is-guard', 300);
      } else {
        fightSfx.dodge();
        floater(meFloats(), 'Уклон!', 'floater--word floater--good');
        flash(ui.sideMe, 'is-dodge', 300);
      }
      if (e.ko) fightSfx.ko();
      break;
    }
    case 'round_end': {
      const sub = e.winner === 'me' ? 'Раунд за тобой' : e.winner === 'bot' ? 'Раунд за ботом' : 'Поровну';
      if (e.why === 'ko') {
        banner('Нокаут!', sub, e.winner === 'me' ? 'win' : 'ko');
        say('Нокаут!');
      } else {
        banner('Время!', sub, e.winner === 'me' ? 'win' : e.winner === 'bot' ? 'ko' : '');
        say('Время!');
      }
      fightSfx.bell();
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
      ui.sideBot.classList.remove('is-ko');
      koAt = -Infinity;
      botAnim = { kind: 'idle', since: performance.now(), side: 'left' };
      banner(`Раунд ${round}`, '', '');
      fightSfx.bell();
      say(`Раунд ${numberWord(round)}`);
      break;
    case 'fight':
      engine?.setMode({ exercise: 'boxing', targetReps: ENGINE_TARGET });
      banner('Бой!', '', 'fight');
      fightSfx.go();
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
      if (match) showResult(match.snapshot(performance.now()));
      break;
    case 'prep':
      break;
  }
}

function showResult(s: FightSnapshot): void {
  const title = s.gaveUp
    ? 'Ты сдался'
    : s.outcome === 'win'
      ? 'Победа'
      : s.outcome === 'lose'
        ? 'Поражение'
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
        ? 'Закрывайся, когда бот замахивается, и бей сериями — реванш?'
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
    stat('лучшая серия', `×${st.bestCombo}`),
    stat('блоков', st.blocked),
    stat('уклонов', st.dodged),
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
  if (page === 'arena' && now > hintUntil && !ui.hintBox.hidden) {
    ui.hintBox.hidden = true;
    errorJoints = new Set();
  }
  draw();
  if (view === 'fpv' && fpv && (page === 'setup' || page === 'arena' || page === 'result')) renderFpv(now);
}

function shake(now: number, ms: number): void {
  shakeAt = now;
  shakeMs = ms;
}

/** Кадр от первого лица: поза и выпад бота, отдача, нокаут, перчатки, камера за корпусом. */
function renderFpv(now: number): void {
  const since = (t: number, ms: number) => Math.max(0, Math.min(1, (now - t) / ms));
  const recoil = now - recoilAt < RECOIL_MS ? 1 - since(recoilAt, RECOIL_MS) : 0;
  const shk = now - shakeAt < shakeMs ? 1 - since(shakeAt, shakeMs) : 0;
  fpv!.render({
    botT: botClock(),
    botLunge: botLunge(now),
    botRecoil: recoil * recoil,
    botKo: koAt > -Infinity ? since(koAt, KO_FALL_MS) : 0,
    gloves: gloves.read(now),
    shiftX: shift.x,
    shiftY: shift.y,
    shake: shk,
  });
}

/** Шаг бота в удар: на замахе откидывается, в ударе — к тебе, потом обратно. */
function botLunge(now: number): number {
  const u = (ms: number) => Math.max(0, Math.min(1, (now - botAnim.since) / ms));
  switch (botAnim.kind) {
    case 'idle':
      return 0;
    case 'windup': {
      const k = u(match?.rules.windupMs ?? 700);
      return -0.2 * k * k;
    }
    case 'hit':
      return -0.2 + 1.2 * u(HIT_MS);
    case 'recover':
      return 1 - u(RECOVER_MS);
  }
}

function render(s: FightSnapshot, now: number): void {
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
  // Здоровье.
  if (s.hpMe !== shown.hpMe) {
    shown.hpMe = s.hpMe;
    hp(ui.hpMe, ui.hpMeGhost, s.hpMe);
  }
  if (s.hpBot !== shown.hpBot) {
    shown.hpBot = s.hpBot;
    hp(ui.hpBot, ui.hpBotGhost, s.hpBot);
  }
  if (s.winsMe !== shown.winsMe || s.winsBot !== shown.winsBot) {
    shown.winsMe = s.winsMe;
    shown.winsBot = s.winsBot;
    paintPips(s.winsMe, s.winsBot);
  }
  if (s.round !== shown.round) {
    shown.round = s.round;
    ui.roundLabel.textContent = s.round ? `Раунд ${s.round}` : 'Подготовка';
  }
  const lastTen = s.phase === 'fight' && s.timeLeftMs <= 10_000;
  if (lastTen && !shown.lastTen) say('Десять секунд!');
  shown.lastTen = lastTen;
  const clock = formatClock(s.phase === 'prep' || s.phase === 'intro' ? match!.rules.roundMs : s.timeLeftMs);
  if (ui.clock.textContent !== clock) ui.clock.textContent = clock;
  ui.clock.classList.toggle('is-last', lastTen);
  if (s.combo !== shown.combo) {
    shown.combo = s.combo;
    if (s.combo < 2) ui.combo.hidden = true;
  }
  if (!s.windup && botAnim.kind === 'windup' && now - botAnim.since > match!.rules.windupMs + 400) {
    botAnim = { kind: 'idle', since: now, side: botAnim.side };
  }
  ui.guardPill.hidden = !guardShown || s.phase !== 'fight';
}

function hp(fill: HTMLElement, ghost: HTMLElement, value: number): void {
  const pct = `${Math.max(0, Math.min(100, value))}%`;
  fill.style.width = pct;
  ghost.style.width = pct;
  fill.parentElement?.classList.toggle('is-low', value > 0 && value <= 25);
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

/** Поза бота для 3D-атлета: момент внутри эталона бокса. */
function botClock(): number {
  const now = performance.now();
  const sw = SWING[botAnim.side];
  const u = (ms: number) => Math.max(0, Math.min(1, (now - botAnim.since) / ms));
  switch (botAnim.kind) {
    case 'idle':
      // Стойка с лёгким покачиванием.
      return sw.start + 25 * (1 + Math.sin(now / 380));
    case 'windup': {
      const k = u(match?.rules.windupMs ?? 700);
      return sw.start + (sw.peak - sw.start) * 0.55 * k * k;
    }
    case 'hit':
      return sw.start + (sw.peak - sw.start) * (0.55 + 0.45 * u(HIT_MS));
    case 'recover':
      return sw.peak + (sw.end - sw.peak) * u(RECOVER_MS);
  }
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

/** Твои числа и слова: от первого лица — посреди экрана (окошко камеры маленькое). */
function meFloats(): HTMLElement {
  return view === 'fpv' ? ui.floatBot : ui.floatMe;
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

show('menu');
requestAnimationFrame(frame);
if (!params.has('mock')) prefetchPoseAssetsWhenIdle();
