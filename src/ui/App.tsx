// U-02: экраны как машина состояний. Движок один на всё приложение (engine/bus.ts),
// режим движка выставляется по текущему экрану; сцена (видео + скелет) лежит под всеми экранами.

import { useCallback, useEffect, useRef, useState } from 'react';
import { createEngine, isMockRequested } from '../engine/createEngine';
import { unlockAudio } from './audio/sfx';
import { stopVoice, unlockVoice } from './audio/voice';
import { DwellProvider } from './components/dwell';
import { Stage } from './components/Stage';
import { TopBar } from './components/TopBar';
import { attachEngine, getEngine, setEngineMode, useEngineEvents } from './engine/bus';
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

/** Экран по адресу при загрузке: обновление страницы оставляет на той же странице платформы. */
function initialScreen(): Screen {
  switch (currentRoute()) {
    case 'demo':
      return { name: 'demo' };
    case 'app':
      return { name: 'loading' };
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

export function App() {
  const [screen, setScreen] = useState<Screen>(initialScreen);
  const [video, setVideo] = useState<HTMLVideoElement | null>(null);
  const [mock, setMock] = useState(() => isMockRequested());
  /** Демо-тур (кнопка «Смотреть демо»): после калибровки сразу идёт короткий план с подсказками. ?mock=1 — просто мок для разработки. */
  const [tour, setTour] = useState(false);
  const starting = useRef(false);
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

  /**
   * Запуск камеры и движка. background — не трогать текущий экран (после обновления на /app/rating);
   * skipCalibration — калибровку в этой вкладке уже прошли, сразу в меню.
   */
  const start = useCallback(
    async (forceMock?: boolean, opts: { background?: boolean; skipCalibration?: boolean } = {}) => {
      if (starting.current || !video) return;
      starting.current = true;
      unlockAudio();
      unlockVoice();
      const useMock = forceMock ?? isMockRequested();
      setMock(useMock);
      if (!opts.background) go({ name: 'loading' });
      try {
        getEngine()?.stop();
        const engine = await createEngine({ mock: useMock });
        attachEngine(engine);
        await engine.start(video);
        if (!opts.background) go(opts.skipCalibration ? { name: 'menu' } : { name: 'calibration' });
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

  // Открыли (или обновили) страницу платформы — камера включается сама. Звук и голос браузер разрешит
  // после первого касания, поэтому разблокируем их по первому нажатию.
  const booted = useRef(false);
  useEffect(() => {
    if (!video || booted.current) return;
    booted.current = true;
    const route = currentRoute();
    // Запуск — вне тела эффекта: start сразу меняет экран.
    const boot = setTimeout(() => {
      if (route === 'app') void start(undefined, { skipCalibration: wasCalibrated() });
      else if (route === 'rating' || route === 'progress' || route === 'login')
        void start(undefined, { background: true });
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
      else if (getEngine()) go({ name: 'menu' });
      else void start(undefined, { skipCalibration: wasCalibrated() });
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [go, start]);

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

  const toCamera = useCallback(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.has('mock')) {
      url.searchParams.delete('mock');
      window.history.replaceState(null, '', url);
    }
    setTour(false);
    void start(false);
  }, [start]);

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
    <DwellProvider hand={!mock}>
      <video ref={setVideo} className="camera-source" playsInline muted aria-hidden="true" />
      {screen.name !== 'landing' && <Stage video={mock ? null : video} />}
      {!['landing', 'demo', 'loading', 'error'].includes(screen.name) && (
        <TopBar
          mock={mock}
          account={mock ? undefined : account}
          onHome={screen.name === 'menu' ? undefined : () => go({ name: 'menu' })}
        />
      )}

      {showGuide && <DemoGuide screen={screen.name} onExit={exitDemo} onCamera={toCamera} />}

      {screen.name === 'landing' && <Landing onStart={() => start()} onDemo={() => go({ name: 'demo' })} />}
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
            go({ name: 'menu' });
          }}
        />
      )}
      {screen.name === 'menu' && (
        <Menu
          onQuick={() => startPlan(QUICK_PLAN)}
          onPick={() => go({ name: 'picker' })}
          onChallenge={() => startPlan(CHALLENGE_PLAN)}
          onRecords={() => go({ name: 'leaderboard' })}
          onRecalibrate={() => go({ name: 'calibration' })}
          onProgress={openProgress}
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
          onGo={() => go({ ...screen, name: 'workout' })}
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
