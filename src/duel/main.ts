// E-24: дуэль — отдельная страница /duel.html (без React и без экранов платформы).
// Ты против бота, записи друга (E-25) или живого соперника онлайн (E-26) — в любом упражнении дуэли (E-29).
// Экраны: intro (арена) → setup (камера, скелет) → countdown → battle → result. Подбор соперника:
// intro → search («Ищем соперника…») → found («Соперник найден!», авто-готовность) → countdown → battle.
// Время и счёт — в DuelMatch, здесь только движок, DOM и звук.
// Для проверок: ?mock=1 (мок-движок), ?bot=machine, ?sec=20, ?ex=squat.

import '../ui/styles/global.css';
import './duel.css';
import './arena.css';

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
import { ROOM_DURATIONS } from '../shared/duelRoom';
import { botTimeline, botTotal, repsAt } from './bot';
import { setFace } from './face';
import { mountGhost, type GhostMount } from './ghost';
import { initHome, paintStats, pickChanged, recordClean, refreshHome, trophy } from './home';
import { initLadder } from './ladder';
import { cameraTip, exerciseTitle, formatName, isFloor, repsWord } from './labels';
import { DuelMatch, formatClock, type DuelPhase, type DuelSnapshot } from './match';
import { initOnline, onlineDuel, reconnectOnline } from './online';
import { initPicker, picked, roomDuration } from './picker';
import {
  accountState,
  initSocial,
  myFace,
  openInvite,
  openLogin,
  sendAnswer,
  type RecordedOpponent,
} from './social';
import { initTour } from './tour';

type Screen = 'intro' | 'search' | 'found' | 'setup' | DuelPhase | 'result';

const COUNTDOWN_MS = 5000;
/** Потолок подхода для движка: бой держит таймер страницы, а не цель по повторам. */
const ENGINE_TARGET = 300;
const HINT_MS = 2500;
const REP_FLASH_MS = 520;
/** «Соперник найден!»: через столько сами жмём «Готов». */
const FOUND_READY_MS = 3000;
/** Подсказка под «Хорошо! Чистое повторение» — главное в технике упражнения. */
const CLEAN_CUE: Partial<Record<DuelExercise, string>> = {
  push_up: 'Держи спину ровно',
  squat: 'Колени — по линии носков',
  lunge: 'Корпус держи прямо',
  burpee: 'Приземляйся мягко',
  squat_press: 'Руки — до конца вверх',
  jumping_jack: 'Руки — над головой',
};

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
  find: $<HTMLButtonElement>('find'),
  sideMe: $<HTMLDivElement>('side-me'),
  sideOpp: $<HTMLDivElement>('side-opp'),
  scoreMe: $<HTMLSpanElement>('score-me'),
  scoreOpp: $<HTMLSpanElement>('score-opp'),
  meFace: $<HTMLElement>('me-face'),
  meName: $<HTMLSpanElement>('me-name'),
  oppFace: $<HTMLElement>('opp-face'),
  oppName: $<HTMLSpanElement>('opp-name'),
  clock: $<HTMLSpanElement>('clock'),
  hudEx: $<HTMLElement>('hud-ex'),
  hudMeta: $<HTMLElement>('hud-meta'),
  lead: $<HTMLParagraphElement>('lead'),
  barMe: $<HTMLElement>('bar-me'),
  barOpp: $<HTMLElement>('bar-opp'),
  panelMe: $<HTMLElement>('panel-me'),
  oppCardFace: $<HTMLElement>('opp-card-face'),
  oppCardNum: $<HTMLElement>('opp-card-num'),
  hintBox: $<HTMLDivElement>('hint-box'),
  hint: $<HTMLElement>('hint'),
  hintSub: $<HTMLElement>('hint-sub'),
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
  seekNew: $<HTMLButtonElement>('seek-new'),
  searchClock: $<HTMLElement>('search-clock'),
  searchArc: $<HTMLElement>('search-arc'),
  searchMeta: $<HTMLElement>('search-meta'),
  searchNote: $<HTMLElement>('search-note'),
  foundGo: $<HTMLButtonElement>('found-go'),
  foundNote: $<HTMLElement>('found-note'),
  foundEx: $<HTMLElement>('found-ex'),
};
$<HTMLAnchorElement>('home').href = import.meta.env.BASE_URL;
$<HTMLAnchorElement>('menu-link').href = `${import.meta.env.BASE_URL}app`;
$<HTMLAnchorElement>('nav-train').href = `${import.meta.env.BASE_URL}app`;
$<HTMLAnchorElement>('nav-rating').href = `${import.meta.env.BASE_URL}app/rating`;
// E-36: бокс с ботом как файтинг — своя страница.
$<HTMLAnchorElement>('boxing-link').href = `${import.meta.env.BASE_URL}fight.html`;

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
/** Повторы этого боя: всего и чистых (для «чистых повторов» в карточке рейтинга). */
let battleReps = { all: 0, clean: 0 };
/** «Соперник найден»: когда сами нажмём «Готов» (performance.now); 0 — уже нажали или не ждём. */
let foundAt = 0;
let foundReady = false;
let foundGhost: GhostMount | null = null;
let searchGhosts: GhostMount[] = [];
let engineLoading = false;

