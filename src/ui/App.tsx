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
import { CHALLENGE_PLAN, QUICK_PLAN, singlePlan, type Plan } from './lib/exercises';
import type { SetResult } from './lib/results';
import { Calibration } from './screens/Calibration';
import { ErrorScreen } from './screens/ErrorScreen';
import { Intro } from './screens/Intro';
import { Landing } from './screens/Landing';
import { Leaderboard } from './screens/Leaderboard';
import { Loading } from './screens/Loading';
import { Menu } from './screens/Menu';
import { NamePicker } from './screens/NamePicker';
import { Picker } from './screens/Picker';
import { Summary, type PendingRecord } from './screens/Summary';
import { Workout } from './screens/Workout';

export type Screen =
  | { name: 'landing' }
  | { name: 'loading' }
  | { name: 'error'; message: string; code: string }
  | { name: 'calibration' }
  | { name: 'menu' }
  | { name: 'picker' }
  | { name: 'intro'; plan: Plan; index: number; results: SetResult[] }
  | { name: 'workout'; plan: Plan; index: number; results: SetResult[] }
  | { name: 'summary'; plan: Plan; results: SetResult[] }
  | { name: 'name'; record: PendingRecord }
  | { name: 'leaderboard'; highlight?: string };

/** Затемнение видео и яркость скелета на каждом экране. */
const SCENE: Record<Screen['name'], [dim: number, skeleton: number]> = {
  landing: [0.9, 0],
  loading: [0.8, 0],
  error: [0.9, 0],
  calibration: [0.25, 1],
  menu: [0.62, 0.3],
  picker: [0.62, 0.3],
  intro: [0.7, 0.2],
  workout: [0.12, 1],
  summary: [0.8, 0.12],
  name: [0.8, 0.12],
  leaderboard: [0.8, 0.12],
};

export function App() {
  const [screen, setScreen] = useState<Screen>({ name: 'landing' });
  const [video, setVideo] = useState<HTMLVideoElement | null>(null);
  const [mock, setMock] = useState(() => isMockRequested());
  const starting = useRef(false);

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

  const start = useCallback(
    async (forceMock?: boolean) => {
      if (starting.current || !video) return;
      starting.current = true;
      unlockAudio();
      unlockVoice();
      const useMock = forceMock ?? isMockRequested();
      setMock(useMock);
      go({ name: 'loading' });
      try {
        getEngine()?.stop();
        const engine = await createEngine({ mock: useMock });
        attachEngine(engine);
        await engine.start(video);
        go({ name: 'calibration' });
      } catch (err) {
        const e = err as { message?: string; code?: string };
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

  // «Обе руки вверх» = «назад» на вспомогательных экранах. Тренировка и интро решают сами.
  useEngineEvents((e) => {
    if (e.type !== 'gesture' || e.name !== 'both_hands_up') return;
    if (['picker', 'leaderboard', 'summary', 'name'].includes(screen.name)) go({ name: 'menu' });
  });

  const startPlan = (plan: Plan) => go({ name: 'intro', plan, index: 0, results: [] });

  const onSetDone = (s: Extract<Screen, { name: 'workout' }>, result: SetResult) => {
    const results = [...s.results, result];
    const next = s.index + 1;
    if (!result.endedEarly && next < s.plan.items.length)
      go({ name: 'intro', plan: s.plan, index: next, results });
    else go({ name: 'summary', plan: s.plan, results });
  };

  return (
    <DwellProvider>
      <video ref={setVideo} className="camera-source" playsInline muted aria-hidden="true" />
      {screen.name !== 'landing' && <Stage video={mock ? null : video} />}
      {!['landing', 'loading', 'error'].includes(screen.name) && (
        <TopBar mock={mock} onHome={screen.name === 'menu' ? undefined : () => go({ name: 'menu' })} />
      )}

      {screen.name === 'landing' && <Landing onStart={() => start()} onDemo={() => start(true)} />}
      {screen.name === 'loading' && <Loading mock={mock} />}
      {screen.name === 'error' && (
        <ErrorScreen
          message={screen.message}
          code={screen.code}
          onRetry={() => start(false)}
          onDemo={() => start(true)}
        />
      )}
      {screen.name === 'calibration' && <Calibration onDone={() => go({ name: 'menu' })} />}
      {screen.name === 'menu' && (
        <Menu
          onQuick={() => startPlan(QUICK_PLAN)}
          onPick={() => go({ name: 'picker' })}
          onChallenge={() => startPlan(CHALLENGE_PLAN)}
          onRecords={() => go({ name: 'leaderboard' })}
          onRecalibrate={() => go({ name: 'calibration' })}
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
          onSave={(record) => go({ name: 'name', record })}
        />
      )}
      {screen.name === 'name' && (
        <NamePicker record={screen.record} onSaved={(id) => go({ name: 'leaderboard', highlight: id })} />
      )}
      {screen.name === 'leaderboard' && (
        <Leaderboard highlight={screen.highlight} onBack={() => go({ name: 'menu' })} />
      )}
    </DwellProvider>
  );
}
