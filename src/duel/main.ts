// E-24: дуэль — отдельная страница /duel.html (без React и без экранов платформы).
// Ты против бота, записи друга (E-25) или живого соперника онлайн (E-26) — в любом упражнении дуэли (E-29).
// Экраны: intro → setup (камера, скелет) → countdown → battle → result. Время и счёт — в DuelMatch,
// здесь только движок, DOM и звук. Для проверок: ?mock=1 (мок-движок), ?bot=machine, ?sec=20, ?ex=squat.

import '../ui/styles/global.css';
import './duel.css';
import { CameraError } from '../engine/camera';
import { createEngine } from '../engine/createEngine';
import { prefetchPoseAssetsWhenIdle } from '../engine/pose';
import type { Engine, EngineEvent, Landmark, Phase } from '../engine/types';
import { sfx, unlockAudio } from '../ui/audio/sfx';
import { numberWord, say, unlockVoice } from '../ui/audio/voice';
import { coverView, drawSkeleton } from '../ui/lib/skeleton';
import { COLORS } from '../ui/theme';
import { describeAward } from '../shared/arena';
import type { RoomView } from '../shared/duelRoom';
import { minGapMs, type DuelExercise } from '../shared/duel';
import { botTimeline, botTotal, repsAt } from './bot';
import { setFace } from './face';
import { initLadder } from './ladder';
import { cameraTip, exerciseTitle, formatName, isFloor, repsWord } from './labels';
import { DuelMatch, formatClock, type DuelPhase, type DuelSnapshot } from './match';
import { initOnline, onlineDuel, reconnectOnline } from './online';
import { initPicker, picked } from './picker';
import { initSocial, myFace, openInvite, sendAnswer, type RecordedOpponent } from './social';

type Screen = 'intro' | 'setup' | DuelPhase | 'result';

const COUNTDOWN_MS = 5000;
/** Потолок подхода для движка: бой держит таймер страницы, а не цель по повторам. */
const ENGINE_TARGET = 300;
const HINT_MS = 2500;
const REP_FLASH_MS = 520;

const params = new URLSearchParams(location.search);

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const app = $<HTMLElement>('app');
const video = $<HTMLVideoElement>('video');
const canvas = $<HTMLCanvasElement>('overlay');
const ctx = canvas.getContext('2d')!;
const ui = {
  cameraOn: $<HTMLButtonElement>('camera-on'),
  introError: $<HTMLParagraphElement>('intro-error'),
  setupEx: $<HTMLParagraphElement>('setup-ex'),
  setupMeta: $<HTMLParagraphElement>('setup-meta'),
  setupStatus: $<HTMLParagraphElement>('setup-status'),
  setupHow: $<HTMLParagraphElement>('setup-how'),
  start: $<HTMLButtonElement>('start'),
  countdown: $<HTMLSpanElement>('countdown'),
  countdownText: $<HTMLParagraphElement>('countdown-text'),
  sideMe: $<HTMLDivElement>('side-me'),
  sideOpp: $<HTMLDivElement>('side-opp'),
  scoreMe: $<HTMLSpanElement>('score-me'),
  scoreOpp: $<HTMLSpanElement>('score-opp'),
  meFace: $<HTMLElement>('me-face'),
  meName: $<HTMLSpanElement>('me-name'),
  oppFace: $<HTMLElement>('opp-face'),
  oppName: $<HTMLSpanElement>('opp-name'),
  clock: $<HTMLSpanElement>('clock'),
  hudEx: $<HTMLSpanElement>('hud-ex'),
  lead: $<HTMLParagraphElement>('lead'),
  tugMe: $<HTMLDivElement>('tug-me'),
  hint: $<HTMLParagraphElement>('hint'),
  giveUp: $<HTMLButtonElement>('give-up'),
  resultEx: $<HTMLParagraphElement>('result-ex'),
  resultTitle: $<HTMLHeadingElement>('result-title'),
  resultMe: $<HTMLSpanElement>('result-me'),
  resultOpp: $<HTMLSpanElement>('result-opp'),
  resultMeFace: $<HTMLElement>('result-me-face'),
  resultMeName: $<HTMLElement>('result-me-name'),
  resultOppFace: $<HTMLElement>('result-opp-face'),
  resultOppName: $<HTMLElement>('result-opp-name'),
  resultNote: $<HTMLParagraphElement>('result-note'),
  resultAward: $<HTMLParagraphElement>('result-award'),
  inviteOpen: $<HTMLButtonElement>('invite-open'),
};
$<HTMLAnchorElement>('home').href = import.meta.env.BASE_URL;
$<HTMLAnchorElement>('menu-link').href = `${import.meta.env.BASE_URL}app`;