// ——— Выбор упражнения, времени и бота ———
initPicker(params, () => pickChanged());
initLadder();
initHome();

// ——— Вызовы друзьям (E-25) ———
void initSocial({
  accept(opp) {
    closeSheets();
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
    void refreshHome();
  },
  rankChanged() {
    paintMe();
    void refreshHome();
  },
}).then(() => refreshHome());

// ——— Онлайн-дуэль (E-26): время боя и итог — от сервера ———
/** Итог раунда уже объявлен голосом (объявляем по серверу, а не по своему счёту). */
let announced = false;
/** Комната и раунд, для которых уже показали кубки («id:раунд»). Повтор комнаты строку не стирает. */
let awardKey = '';
const roundKey = (v: RoomView | null) => (v ? `${v.id}:${v.round}` : '');
initOnline({
  enterRoom() {
    opponent = null;
    closeSheets();
    void keepScreenOn();
    // Подбор соперника: сначала «Соперник найден!»; камера уже включается (или включилась) на поиске.
    const v = onlineDuel.view();
    if (onlineDuel.matched() && v && (v.phase === 'lobby' || v.phase === 'over')) {
      showFound();
      if (!engine && !engineLoading) void startEngine(true);
      return;
    }
    if (engine) toSetup();
    else void startEngine();
  },
  room: onRoomUpdate,
  seeking(s) {
    if (!s && screen === 'search') show('intro');
  },
  stats: paintStats,
  error(message) {
    if (screen !== 'search' && screen !== 'found') return;
    show('intro');
    ui.introError.textContent = message;
    ui.introError.hidden = false;
  },
  countdown: startOnlineMatch,
  over: onlineResult,
  award(a) {
    if (!onlineDuel.active() || `${a.room}:${a.round}` !== roundKey(onlineDuel.view())) return;
    awardKey = `${a.room}:${a.round}`;
    ui.resultAward.textContent = describeAward(a);
    const opp = onlineDuel.opponent();
    paintMe();
    if (opp) paintOpp(opp.name, opp.frame, opp.title);
  },
  leftRoom() {
    // Ушли из комнаты, чтобы искать нового соперника, — экран поиска уже на месте.
    if (screen === 'intro' || onlineDuel.seeking()) return;
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
  const was = screen;
  screen = next;
  app.dataset.screen = next;
  for (const el of app.querySelectorAll<HTMLElement>('[data-for]')) {
    el.hidden = !el.dataset.for!.split(' ').includes(next);
  }
  if (next !== 'battle') ui.hintBox.hidden = true;
  if (next !== 'found') foundAt = 0;
  // 3D-атлеты поиска и «Соперник найден» не крутятся впустую, пока экран скрыт.
  if (next !== 'found') {
    foundGhost?.unmount();
    foundGhost = null;
  }
  if (next !== 'search') {
    for (const g of searchGhosts) g.unmount();
    searchGhosts = [];
  }
  if (next === 'intro' && was !== 'intro') {
    void refreshHome();
    // Вернулись из боя — арена сверху, с выбором упражнения.
    if (was === 'result' || was === 'setup') document.querySelector('.intro')?.scrollTo(0, 0);
  }
}

function closeSheets(): void {
  for (const d of document.querySelectorAll<HTMLDialogElement>('dialog[open]')) d.close();
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
  closeSheets();
  opponent = null;
  if (engine) return toSetup();
  void startEngine();
});

// ——— Подбор соперника ———
ui.find.addEventListener('click', () => {
  unlockAudio();
  unlockVoice();
  startSeek(picked().exercise, roomDuration());
});

/** Встать в очередь и показать «Ищем соперника…»; камера включается, пока ищем. */
function startSeek(exercise: DuelExercise, durationMs: number, note = ''): void {
  const { me, known, online } = accountState();
  if (known && !online) {
    ui.introError.textContent = 'Подбор соперника работает на основном сайте — здесь только бой с ботом.';
    ui.introError.hidden = false;
    return;
  }
  if (known && !me) return openLogin();
  ui.introError.hidden = true;
  if (!onlineDuel.seek(exercise, durationMs)) return;
  opponent = null;
  match = null;
  engine?.setMode('menu');
  void keepScreenOn();
  showSearch(exercise, durationMs, note);
  if (!engine && !engineLoading) void startEngine(true);
}

function showSearch(exercise: DuelExercise, durationMs: number, note: string): void {
  ui.searchMeta.textContent = `${exerciseTitle(exercise)} · ${formatName(durationMs)}`;
  ui.searchNote.textContent = note;
  ui.searchNote.dataset.fixed = note ? '1' : '';
  show('search');
  // Два силуэта за таймером: тёплый слева, холодный справа — ты и тот, кого ищем.
  searchGhosts = [
    mountGhost($('search-ghost-a'), { exercise, still: true, phase: 0.5 }),
    mountGhost($('search-ghost-b'), { exercise, still: true, phase: 0.5, yaw: -2.4 }),
  ];
}

$<HTMLButtonElement>('search-cancel').addEventListener('click', () => {
  onlineDuel.cancelSeek();
  show('intro');
});

/** «Соперник найден!»: двое, упражнение, сами жмём «Готов» через 3 с. */
function showFound(): void {
  const v = onlineDuel.view();
  if (!v) return;
  foundReady = false;
  ui.foundGo.disabled = false;
  ui.foundGo.textContent = `Начать через ${Math.round(FOUND_READY_MS / 1000)}…`;
  const f = formatName(v.durationMs).split(' · ');
  ui.foundEx.textContent = `${exerciseTitle(v.exercise)} · ${f[1] ?? f[0]}`;
  ui.foundNote.textContent = '';
  show('found');
  foundAt = performance.now() + FOUND_READY_MS;
  $('found-ghost').classList.toggle('is-floor', isFloor(v.exercise));
  foundGhost = mountGhost($('found-ghost'), { exercise: v.exercise });
  paintFound(v);
  sfx.tick();
}

function paintFound(v: RoomView): void {
  const me = v.players[v.you];
  const opp = v.players[1 - v.you];
  const mine = myFace();
  fighter('found-me', mine.name, mine.frame, mine.title, me?.cups ?? null);
  if (opp) fighter('found-opp', opp.name, opp.frame, opp.title, opp.cups ?? null);
  if (foundReady) ui.foundNote.textContent = opp?.ready ? 'Оба готовы — поехали!' : 'Ждём соперника…';
  else if (opp?.ready) ui.foundNote.textContent = 'Соперник готов';
}

function fighter(
  id: string,
  name: string,
  frame: string | null,
  title: string | null,
  cups: number | null,
): void {
  setFace($(`${id}-face`), name, frame, title);
  $(`${id}-nick`).textContent = name;
  $(`${id}-title`).textContent = title ?? 'Без титула';
  const c = $(`${id}-cups`);
  c.replaceChildren(String(cups ?? 0), trophy());
  c.setAttribute('aria-label', `Кубков на этой доске: ${cups ?? 0}`);
}

/** «Готов» с экрана «Соперник найден» — только когда камера уже работает. */
function foundGoReady(): void {
  if (foundReady) return;
  foundAt = 0;
  if (!engineReady) {
    ui.foundGo.disabled = true;
    ui.foundGo.textContent = 'Включаем камеру…';
    return;
  }
  foundReady = true;
  onlineDuel.ready();
  ui.foundGo.disabled = true;
  ui.foundGo.textContent = 'Ждём соперника…';
  const v = onlineDuel.view();
  if (v) paintFound(v);
}

ui.foundGo.addEventListener('click', () => {
  unlockAudio();
  unlockVoice();
  foundGoReady();
});
$<HTMLButtonElement>('found-cancel').addEventListener('click', () => onlineDuel.leave());

/** Комната обновилась: на «Соперник найден» следим, не ушёл ли соперник. */
function onRoomUpdate(v: RoomView): void {
  if (screen !== 'found' || !v.matched) return;
  if (v.players.length < 2 && (v.phase === 'lobby' || v.phase === 'over'))
    return startSeek(v.exercise, v.durationMs, 'Соперник передумал — ищем другого');
  paintFound(v);
}

/** quiet — камера включается в фоне (пока ищем соперника), без экрана подготовки. */
async function startEngine(quiet = false): Promise<void> {
  engineLoading = true;
  ui.cameraOn.disabled = true;
  ui.introError.hidden = true;
  if (!quiet) {
    toSetup();
    setStatus('Загружаю модель…', 'wait');
  }
  try {
    engine = await createEngine();
    engine.on(onEvent);
    engine.setMode('menu');
    await engine.start(video);
    engineReady = true;
    ui.start.disabled = false;
    setStatus('Камера включена — встань так, чтобы тебя было видно.', 'wait');
    // Ждали камеру на «Соперник найден» — теперь можно «Готов».
    if (screen === 'found' && !foundReady && !foundAt) foundGoReady();
  } catch (err) {
    // Причину — в консоль: без неё «не удалось запустить» не разобрать (E-27).
    console.error('[duel] движок не запустился', err);
    engine?.stop();
    engine = null;
    // Без камеры бой не сыграть: снимаем поиск и выходим из найденной комнаты.
    onlineDuel.cancelSeek();
    if (onlineDuel.active() && screen === 'found') onlineDuel.leave();
    show('intro');
    ui.introError.textContent =
      err instanceof CameraError ? err.message : 'Не удалось запустить распознавание. Обнови страницу.';
    ui.introError.hidden = false;
  } finally {
    engineLoading = false;
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
      else if (screen === 'battle' && e.status !== 'ok') hint(e.hint, 'bad');
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
        battleReps.all += 1;
        if (!e.errors.length) {
          battleReps.clean += 1;
          // Ошибку в технике не перебиваем похвалой, пока её видно.
          if (ui.hintBox.hidden || ui.hintBox.dataset.kind === 'ok')
            hint('Хорошо! Чистое повторение', 'ok', CLEAN_CUE[currentExercise] ?? 'Держи темп');
        }
      }
      break;
    case 'form_error':
      if (screen !== 'battle') break;
      hint(e.message, 'bad');
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
  setFace(ui.oppCardFace, name, frame, title);
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
  const f = formatName(durationMs).split(' · ');
  ui.hudMeta.textContent = f.length === 2 ? `${f[1]} · ${f[0]}` : f[0]!;
  ui.countdownText.textContent = `${exerciseTitle(exercise)} — ${isFloor(exercise) ? 'ложись в упор' : 'встань в кадр'}`;
  ui.hintBox.hidden = true;
  ui.sideMe.classList.remove('is-rep');
  errorJoints = new Set();
  battleReps = { all: 0, clean: 0 };
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
ui.seekNew.addEventListener('click', () => {
  const ms = ROOM_DURATIONS.includes(currentDurationMs) ? currentDurationMs : roomDuration();
  startSeek(currentExercise, ms);
});

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
  if (awardKey !== roundKey(v)) ui.resultAward.textContent = '';
  app.dataset.outcome = outcome;
  const gaveUp = me?.gaveUp ? 'me' : opp?.gaveUp ? 'opp' : null;
  ui.resultNote.textContent = noteFor(outcome, me?.reps ?? 0, opp?.reps ?? 0, gaveUp);
  ui.inviteOpen.hidden = true;
  ui.seekNew.hidden = !onlineDuel.signedIn();
  if (screen !== 'result') {
    saveClean();
    show('result');
  }
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
    if (awardKey !== roundKey(onlineDuel.view())) ui.resultAward.textContent = '';
    app.dataset.outcome = '';
    ui.inviteOpen.hidden = true;
    ui.seekNew.hidden = !onlineDuel.signedIn();
    saveClean();
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
  ui.seekNew.hidden = !onlineDuel.signedIn();
  saveClean();
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
  if (screen === 'battle' && now > hintUntil && !ui.hintBox.hidden) {
    ui.hintBox.hidden = true;
    errorJoints = new Set();
  }
  if (screen === 'search') renderSearch(now);
  if (screen === 'found' && foundAt) renderFound(now);
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
    ui.panelMe.textContent = String(s.me);
    if (shown.me >= 0) repFlash();
    shown.me = s.me;
  }
  if (s.opp !== shown.opp) {
    ui.scoreOpp.textContent = String(s.opp);
    ui.oppCardNum.textContent = String(s.opp);
    if (shown.opp >= 0) {
      pop(ui.scoreOpp);
      pop(ui.oppCardNum);
    }
    shown.opp = s.opp;
  }
  const lastTen = s.phase === 'battle' && s.timeLeftMs <= 10_000;
  if (lastTen && !shown.lastTen) say('Десять секунд!');
  shown.lastTen = lastTen;
  ui.clock.textContent = formatClock(s.timeLeftMs);
  ui.clock.classList.toggle('is-last', lastTen);
  // Полосы гонки: лидер — почти до конца, отстающий — в пропорции.
  const top = Math.max(8, s.me, s.opp) * 1.08;
  ui.barMe.style.width = `${((s.me / top) * 100).toFixed(1)}%`;
  ui.barOpp.style.width = `${((s.opp / top) * 100).toFixed(1)}%`;
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

/** Карточка внизу боя: зелёная — чистый повтор, красная — ошибка техники или «тебя не видно». */
function hint(text: string, kind: 'ok' | 'bad', sub = ''): void {
  ui.hint.textContent = text;
  ui.hintSub.textContent = sub;
  ui.hintBox.dataset.kind = kind;
  ui.hintBox.hidden = false;
  hintUntil = performance.now() + (kind === 'ok' ? 1400 : HINT_MS);
}

/** Бой кончился — в копилку «чистых повторов». */
function saveClean(): void {
  recordClean(battleReps.all, battleReps.clean);
  battleReps = { all: 0, clean: 0 };
}

/** Таймер поиска: время вверх, дуга — доля минуты; подсказка, когда окно по кубкам расширяется. */
function renderSearch(now: number): void {
  const s = onlineDuel.seeking();
  if (!s) return;
  const sec = Math.max(0, Math.floor((now - s.since) / 1000));
  const txt = `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
  if (ui.searchClock.textContent !== txt) ui.searchClock.textContent = txt;
  const frac = ((now - s.since) % 60_000) / 60_000;
  ui.searchArc.style.strokeDashoffset = String(339.3 * (1 - frac));
  if (ui.searchNote.dataset.fixed === '1' && sec < 4) return;
  const note =
    sec >= 20
      ? 'Ищем любого свободного соперника'
      : sec >= 10
        ? 'Расширяем поиск по кубкам'
        : s.queue > 0
          ? `Ещё ${s.queue} ${repsLike(s.queue)} бой на этой доске`
          : '';
  if (ui.searchNote.textContent !== note) ui.searchNote.textContent = note;
}

function repsLike(n: number): string {
  const d = n % 10;
  const dd = n % 100;
  return d === 1 && dd !== 11 ? 'игрок ищет' : 'ищут';
}

function renderFound(now: number): void {
  const left = Math.ceil((foundAt - now) / 1000);
  if (left <= 0) return foundGoReady();
  const txt = `Начать через ${left}…`;
  if (ui.foundGo.textContent !== txt) ui.foundGo.textContent = txt;
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
// Первый визит — короткое обучение прямо на арене (не по ссылке-приглашению и не посреди боя).
initTour(() => screen === 'intro' && !location.hash);

// E-34: пока выбирают соперника — подкачать модель позы и wasm, «Включить камеру» стартует сразу.
if (!params.has('mock')) prefetchPoseAssetsWhenIdle();
