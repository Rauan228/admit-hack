// U-02: экраны как машина состояний. Движок один на всё приложение (engine/bus.ts),
// режим движка выставляется по текущему экрану; сцена (видео + скелет) лежит под всеми экранами.
// Камера — только когда нужна: платформа (меню, выбор, рейтинг, профиль) работает мышью и тачем,
// камера включается на «Старт» подхода (или «Калибровка», или режим «Жесты») и гаснет при выходе в меню.

import { useCallback, useEffect, useRef, useState } from 'react';
import { createEngine, isMockRequested } from '../engine/createEngine';
import { unlockAudio } from './audio/sfx';
import { stopVoice, unlockVoice } from './audio/voice';
import { DwellProvider } from './components/dwell';
import { Stage } from './components/Stage';
import { TopBar } from './components/TopBar';
import { attachEngine, detachEngine, getEngine, setEngineMode, useEngineEvents } from './engine/bus';
import { clearFormError, setScene } from './engine/overlay';
import { DemoGuide } from './components/DemoGuide';
import type { Board } from '../shared/rating';
import { CHALLENGE_PLAN, DEMO_PLAN, QUICK_PLAN, singlePlan, type Plan } from './lib/exercises';
import { currentRoute, markCalibrated, routeOf, syncUrl, wasCalibrated } from './lib/route';
import { refreshMe, useAuth } from './store/api';
import type { SetResult } from './lib/results';
import { Auth } from './screens/Auth';
import { Calibration } from './screens/Calibration';
import { DemoIntro } from './screens/DemoIntro';
import { ErrorScreen } from './screens/ErrorScreen';
import { Intro } from './screens/Intro';
import { Landing } from './screens/Landing';
import { Leaderboard } from './screens/Leaderboard';
import { Loading } from './screens/Loading';
import { Menu } from './screens/Menu';
import { Picker } from './screens/Picker';
import { Profile } from './screens/Profile';
import { Summary } from './screens/Summary';
import { Workout } from './screens/Workout';

export type Screen =
  | { name: 'landing' }
  | { name: 'demo' }
  | { name: 'loading' }
  | { name: 'error'; message: string; code: string }
  | { name: 'calibration' }
  | { name: 'menu' }
  | { name: 'picker' }
  | { name: 'intro'; plan: Plan; index: number; results: SetResult[] }
  | { name: 'workout'; plan: Plan; index: number; results: SetResult[] }
  | { name: 'summary'; plan: Plan; results: SetResult[]; autoSave?: boolean }
  | { name: 'auth'; reason: 'save' | 'progress' | 'account'; pending?: string; back: Screen; next: Screen }
  | { name: 'profile' }
  | { name: 'leaderboard'; board?: Board };

/** План тренировки для доски рейтинга («Побить рекорд» из профиля). */
function planFor(board: Board): Plan {
  if (board === 'quick') return QUICK_PLAN;
  if (board === 'challenge') return CHALLENGE_PLAN;
  return singlePlan(board.slice(7) as Parameters<typeof singlePlan>[0]);
}

/** Затемнение видео и яркость скелета на каждом экране. */
const SCENE: Record<Screen['name'], [dim: number, skeleton: number]> = {
  landing: [0.9, 0],
  demo: [0.9, 0],
  loading: [0.8, 0],
  error: [0.9, 0],
  calibration: [0.25, 1],
  menu: [0.62, 0.3],
  picker: [0.62, 0.3],
  intro: [0.7, 0.2],
  workout: [0.12, 1],
  summary: [0.8, 0.12],
  auth: [0.88, 0.08],
  profile: [0.84, 0.1],
  leaderboard: [0.84, 0.1],
};

/** Экраны без камеры: пришли сюда — камеру выключаем (если не включены «Жесты»). */
const NO_CAMERA = new Set<Screen['name']>([
  'landing',
  'demo',
  'menu',
  'picker',
  'leaderboard',
  'profile',
  'auth',
]);

/** Экран по адресу при загрузке: обновление страницы оставляет на той же странице платформы. */
function initialScreen(): Screen {
  switch (currentRoute()) {
    case 'demo':
      return { name: 'demo' };
    case 'app':
      return { name: 'menu' };
    case 'rating':
      return { name: 'leaderboard' };
    case 'progress':
      return { name: 'profile' };
    case 'login':
      return { name: 'auth', reason: 'account', back: { name: 'menu' }, next: { name: 'menu' } };
    default:
      return { name: 'landing' };
  }
}