/** Во что идёт текущий бой и сколько он длится — по режиму: бот, запись друга или онлайн-комната. */
let currentExercise: DuelExercise = 'push_up';
let currentDurationMs = 60_000;
/** Потолок подхода для движка: с запасом больше, чем успеть за бой (3 мин бокса — это сотни ударов, E-30). */
let engineTarget = ENGINE_TARGET;
/** E-25: соперник — запись друга из вызова; null — бот. */
let opponent: RecordedOpponent | null = null;
let engine: Engine | null = null;
let engineReady = false;
let match: DuelMatch | null = null;
let screen: Screen = 'intro';
let skeletonPhase: Phase = 'start';
let errorJoints = new Set<number>();
let hintUntil = 0;
let lastLandmarks: Landmark[] | null = null;
/** Кадр, на котором движок посчитал lastLandmarks (E-23), и когда он пришёл. */
let lastImage: HTMLCanvasElement | null = null;
let lastFrameAt = 0;
/** Человек в кадре (для статуса на экране подготовки); null — ещё не знаем. */
let seen: boolean | null = null;
let shown = { me: -1, opp: -1, second: -1, lastTen: false };
let flashTimer = 0;
let wakeLock: { release(): Promise<void> } | null = null;

// ——— Выбор упражнения, времени и бота ———
initPicker(params, () => undefined);
initLadder();

// ——— Вызовы друзьям (E-25) ———
void initSocial({
  accept(opp) {
    opponent = opp;
    unlockAudio();
    unlockVoice();
    void keepScreenOn();
    if (engine) toSetup();
    else void startEngine();
  },
  accountChanged(why) {
    reconnectOnline(why === 'out');
    paintMe();
  },
  rankChanged() {
    paintMe();
  },
});

// ——— Онлайн-дуэль (E-26): время боя и итог — от сервера ———
/** Итог раунда уже объявлен голосом (объявляем по серверу, а не по своему счёту). */
let announced = false;
/** Раунд, для которого уже показали кубки. Повтор комнаты тот же раунд не стирает строку. */
let awardRound = -1;
initOnline({
  enterRoom() {
    opponent = null;
    void keepScreenOn();
    if (engine) toSetup();
    else void startEngine();
  },
  countdown: startOnlineMatch,
  over: onlineResult,
  award(a) {
    if (!onlineDuel.active() || a.round !== onlineDuel.round()) return;
    awardRound = a.round;
    ui.resultAward.textContent = describeAward(a);
    const opp = onlineDuel.opponent();
    paintMe();
    if (opp) paintOpp(opp.name, opp.frame, opp.title);
  },
  leftRoom() {
    if (screen === 'intro') return;
    match = null;
    engine?.setMode('menu');
    show('intro');
  },
});
// Голос и звук оживают только от касания (Safari): приглашение приходит по сети — страхуемся первым касанием.
document.addEventListener(
  'pointerdown',
  () => {
    unlockAudio();
    unlockVoice();
  },
  { once: true },
);

// ——— Экраны ———
function show(next: Screen): void {
  screen = next;
  app.dataset.screen = next;
  for (const el of app.querySelectorAll<HTMLElement>('[data-for]')) {
    el.hidden = !el.dataset.for!.split(' ').includes(next);
  }
}

/** Что за бой сейчас собираем: упражнение, время и с кем. */
function currentMode(): { exercise: DuelExercise; durationMs: number; meta: string } {
  if (onlineDuel.active()) {
    const ms = onlineDuel.durationMs();
    return { exercise: onlineDuel.exercise(), durationMs: ms, meta: `${formatName(ms)} · онлайн` };
  }
  if (opponent) {
    const ms = opponent.durationMs;
    return {
      exercise: opponent.exercise,
      durationMs: ms,
      meta: `${formatName(ms)} · против записи ${opponent.name}`,
    };
  }
  const p = picked();
  return {
    exercise: p.exercise,
    durationMs: p.durationMs,
    meta: `${formatName(p.durationMs)} · против бота «${p.bot.name}»`,
  };
}

