// E-24: дуэль на отжиманиях — отдельная страница /duel.html (без React и без экранов платформы).
// Ты против бота минуту: счёт, перетягивание, «+1» у соперника — как в ролике-референсе.
// Экраны: intro → setup (камера, скелет) → countdown → battle → result. Время и счёт — в DuelMatch,
// здесь только движок, DOM и звук. Для проверок: ?mock=1 (мок-движок), ?bot=machine, ?sec=20.

import '../ui/styles/tokens.css';
import './duel.css';
import { CameraError } from '../engine/camera';
import { createEngine } from '../engine/createEngine';
import type { Engine, EngineEvent, Landmark, Phase } from '../engine/types';
import { sfx, unlockAudio } from '../ui/audio/sfx';
import { numberWord, say, unlockVoice } from '../ui/audio/voice';
import { coverView, drawSkeleton } from '../ui/lib/skeleton';
import { COLORS } from '../ui/theme';
import { BOTS, botTimeline, findBot, repsAt, type Bot } from './bot';
import { DuelMatch, formatClock, type DuelPhase, type DuelSnapshot } from './match';
import type { RoomView } from '../shared/duelRoom';
import { initOnline, onlineDuel, reconnectOnline } from './online';
import { initSocial, openInvite, sendAnswer, type RecordedOpponent } from './social';

type Screen = 'intro' | 'setup' | DuelPhase | 'result';

const COUNTDOWN_MS = 5000;
/** Потолок подхода для движка: минуту бой держит таймер страницы, а не цель по повторам. */
const ENGINE_TARGET = 300;
const HINT_MS = 2500;

const params = new URLSearchParams(location.search);
const durationMs = clampInt(params.get('sec'), 10, 120, 60) * 1000;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const app = $<HTMLElement>('app');
const video = $<HTMLVideoElement>('video');
const canvas = $<HTMLCanvasElement>('overlay');
const ctx = canvas.getContext('2d')!;
const ui = {
  bots: $<HTMLFieldSetElement>('bots'),
  cameraOn: $<HTMLButtonElement>('camera-on'),
  introError: $<HTMLParagraphElement>('intro-error'),
  setupStatus: $<HTMLParagraphElement>('setup-status'),
  start: $<HTMLButtonElement>('start'),
  countdown: $<HTMLSpanElement>('countdown'),
  scoreMe: $<HTMLSpanElement>('score-me'),
  scoreOpp: $<HTMLSpanElement>('score-opp'),
  oppAvatar: $<HTMLSpanElement>('opp-avatar'),
  oppName: $<HTMLSpanElement>('opp-name'),
  clock: $<HTMLDivElement>('clock'),
  tugMe: $<HTMLDivElement>('tug-me'),
  big: $<HTMLSpanElement>('big-count'),
  hint: $<HTMLParagraphElement>('hint'),
  giveUp: $<HTMLButtonElement>('give-up'),
  resultTitle: $<HTMLHeadingElement>('result-title'),
  resultMe: $<HTMLSpanElement>('result-me'),
  resultOpp: $<HTMLSpanElement>('result-opp'),
  resultOppName: $<HTMLElement>('result-opp-name'),
  resultNote: $<HTMLParagraphElement>('result-note'),
};
$<HTMLAnchorElement>('home').href = import.meta.env.BASE_URL;

let bot: Bot = findBot(params.get('bot'));
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
let wakeLock: { release(): Promise<void> } | null = null;

// ——— Выбор соперника ———
for (const b of BOTS) {
  const label = document.createElement('label');
  label.className = 'bot';
  const input = document.createElement('input');
  input.type = 'radio';
  input.name = 'bot';
  input.value = b.id;
  input.checked = b.id === bot.id;
  const avatar = span('bot__avatar', b.avatar);
  avatar.setAttribute('aria-hidden', 'true');
  label.append(input, avatar, span('bot__name', b.name), span('bot__pace', `${b.total} за минуту`));
  ui.bots.appendChild(label);
}
ui.bots.addEventListener('change', (e) => {
  bot = findBot((e.target as HTMLInputElement).value);
  opponent = null;
});

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
  accountChanged: () => reconnectOnline(),
});