/**
 * Компьютер с мышью: курсор-рука — только в режиме «Жесты» (кнопка в шапке). Иначе, пока человек сидит у экрана,
 * поднятая рука сама «нажимает» кнопки удержанием. Телефон в 2–3 м (без мыши) управляется рукой как раньше.
 */
const HAS_MOUSE =
  typeof matchMedia === 'function' && matchMedia('(hover: hover) and (pointer: fine)').matches;

export function App() {
  const [screen, setScreen] = useState<Screen>(initialScreen);
  const [video, setVideo] = useState<HTMLVideoElement | null>(null);
  const [mock, setMock] = useState(() => isMockRequested());
  /** Демо-тур (кнопка «Смотреть демо»): после калибровки сразу идёт короткий план с подсказками. ?mock=1 — просто мок для разработки. */
  const [tour, setTour] = useState(false);
  const starting = useRef(false);
  /** Камера и движок запущены (живая камера, не мок). */
  const [camera, setCamera] = useState(false);
  /** «Жесты»: камера включена и в меню — управление рукой по всей платформе. */
  const [gestures, setGestures] = useState(false);
  /** Куда идти после запуска камеры и калибровки (например, в подход). */
  const afterCamera = useRef<Screen>({ name: 'menu' });
  const { user, known } = useAuth();

  // Вошёл ли пользователь раньше (cookie-сессия) — узнаём один раз при старте.
  useEffect(() => {
    void refreshMe();
  }, []);

  const go = useCallback((next: Screen) => {
    clearFormError();
    setScreen(next);
  }, []);

  // Сцена и режим движка следуют за экраном.
  useEffect(() => {
    const [dim, skeleton] = SCENE[screen.name];
    setScene(dim, skeleton);
    if (screen.name === 'calibration') setEngineMode('calibration');
    else if (screen.name !== 'workout' && getEngine()) setEngineMode('menu');
    if (screen.name !== 'workout') stopVoice();
  }, [screen.name]);

  // Ушли из тренировки в меню, рейтинг или профиль — камеру выключаем (демо-тур и «Жесты» — исключение).
  useEffect(() => {
    if (!NO_CAMERA.has(screen.name) || gestures || !getEngine()) return;
    if (tour && screen.name !== 'landing' && screen.name !== 'demo') return;
    detachEngine();
    const off = setTimeout(() => setCamera(false), 0);
    return () => clearTimeout(off);
  }, [screen.name, gestures, tour]);

  /**
   * Запуск камеры и движка, потом — калибровка (если в этой вкладке ещё не было) и экран then.
   * background — не трогать текущий экран (включили «Жесты» в меню).
   */
  const start = useCallback(
    async (forceMock?: boolean, opts: { background?: boolean; calibrate?: boolean; then?: Screen } = {}) => {
      if (starting.current || !video) return;
      starting.current = true;
      unlockAudio();
      unlockVoice();
      const useMock = forceMock ?? isMockRequested();
      setMock(useMock);
      afterCamera.current = opts.then ?? { name: 'menu' };
      if (!opts.background) go({ name: 'loading' });
      try {
        detachEngine();
        const engine = await createEngine({ mock: useMock });
        attachEngine(engine);
        await engine.start(video);
        setCamera(!useMock);
        const calibrate = useMock || opts.calibrate || !wasCalibrated();
        if (!opts.background) go(calibrate ? { name: 'calibration' } : afterCamera.current);
      } catch (err) {
        const e = err as { message?: string; code?: string };
        if (!opts.background)
          go({
            name: 'error',
            message: e.message || 'Не получилось запустить камеру',
            code: e.code ?? 'unknown',
          });
      } finally {
        starting.current = false;
      }
    },
    [video, go],
  );

  /** Экран, которому нужна камера: камера уже есть — сразу туда, нет — включаем (и калибруем) и потом туда. */
  const withCamera = useCallback(
    (next: Screen) => {
      if (getEngine()) go(next);
      else void start(undefined, { then: next });
    },
    [go, start],
  );

  // Звук и голос браузер разрешит после первого касания — разблокируем их по первому нажатию.
  // ?mock=1 (разработка, сквозные тесты) — мок-движок сразу, как раньше.
  const booted = useRef(false);
  useEffect(() => {
    if (!video || booted.current) return;
    booted.current = true;
    const boot = setTimeout(() => {
      if (isMockRequested() && currentRoute() === 'app') void start(true);
    }, 0);
    const unlock = () => {
      unlockAudio();
      unlockVoice();
    };
    window.addEventListener('pointerdown', unlock, { once: true });
    return () => {
      clearTimeout(boot);
      window.removeEventListener('pointerdown', unlock);
    };
  }, [video, start]);

  // Адрес следует за экраном; «Назад» в браузере — по адресу обратно.
  useEffect(() => {
    syncUrl(routeOf(screen.name, tour));
  }, [screen.name, tour]);
  useEffect(() => {
    const onPop = () => {
      const route = currentRoute();
      if (route === 'landing') go({ name: 'landing' });
      else if (route === 'demo') go({ name: 'demo' });
      else if (route === 'rating') go({ name: 'leaderboard' });
      else if (route === 'progress') go({ name: 'profile' });
      else if (route === 'login')
        go({ name: 'auth', reason: 'account', back: { name: 'menu' }, next: { name: 'menu' } });
      else go({ name: 'menu' });
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [go]);

  /** Выход из демо: останавливаем мок, убираем ?mock из адреса, возвращаемся на лендинг. */
  const exitDemo = useCallback(() => {
    getEngine()?.stop();
    setMock(false);
    setTour(false);
    const url = new URL(window.location.href);
    if (url.searchParams.has('mock')) {
      url.searchParams.delete('mock');
      window.history.replaceState(null, '', url);
    }
    go({ name: 'landing' });
  }, [go]);

  /** Из демо — к настоящей платформе: мок выключаем, камера включится на первом подходе. */
  const toCamera = useCallback(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.has('mock')) {
      url.searchParams.delete('mock');
      window.history.replaceState(null, '', url);
    }
    detachEngine();
    setMock(false);
    setTour(false);
    go({ name: 'menu' });
  }, [go]);

  /** «Жесты» в верхней панели: включить камеру и управлять рукой везде / выключить. */
  const toggleGestures = useCallback(() => {
    if (gestures) {
      setGestures(false);
      if (NO_CAMERA.has(screen.name)) {
        detachEngine();
        setCamera(false);
      }
      return;
    }
    setGestures(true);
    if (!getEngine()) void start(false, { then: screen });
  }, [gestures, screen, start]);

  const showGuide = mock && tour && !['landing', 'demo', 'error'].includes(screen.name);
  // Под подсказку тура резервируем низ экрана (DemoGuide.css, .is-demo), чтобы она ничего не закрывала.
  useEffect(() => {
    document.documentElement.classList.toggle('is-demo', showGuide);
  }, [showGuide]);

  // «Обе руки вверх» = «назад» на вспомогательных экранах. Тренировка и интро решают сами.
  // В демо жесты мока ничего не нажимают: там управляют мышью.
  useEngineEvents((e) => {
    if (mock || e.type !== 'gesture' || e.name !== 'both_hands_up') return;
    if (screen.name === 'auth') go(screen.back);
    else if (['picker', 'leaderboard', 'summary', 'profile'].includes(screen.name)) go({ name: 'menu' });
  });

  const startPlan = (plan: Plan) => go({ name: 'intro', plan, index: 0, results: [] });
  const openProgress = () =>
    user
      ? go({ name: 'profile' })
      : go({ name: 'auth', reason: 'progress', back: screen, next: { name: 'profile' } });
  const account = ['calibration', 'intro', 'workout', 'auth'].includes(screen.name)
    ? undefined
    : { label: user ? user.nick : 'Войти', signedIn: !!user, onSelect: openProgress };

  const onSetDone = (s: Extract<Screen, { name: 'workout' }>, result: SetResult) => {
    const results = [...s.results, result];
    const next = s.index + 1;
    if (!result.endedEarly && next < s.plan.items.length)
      go({ name: 'intro', plan: s.plan, index: next, results });
    else go({ name: 'summary', plan: s.plan, results });
  };

  return (
    <DwellProvider hand={!mock && (gestures || !HAS_MOUSE)}>
      <video ref={setVideo} className="camera-source" playsInline muted aria-hidden="true" />
      {screen.name !== 'landing' && !camera && !mock && <div className="app-grid" aria-hidden="true" />}
      {screen.name !== 'landing' && (camera || mock) && <Stage video={mock ? null : video} />}
      {!['landing', 'demo', 'loading', 'error'].includes(screen.name) && (
        <TopBar
          mock={mock}
          account={mock ? undefined : account}
          onHome={screen.name === 'menu' ? undefined : () => go({ name: 'menu' })}
          onExitDemo={mock ? exitDemo : undefined}
          gestures={
            mock || ['calibration', 'workout'].includes(screen.name)
              ? undefined
              : { on: gestures, onToggle: toggleGestures }
          }
        />
      )}

      {showGuide && <DemoGuide screen={screen.name} onExit={exitDemo} onCamera={toCamera} />}

      {screen.name === 'landing' && (
        <Landing onStart={() => go({ name: 'menu' })} onDemo={() => go({ name: 'demo' })} />
      )}
      {screen.name === 'demo' && (
        <DemoIntro
          onWatch={() => {
            setTour(true);
            void start(true);
          }}
          onCamera={toCamera}
          onBack={() => go({ name: 'landing' })}
        />
      )}
      {screen.name === 'loading' && <Loading mock={mock} />}
      {screen.name === 'error' && (
        <ErrorScreen
          message={screen.message}
          code={screen.code}
          onRetry={() => start(false)}
          onDemo={() => go({ name: 'demo' })}
        />
      )}
      {screen.name === 'calibration' && (
        <Calibration
          onDone={() => {
            if (tour) return startPlan(DEMO_PLAN);
            markCalibrated();
            go(afterCamera.current);
          }}
        />
      )}
      {screen.name === 'menu' && (
        <Menu
          onQuick={() => startPlan(QUICK_PLAN)}
          onPick={() => go({ name: 'picker' })}
          onChallenge={() => startPlan(CHALLENGE_PLAN)}
          onRecords={() => go({ name: 'leaderboard' })}
          onRecalibrate={() =>
            getEngine() ? go({ name: 'calibration' }) : void start(undefined, { calibrate: true })
          }
          onProgress={openProgress}
          hands={camera}
        />
      )}
      {screen.name === 'picker' && (
        <Picker onPick={(ex) => startPlan(singlePlan(ex))} onBack={() => go({ name: 'menu' })} />
      )}
      {screen.name === 'intro' && (
        <Intro
          key={`${screen.plan.kind}-${screen.index}`}
          plan={screen.plan}
          index={screen.index}
          // Без камеры «Старт» включает её (и калибровку) и возвращает сюда же — уже с ожиданием жеста готовности.
          // Мок (демо-тур) жестов не даёт — там старт сам по таймеру.
          onGo={() => (getEngine() ? go({ ...screen, name: 'workout' }) : withCamera(screen))}
          start={mock ? 'auto' : camera ? 'gesture' : 'button'}
          onBack={() => go({ name: 'menu' })}
        />
      )}
      {screen.name === 'workout' && (
        <Workout
          key={`${screen.plan.kind}-${screen.index}-${screen.results.length}`}
          plan={screen.plan}
          index={screen.index}
          onDone={(r) => onSetDone(screen, r)}
        />
      )}
      {screen.name === 'summary' && (
        <Summary
          plan={screen.plan}
          results={screen.results}
          onAgain={() => startPlan(screen.plan)}
          onMenu={() => go({ name: 'menu' })}
          // Мок не сохраняется в рейтинг; исключение — ?mock=1 в dev-сборке (сквозные тесты сохранения).
          demo={mock && (tour || !import.meta.env.DEV)}
          onCamera={toCamera}
          autoSave={screen.autoSave}
          onNeedAuth={(pending) =>
            go({
              name: 'auth',
              reason: 'save',
              pending,
              back: { ...screen, autoSave: false },
              next: { ...screen, autoSave: true },
            })
          }
          onBoard={(board) => go({ name: 'leaderboard', board })}
          onProgress={openProgress}
        />
      )}
      {screen.name === 'auth' && (
        <Auth
          reason={screen.reason}
          pending={screen.pending}
          onDone={() => go(screen.next)}
          onBack={() => go(screen.back)}
        />
      )}
      {/* «Мой прогресс» по прямой ссылке без входа — сначала вход. */}
      {screen.name === 'profile' && known && !user && (
        <Auth reason="progress" onDone={() => go({ name: 'profile' })} onBack={() => go({ name: 'menu' })} />
      )}
      {screen.name === 'profile' && (!known || user) && (
        <Profile
          onBack={() => go({ name: 'menu' })}
          onPlay={(board) => startPlan(planFor(board))}
          onBoard={(board) => go({ name: 'leaderboard', board })}
          onSignedOut={() => go({ name: 'menu' })}
        />
      )}
      {screen.name === 'leaderboard' && (
        <Leaderboard
          key={screen.board ?? 'quick'}
          initialBoard={screen.board}
          onBack={() => go({ name: 'menu' })}
          onSignIn={() => go({ name: 'auth', reason: 'account', back: screen, next: screen })}
        />
      )}
    </DwellProvider>
  );
}