// ——— Камера и движок ———
ui.cameraOn.addEventListener('click', () => {
  unlockAudio();
  unlockVoice();
  void keepScreenOn();
  opponent = null;
  if (engine) return toSetup();
  void startEngine();
});

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
    setStatus('Камера включена — встань так, чтобы тебя было видно.', 'wait');
  } catch (err) {
    // Причину — в консоль: без неё «не удалось запустить» не разобрать (E-27).
    console.error('[duel] движок не запустился', err);
    engine?.stop();
    engine = null;
    show('intro');
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
  engine?.setMode('menu');
  ui.start.disabled = !engineReady;
  ui.start.textContent = onlineDuel.active() ? 'Готов' : 'Старт';
  const m = currentMode();
  ui.setupEx.textContent = exerciseTitle(m.exercise);
  ui.setupMeta.textContent = m.meta;
  ui.setupHow.textContent = cameraTip(m.exercise);
}

function setStatus(text: string, state: 'ok' | 'wait' | 'bad'): void {
  ui.setupStatus.textContent = text;
  ui.setupStatus.dataset.state = state;
}

$<HTMLButtonElement>('setup-back').addEventListener('click', () => {
  // Онлайн — выйти из комнаты (сервер ответит «left» и вернёт на вступление).
  if (onlineDuel.active()) return onlineDuel.leave();
  opponent = null;
  engine?.setMode('menu');
  show('intro');
});

function onEvent(e: EngineEvent): void {
  switch (e.type) {
    case 'frame':
      lastLandmarks = e.landmarks;
      lastImage = e.image instanceof HTMLCanvasElement ? e.image : null;
      lastFrameAt = performance.now();
      // Статус подготовки — по кадрам: калибровка в меню молчит, пока человек стабильно в кадре.
      if (screen === 'setup' && engineReady && e.landmarks.length > 0 !== seen) {
        seen = e.landmarks.length > 0;
        if (seen) setStatus('Вижу тебя', 'ok');
        else setStatus('Тебя не видно — отойди, чтобы в кадре был ты целиком.', 'bad');
      }
      break;
    case 'calibration':
      if (screen === 'setup') {
        if (e.status === 'ok') setStatus('Вижу тебя', 'ok');
        else setStatus(e.hint, 'bad');
      }
      // Посреди боя пропал из кадра — повторы не считаются, скажем, как вернуться.
      else if (screen === 'battle' && e.status !== 'ok') hint(e.hint);
      break;
    case 'gesture':
      if (screen === 'setup' && engineReady && !ui.start.disabled) go();
      else if (screen === 'result') again();
      break;
    case 'phase':
      skeletonPhase = e.phase;
      break;
    case 'rep':
      if (match?.addRep(performance.now())) {
        sfx.repClean();
        if (onlineDuel.active()) onlineDuel.rep();
      }
      break;
    case 'form_error':
      if (screen !== 'battle') break;
      hint(e.message);
      errorJoints = new Set(e.joints);
      break;
    case 'form_ok':
      errorJoints = new Set();
      break;
  }
}

// ——— Бой ———
/** Буква и рамка свои: титул мог прийти уже после старта боя. */
function paintMe(): void {
  const mine = myFace();
  setFace(ui.meFace, mine.name, mine.frame, mine.title);
  ui.meName.textContent = mine.name;
  setFace(ui.resultMeFace, mine.name, mine.frame, mine.title);
  ui.resultMeName.textContent = mine.name;
}

function paintOpp(name: string, frame: string | null, title: string | null): void {
  setFace(ui.oppFace, name, frame, title);
  ui.oppName.textContent = name;
  setFace(ui.resultOppFace, name, frame, title);
  ui.resultOppName.textContent = name;
}