// ——— Онлайн-дуэль (E-26): время боя и итог — от сервера ———
/** Итог раунда уже объявлен голосом (объявляем по серверу, а не по своему счёту). */
let announced = false;
initOnline({
  enterRoom() {
    opponent = null;
    void keepScreenOn();
    if (engine) toSetup();
    else void startEngine();
  },
  countdown: startOnlineMatch,
  over: onlineResult,
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

// ——— Камера и движок ———
ui.cameraOn.addEventListener('click', () => {
  unlockAudio();
  unlockVoice();
  void keepScreenOn();
  if (engine) return toSetup();
  void startEngine();
});

async function startEngine(): Promise<void> {
  ui.cameraOn.disabled = true;
  ui.introError.hidden = true;
  toSetup();
  ui.setupStatus.textContent = 'Загружаю модель…';
  try {
    engine = await createEngine();
    engine.on(onEvent);
    engine.setMode('menu');
    await engine.start(video);
    engineReady = true;
    ui.start.disabled = false;
    ui.setupStatus.textContent = 'Камера включена. Отойди, чтобы было видно тебя целиком.';
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
}

function onEvent(e: EngineEvent): void {
  switch (e.type) {
    case 'frame':
      lastLandmarks = e.landmarks;
      lastImage = e.image instanceof HTMLCanvasElement ? e.image : null;
      lastFrameAt = performance.now();
      // Статус подготовки — по кадрам: калибровка в меню молчит, пока человек стабильно в кадре.
      if (screen === 'setup' && engineReady && e.landmarks.length > 0 !== seen) {
        seen = e.landmarks.length > 0;
        ui.setupStatus.textContent = seen
          ? 'Вижу тебя.'
          : 'Тебя не видно — отойди, чтобы в кадре был ты целиком.';
      }
      break;
    case 'calibration':
      if (screen === 'setup') ui.setupStatus.textContent = e.status === 'ok' ? 'Вижу тебя.' : e.hint;
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
function startMatch(): void {
  // Вызов друга — бой против его записи и той же длины, что была у него.
  const dur = opponent?.durationMs ?? durationMs;
  const timeline =
    opponent?.timeline ??
    botTimeline(Math.round((bot.total * dur) / 60_000), dur, (Math.random() * 2 ** 31) | 0);
  match = new DuelMatch(
    { opponentReps: (t) => repsAt(timeline, t), countdownMs: COUNTDOWN_MS, durationMs: dur },
    performance.now(),
  );
  shown = { me: -1, opp: -1, second: -1, lastTen: false };
  ui.oppAvatar.textContent = opponent ? opponent.name.slice(0, 1).toUpperCase() : bot.avatar;
  ui.oppName.textContent = opponent?.name ?? bot.name;
  ui.hint.textContent = '';
  errorJoints = new Set();
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
}

function again(): void {
  if (!onlineDuel.active()) return startMatch();
  toSetup();
  go();
}

/** Онлайн: общий отсчёт по часам сервера, соперник — его счёт с сервера. */
function startOnlineMatch(startLocal: number, dur: number, cd: number): void {
  opponent = null;
  announced = false;
  match = new DuelMatch(
    { opponentReps: () => onlineDuel.oppReps(), countdownMs: cd, durationMs: dur },
    startLocal,
  );
  shown = { me: -1, opp: -1, second: -1, lastTen: false };
  const name = onlineDuel.oppName();
  ui.oppAvatar.textContent = name.slice(0, 1).toUpperCase();
  ui.oppName.textContent = name;
  ui.hint.textContent = '';
  errorJoints = new Set();
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
        ? 'Победа!'
        : outcome === 'lose'
          ? 'Поражение'
          : 'Ничья';
  const diff = Math.abs((me?.reps ?? 0) - (opp?.reps ?? 0));
  ui.resultTitle.textContent = title;
  ui.resultMe.textContent = String(me?.reps ?? 0);
  ui.resultOpp.textContent = String(opp?.reps ?? 0);
  ui.resultOppName.textContent = opp?.name ?? 'соперник';
  ui.resultNote.textContent =
    outcome === 'draw' ? 'Одинаково — реванш?' : `Разница — ${diff} ${plural(diff)}.`;
  app.dataset.outcome = outcome;
  $<HTMLButtonElement>('invite-open').hidden = true;
  if (screen !== 'result') show('result');
  if (!announced) {
    announced = true;
    if (outcome === 'win') sfx.fanfare();
    say(title);
  }
}
$<HTMLButtonElement>('invite-open').addEventListener('click', () => {
  if (match) openInvite(match.myTimeline(), opponent?.durationMs ?? durationMs, opponent?.name);
});
$<HTMLButtonElement>('change').addEventListener('click', () => {
  if (onlineDuel.active()) onlineDuel.leave();
  match = null;
  opponent = null;
  engine?.setMode('menu');
  ui.cameraOn.textContent = 'Продолжить';
  show('intro');
});

/** Переход фазы боя: движок включаем ровно на старте и выключаем на финише. */
function onPhase(next: DuelPhase, s: DuelSnapshot): void {
  if (next === 'battle') {
    engine?.setMode({ exercise: 'push_up', targetReps: ENGINE_TARGET });
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

function showResult(s: DuelSnapshot): void {
  // Онлайн: свой финиш — только «время», итог (с поздними повторами) пришлёт сервер.
  if (onlineDuel.active()) {
    ui.resultTitle.textContent = s.gaveUp ? 'Ты сдался' : 'Время!';
    ui.resultMe.textContent = String(s.me);
    ui.resultOpp.textContent = String(s.opp);
    ui.resultOppName.textContent = onlineDuel.oppName();
    ui.resultNote.textContent = 'Считаем итог на сервере…';
    app.dataset.outcome = '';
    $<HTMLButtonElement>('invite-open').hidden = true;
    show('result');
    return;
  }
  const diff = Math.abs(s.me - s.opp);
  ui.resultTitle.textContent = s.gaveUp
    ? 'Ты сдался'
    : s.outcome === 'win'
      ? 'Победа!'
      : s.outcome === 'lose'
        ? 'Поражение'
        : 'Ничья';
  ui.resultMe.textContent = String(s.me);
  ui.resultOpp.textContent = String(s.opp);
  ui.resultOppName.textContent = opponent?.name ?? bot.name.toLowerCase();
  ui.resultNote.textContent =
    s.outcome === 'draw' ? 'Одинаково — реванш?' : `Разница — ${diff} ${plural(diff)}.`;
  app.dataset.outcome = s.outcome ?? '';
  // Звать друга есть смысл с настоящим результатом.
  $<HTMLButtonElement>('invite-open').hidden = s.gaveUp || s.me === 0;
  if (opponent && match) {
    const opp = opponent;
    const note = ui.resultNote.textContent;
    ui.resultNote.textContent = `${note} Отправляю ответ…`;
    void sendAnswer(opp, match.myTimeline()).then((msg) => {
      if (screen === 'result') ui.resultNote.textContent = `${note} ${msg}`;
    });
  }
  show('result');
  if (s.outcome === 'win') sfx.fanfare();
  say(ui.resultTitle.textContent);
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
      sfx.tick();
      if (left <= 3) say(numberWord(left), 'count');
    }
  }
  if (s.me !== shown.me) {
    ui.scoreMe.textContent = ui.big.textContent = String(s.me);
    if (shown.me >= 0) pop(ui.big);
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
  ui.clock.classList.toggle('board__clock--last', lastTen);
  ui.tugMe.style.width = `${(s.share * 100).toFixed(1)}%`;
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

function span(className: string, text: string): HTMLSpanElement {
  const el = document.createElement('span');
  el.className = className;
  el.textContent = text;
  return el;
}

function plural(n: number): string {
  const d = n % 10;
  const dd = n % 100;
  if (d === 1 && dd !== 11) return 'повтор';
  if (d >= 2 && d <= 4 && (dd < 12 || dd > 14)) return 'повтора';
  return 'повторов';
}

function clampInt(raw: string | null, min: number, max: number, fallback: number): number {
  const n = Number(raw);
  return Number.isFinite(n) && raw !== null ? Math.min(max, Math.max(min, Math.round(n))) : fallback;
}

window.addEventListener('pagehide', () => {
  engine?.stop();
  void wakeLock?.release();
});

show('intro');
requestAnimationFrame(frame);
