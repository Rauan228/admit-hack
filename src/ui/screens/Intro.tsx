// U-12: интро упражнения — 3D-атлет показывает правильное движение. Старт подхода:
// - камера работает — ждём «обе руки над головой» (жест готовности; вместо отсчёта 3-2-1): человек
//   сам решает, когда встал в кадр и готов. Кнопка «Начать сейчас» остаётся запасным путём;
// - мок / демо-тур — жестов нет, старт сам через пару секунд, чтобы тур шёл без рук;
// - камеры нет — ждём «Старт»: он включит камеру и вернёт сюда же, уже с ожиданием жеста.
// Человек может повторить за атлетом (в «звёздочке» руки вверху) и стартовать раньше, чем хотел, —
// цена ошибки низкая: подход и так вот-вот начнётся. Руки, ещё поднятые на старте подхода, его
// досрочно не закончат: трекер жестов после смены режима ждёт, пока они опустятся (gestures.ts).

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { say } from '../audio/voice';
import { sfx } from '../audio/sfx';
import { DwellButton } from '../components/dwell';
import { Ghost } from '../components/Ghost';
import { HoldGauge } from '../components/HoldGauge';
import { Icon } from '../components/Icon';
import { useEngineEvents } from '../engine/bus';
import { MUSCLE_NAMES } from '../lib/athlete';
import { EXERCISE_META, type Plan } from '../lib/exercises';
import { order } from '../lib/motion';
import './Intro.css';

/** Как стартует подход: по жесту (камера), сам (мок/демо) или только кнопкой (камеры ещё нет). */
export type IntroStart = 'gesture' | 'auto' | 'button';

const DEMO_MS = 3600;
/** Автостарт без жестов: после одного показа атлета плюс пауза. */
const AUTO_MS = DEMO_MS + 1500;
/** «Поехали!» на экране — и в подход: человек успевает опустить руки. */
const GO_MS = 700;

export function Intro({
  plan,
  index,
  onGo,
  onBack,
  start = 'gesture',
}: {
  plan: Plan;
  index: number;
  onGo: () => void;
  onBack: () => void;
  start?: IntroStart;
}) {
  const item = plan.items[index] ?? plan.items[0]!;
  const meta = EXERCISE_META[item.exercise];
  const next = plan.items[index + 1];
  /** Старт принят: показываем «Поехали!» и через GO_MS уходим в подход. */
  const [going, setGoing] = useState(false);
  const goRef = useRef(onGo);
  useLayoutEffect(() => {
    goRef.current = onGo;
  });

  // Старт принимается один раз (жест, кнопка и автостарт могут совпасть); таймер перехода гасим при уходе.
  const started = useRef(false);
  const goTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const launch = useCallback(() => {
    if (started.current) return;
    started.current = true;
    setGoing(true);
    sfx.go();
    say('Поехали!', 'count');
    goTimer.current = setTimeout(() => goRef.current(), GO_MS);
  }, []);
  useEffect(
    () => () => {
      if (goTimer.current) clearTimeout(goTimer.current);
    },
    [],
  );

  useEffect(() => {
    const ready = start === 'gesture' ? ' Готов — подними обе руки.' : '';
    say(`${index > 0 ? 'Следующее: ' : ''}${meta.title}. ${meta.cues[0]}.${ready}`, 'info');
    if (start !== 'auto') return;
    const timer = setTimeout(launch, AUTO_MS);
    return () => clearTimeout(timer);
  }, [index, meta, start, launch]);

  /** Удержание жеста 0…1 — крупный индикатор «держи», чтобы человек видел, что старт принят. */
  const [hold, setHold] = useState(0);
  useEngineEvents((e) => {
    if (start !== 'gesture') return;
    if (e.type === 'gesture_hold') setHold(e.progress);
    else if (e.type === 'gesture' && e.name === 'both_hands_up') launch();
  });

  const goal = plan.timeLimitSec
    ? `${plan.timeLimitSec} секунд`
    : item.exercise === 'lunge'
      ? `${item.target} × обе ноги`
      : meta.unit === 'sec'
        ? `${item.target} секунд`
        : `${item.target} повторений`;

  const note =
    start === 'gesture'
      ? `Готов? Подними обе руки над головой — начнём.${
          meta.handsUpToFinish ? ' Во время подхода тот же жест закончит его раньше.' : ''
        }`
      : start === 'auto'
        ? 'Старт через пару секунд — встань в кадр.'
        : 'Включим камеру: встань в 2–3 метрах, чтобы было видно целиком.';

  return (
    <main className="page intro">
      <div className="page__inner intro__grid">
        <section className="intro__stage">
          <Ghost exercise={item.exercise} className="intro__canvas" />
          {start === 'gesture' && !going && (
            <div className="intro__ready" role="status">
              <Icon name="arms" size={20} /> Подними обе руки — и начнём
            </div>
          )}
        </section>

        <section className="intro__copy">
          <button type="button" className="back-link" onClick={onBack}>
            <Icon name="back" size={16} /> В меню
          </button>
          {plan.items.length > 1 && (
            <span className="tag">
              Упражнение {index + 1} из {plan.items.length}
            </span>
          )}
          <h1 className="intro__title rise" style={order(0)}>
            {meta.title}
          </h1>
          <div className="intro__chips rise" style={order(1)}>
            <span className="intro__goal">
              <Icon name="target" size={16} /> {goal}
            </span>
            {plan.timeLimitSec && <span className="intro__chip">максимум чистых</span>}
          </div>

          <ol className="intro__cues">
            {meta.cues.map((c, i) => (
              <li key={c} className="rise" style={order(i + 2)}>
                <span>{i + 1}</span> {c}
              </li>
            ))}
          </ol>

          <p className="muscles rise" style={order(5)}>
            <i aria-hidden="true" /> {MUSCLE_NAMES[item.exercise].join(' · ')}
          </p>
          {meta.setup && (
            <p className="intro__setup rise" style={order(5)}>
              <Icon name="camera" size={18} /> {meta.setup}
            </p>
          )}

          {next && (
            <p className="intro__next">
              <span className="tag">Далее:</span> {EXERCISE_META[next.exercise].title}
            </p>
          )}

          <div className="intro__actions rise" style={order(6)}>
            <DwellButton
              variant="primary"
              size="lg"
              className="intro__start"
              onSelect={start === 'button' ? onGo : launch}
            >
              <Icon name="play" size={18} /> {start === 'button' ? 'Старт' : 'Начать сейчас'}
            </DwellButton>
            <p className="intro__note">{note}</p>
          </div>
        </section>
      </div>

      {!going && (
        <HoldGauge
          progress={hold}
          title={`Начинаем: ${meta.title}`}
          hint="Держи руки вверху — старт, когда полоса заполнится"
        />
      )}
      {going && (
        <div className="intro__count intro__count--go" aria-live="assertive">
          <svg viewBox="0 0 100 100" className="intro__count-ring" aria-hidden="true">
            <circle cx="50" cy="50" r="46" pathLength="1" />
          </svg>
          <span>Поехали!</span>
        </div>
      )}
    </main>
  );
}