/** Общая подготовка табло к отсчёту — для любого соперника. */
function prepareBoard(exercise: DuelExercise, durationMs: number, oppName: string): void {
  currentExercise = exercise;
  currentDurationMs = durationMs;
  engineTarget = Math.max(ENGINE_TARGET, Math.ceil(durationMs / minGapMs(exercise)) + 10);
  shown = { me: -1, opp: -1, second: -1, lastTen: false };
  const liveOpp = onlineDuel.active() ? onlineDuel.opponent() : undefined;
  paintMe();
  paintOpp(oppName, liveOpp?.frame ?? null, liveOpp?.title ?? null);
  ui.hudEx.textContent = exerciseTitle(exercise);
  ui.countdownText.textContent = `${exerciseTitle(exercise)} — ${isFloor(exercise) ? 'ложись в упор' : 'встань в кадр'}`;
  ui.hint.textContent = '';
  ui.sideMe.classList.remove('is-rep');
  errorJoints = new Set();
}

/** Бой с ботом или с записью друга. */
function startMatch(): void {
  const m = currentMode();
  const bot = picked().bot;
  prepareBoard(m.exercise, m.durationMs, opponent?.name ?? bot.name);
  const timeline =
    opponent?.timeline ??
    botTimeline(botTotal(bot, m.exercise, m.durationMs), m.durationMs, (Math.random() * 2 ** 31) | 0);
  match = new DuelMatch(
    {
      opponentReps: (t) => repsAt(timeline, t),
      countdownMs: COUNTDOWN_MS,
      durationMs: m.durationMs,
      exercise: m.exercise,
    },
    performance.now(),
  );
  show('countdown');
}

ui.start.addEventListener('click', () => {
  unlockAudio();
  unlockVoice();
  if (engineReady) go();
});
ui.giveUp.addEventListener('click', () => {
  match?.giveUp(performance.now());
  if (onlineDuel.active()) onlineDuel.giveUp();
});
$<HTMLButtonElement>('again').addEventListener('click', again);

/** «Старт» с ботом или вызовом; онлайн — «Готов», а старт назначит сервер. */
function go(): void {
  if (!onlineDuel.active()) return startMatch();
  onlineDuel.ready();
  ui.start.disabled = true;
  ui.start.textContent = 'Ждём соперника';
}

/** Реванш — то же упражнение и то же время. */
function again(): void {
  if (!onlineDuel.active()) return startMatch();
  toSetup();
  go();
}

/** Онлайн: общий отсчёт по часам сервера, соперник — его счёт с сервера. */
function startOnlineMatch(startLocal: number, dur: number, cd: number): void {
  opponent = null;
  announced = false;
  const exercise = onlineDuel.exercise();
  prepareBoard(exercise, dur, onlineDuel.oppName());
  match = new DuelMatch(
    { opponentReps: () => onlineDuel.oppReps(), countdownMs: cd, durationMs: dur, exercise },
    startLocal,
  );
  show('countdown');
}

/** Итог онлайн-боя от сервера (может прийти и раньше своего финиша — соперник сдался). */
function onlineResult(v: RoomView): void {
  if (screen === 'countdown' || screen === 'battle') engine?.setMode('menu');
  match = null;
  const me = v.players[v.you];
  const opp = v.players[1 - v.you];
  const r = v.result;
  const outcome = !r ? 'draw' : r.winner === null ? 'draw' : r.winner === v.you ? 'win' : 'lose';
  const title = me?.gaveUp
    ? 'Ты сдался'
    : opp?.gaveUp
      ? 'Соперник сдался'
      : outcome === 'win'
        ? 'Победа'
        : outcome === 'lose'
          ? 'Поражение'
          : 'Ничья';
  fillResult(v.exercise, v.durationMs, title, me?.reps ?? 0, opp?.reps ?? 0, opp?.name ?? 'Соперник');
  paintMe();
  paintOpp(opp?.name ?? 'Соперник', opp?.frame ?? null, opp?.title ?? null);
  if (awardRound !== v.round) ui.resultAward.textContent = '';
  app.dataset.outcome = outcome;
  const gaveUp = me?.gaveUp ? 'me' : opp?.gaveUp ? 'opp' : null;
  ui.resultNote.textContent = noteFor(outcome, me?.reps ?? 0, opp?.reps ?? 0, gaveUp);
  ui.inviteOpen.hidden = true;
  if (screen !== 'result') show('result');
  if (!announced) {
    announced = true;
    if (outcome === 'win') sfx.fanfare();
    say(title);
  }
}

ui.inviteOpen.addEventListener('click', () => {
  if (match) openInvite(match.myTimeline(), currentDurationMs, currentExercise, opponent?.name);
});
$<HTMLButtonElement>('change').addEventListener('click', () => {
  if (onlineDuel.active()) onlineDuel.leave();
  match = null;
  opponent = null;
  engine?.setMode('menu');
  show('intro');
});

/** Переход фазы боя: движок включаем ровно на старте и выключаем на финише. */
function onPhase(next: DuelPhase, s: DuelSnapshot): void {
  if (next === 'battle') {
    engine?.setMode({ exercise: currentExercise, targetReps: engineTarget });
    skeletonPhase = 'start';
    sfx.go();
    say('Старт!');
  }
  if (next === 'over') {
    engine?.setMode('menu');
    showResult(s);
    return;
  }
  show(next);
}

function fillResult(
  exercise: DuelExercise,
  durationMs: number,
  title: string,
  me: number,
  opp: number,
  oppName: string,
): void {
  ui.resultEx.textContent = `${exerciseTitle(exercise)} · ${formatName(durationMs)}`;
  ui.resultTitle.textContent = title;
  ui.resultMe.textContent = String(me);
  ui.resultOpp.textContent = String(opp);
  ui.resultOppName.textContent = oppName;
}

function noteFor(outcome: string, me: number, opp: number, gaveUp: 'me' | 'opp' | null = null): string {
  if (gaveUp === 'me') return 'Сдача считается поражением.';
  if (gaveUp === 'opp') return 'Соперник сдался — победа твоя.';
  const diff = Math.abs(me - opp);
  if (outcome === 'draw') return 'Одинаково — реванш?';
  return outcome === 'win'
    ? `Ты впереди на ${diff} ${repsWord(diff)}.`
    : `Не хватило ${diff} ${repsWord(diff)} — реванш?`;
}

function showResult(s: DuelSnapshot): void {
  const oppName = onlineDuel.active() ? onlineDuel.oppName() : (opponent?.name ?? picked().bot.name);
  // Онлайн: свой финиш — только «время», итог (с поздними повторами) пришлёт сервер.
  if (onlineDuel.active()) {
    fillResult(currentExercise, currentDurationMs, s.gaveUp ? 'Ты сдался' : 'Время!', s.me, s.opp, oppName);
    ui.resultNote.textContent = 'Считаем итог на сервере…';
    if (awardRound !== onlineDuel.round()) ui.resultAward.textContent = '';
    app.dataset.outcome = '';
    ui.inviteOpen.hidden = true;
    show('result');
    return;
  }
  const title = s.gaveUp
    ? 'Ты сдался'
    : s.outcome === 'win'
      ? 'Победа'
      : s.outcome === 'lose'
        ? 'Поражение'
        : 'Ничья';
  fillResult(currentExercise, currentDurationMs, title, s.me, s.opp, oppName);
  ui.resultNote.textContent = noteFor(s.outcome ?? 'draw', s.me, s.opp, s.gaveUp ? 'me' : null);
  app.dataset.outcome = s.outcome ?? '';
  // Звать друга есть смысл с настоящим результатом.
  ui.inviteOpen.hidden = s.gaveUp || s.me === 0;
  if (opponent && match) {
    const opp = opponent;
    const note = ui.resultNote.textContent;
    ui.resultAward.textContent = '';
    ui.resultNote.textContent = `${note} Отправляю ответ…`;
    void sendAnswer(opp, match.myTimeline()).then((res) => {
      if (screen !== 'result') return;
      ui.resultNote.textContent = `${note} ${res.note}`;
      ui.resultAward.textContent = res.awardText;
      paintMe();
      if (res.rival) paintOpp(opp.name, res.rival.frame, res.rival.title);
    });
  } else {
    ui.resultAward.textContent = 'Тренировка с ботом — кубки не меняются.';
  }
  show('result');
  if (s.outcome === 'win') sfx.fanfare();
  say(title);
}

// ——— Кадр: счёт, часы, перетягивание, скелет ———
function frame(): void {
  requestAnimationFrame(frame);
  const now = performance.now();
  if (match && (screen === 'countdown' || screen === 'battle')) {
    const s = match.snapshot(now);
    if (s.phase !== screen) onPhase(s.phase, s);
    render(s);
  }
  if (screen === 'battle' && now > hintUntil && ui.hint.textContent) {
    ui.hint.textContent = '';
    errorJoints = new Set();
  }
  draw();
}

function render(s: DuelSnapshot): void {
  if (s.phase === 'countdown') {
    const left = Math.ceil(s.countdownLeftMs / 1000);
    if (left !== shown.second) {
      shown.second = left;
      ui.countdown.textContent = String(left);
      pop(ui.countdown);
      sfx.tick();
      if (left <= 3) say(numberWord(left), 'count');
    }
  }
  if (s.me !== shown.me) {
    ui.scoreMe.textContent = String(s.me);
    if (shown.me >= 0) repFlash();
    shown.me = s.me;
  }
  if (s.opp !== shown.opp) {
    ui.scoreOpp.textContent = String(s.opp);
    if (shown.opp >= 0) pop(ui.scoreOpp);
    shown.opp = s.opp;
  }
  const lastTen = s.phase === 'battle' && s.timeLeftMs <= 10_000;
  if (lastTen && !shown.lastTen) say('Десять секунд!');
  shown.lastTen = lastTen;
  ui.clock.textContent = formatClock(s.timeLeftMs);
  ui.clock.classList.toggle('is-last', lastTen);
  ui.tugMe.style.width = `${(s.share * 100).toFixed(1)}%`;
  const diff = s.me - s.opp;
  const lead = diff > 0 ? 'me' : diff < 0 ? 'opp' : 'even';
  if (ui.lead.dataset.lead !== lead || ui.lead.dataset.diff !== String(diff)) {
    ui.lead.dataset.lead = lead;
    ui.lead.dataset.diff = String(diff);
    ui.lead.textContent =
      lead === 'even' ? 'Поровну' : lead === 'me' ? `Ты впереди на ${diff}` : `Отстаёшь на ${-diff}`;
    app.dataset.lead = lead;
  }
}

/** Мой повтор: число прыгает, карточка вспыхивает зелёным, «+1» улетает вверх. */
function repFlash(): void {
  pop(ui.scoreMe);
  ui.sideMe.classList.remove('is-rep');
  void ui.sideMe.offsetWidth;
  ui.sideMe.classList.add('is-rep');
  clearTimeout(flashTimer);
  flashTimer = window.setTimeout(() => ui.sideMe.classList.remove('is-rep'), REP_FLASH_MS);
}

function hint(text: string): void {
  ui.hint.textContent = text;
  hintUntil = performance.now() + HINT_MS;
}

/** Короткая «вспышка» числа: перезапуск CSS-анимации. */
function pop(el: HTMLElement): void {
  el.classList.remove('pop');
  void el.offsetWidth;
  el.classList.add('pop');
}

function draw(): void {
  const W = canvas.clientWidth;
  const H = canvas.clientHeight;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) {
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);
  if (!lastLandmarks || screen === 'intro' || screen === 'result') return;
  // Кадр, на котором движок посчитал точки (E-23), поверх живого видео — скелет лежит на теле кадр в кадр.
  // Движок встал (кадр старше 0,7 с) — остаётся живое видео под холстом.
  const image = lastImage && lastImage.width > 0 && performance.now() - lastFrameAt < 700 ? lastImage : null;
  // Мок-движок работает без видео: берём обычный кадр 16:9.
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
  const down = skeletonPhase === 'down' || skeletonPhase === 'bottom';
  drawSkeleton(ctx, view, lastLandmarks, {
    color: down ? COLORS.primary : COLORS.good,
    glow: down ? COLORS.primary : COLORS.good,
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

window.addEventListener('pagehide', () => {
  engine?.stop();
  void wakeLock?.release();
});

show('intro');
requestAnimationFrame(frame);
// E-34: пока выбирают соперника — подкачать модель позы и wasm, «Включить камеру» стартует сразу.
if (!params.has('mock')) prefetchPoseAssetsWhenIdle();
