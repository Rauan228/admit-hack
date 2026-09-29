// U-05: калибровка. Движок сам говорит, что не так (отойди, повернись, добавь света),
// экран показывает это крупно, озвучивает и переходит в меню, когда «ok» держится 1,5 с.

import { useEffect, useRef, useState } from 'react';
import type { CalibrationStatus } from '../../engine/types';
import { isMobileDevice } from '../../engine/perf';
import { say } from '../audio/voice';
import { sfx } from '../audio/sfx';
import { Icon, type IconName } from '../components/Icon';
import { useEngineEvents } from '../engine/bus';
import './Calibration.css';

const HOLD_MS = 1500;

const CHECKS: { label: string; icon: IconName }[] = [
  { label: 'Свет', icon: 'zap' },
  { label: 'Человек в кадре', icon: 'user' },
  { label: 'Видно целиком', icon: 'scan' },
  { label: 'Расстояние', icon: 'target' },
];
/** На какой проверке остановился статус движка. */
const FAIL_STEP: Record<CalibrationStatus, number> = {
  dark: 0,
  no_person: 1,
  partial: 2,
  too_close: 3,
  too_far: 3,
  ok: 4,
};

export function Calibration({ onDone }: { onDone: () => void }) {
  const [status, setStatus] = useState<CalibrationStatus | null>(null);
  const [hint, setHint] = useState('Встань так, чтобы тебя было видно целиком');
  const [okSince, setOkSince] = useState<number | null>(null);
  const [progress, setProgress] = useState(0);
  const lastHint = useRef('');
  const done = useRef(false);
  const mobile = isMobileDevice();

  useEffect(() => {
    say('Встань так, чтобы тебя было видно целиком');
  }, []);

  useEngineEvents((e) => {
    if (e.type !== 'calibration') return;
    setStatus(e.status);
    setHint(e.hint);
    if (e.status === 'ok') setOkSince((s) => s ?? performance.now());
    else setOkSince(null);
    if (e.hint !== lastHint.current) {
      lastHint.current = e.hint;
      say(e.hint, e.status === 'ok' ? 'info' : 'hint');
    }
  });

  useEffect(() => {
    if (okSince === null) return;
    let raf = 0;
    const tick = () => {
      const p = Math.min(1, (performance.now() - okSince) / HOLD_MS);
      setProgress(p);
      if (p >= 1) {
        if (!done.current) {
          done.current = true;
          sfx.select();
          onDone();
        }
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      setProgress(0);
    };
  }, [okSince, onDone]);

  const ok = status === 'ok';
  // Проверки кадра идут по порядку (как в движке): свет → человек → целиком → расстояние.
  // Статус называет первую непройденную; всё до неё — пройдено, после — ещё не проверено.
  const failed = status === null ? -1 : FAIL_STEP[status];
  return (
    <main className="screen calib">
      {/* Мягкая скруглённая рамка-ориентир: куда встать. Зелёная, когда всё хорошо. */}
      <div className={`calib__frame ${ok ? 'is-ok' : status ? 'is-bad' : ''}`} aria-hidden="true" />

      <header className="calib__head">
        <h1 className="calib__title">Встань так, чтобы тебя было видно целиком</h1>
        <span className={`calib__chip ${ok ? 'is-ok' : status ? 'is-bad' : ''}`} aria-live="polite">
          {ok ? <Icon name="check" size={16} /> : <i />}
          {ok ? 'Вижу тебя целиком' : hint}
        </span>
      </header>

      <section className={`calib__panel ${ok ? 'is-ok' : ''}`} aria-live="polite">
        <div className="calib__panel-head">
          <b>Проверка кадра</b>
          <span className="calib__count">
            {Math.max(0, Math.min(CHECKS.length, failed))} из {CHECKS.length}
          </span>
        </div>
        <ul className="calib__checks">
          {CHECKS.map((c, i) => {
            const state = failed < 0 ? 'wait' : i < failed ? 'done' : i === failed ? 'bad' : 'wait';
            return (
              <li key={c.label} className={`is-${state}`}>
                <span className="calib__mark">
                  <Icon name={state === 'done' ? 'check' : state === 'bad' ? 'alert' : c.icon} size={18} />
                </span>
                <span className="calib__check-label">{c.label}</span>
              </li>
            );
          })}
        </ul>
        <div className="calib__progress" role="progressbar" aria-valuenow={Math.round(progress * 100)}>
          <span style={{ transform: `scaleX(${progress})` }} />
        </div>
        <p className="calib__tip">
          {mobile
            ? 'Поставь телефон вертикально у стены на уровне пояса и отойди на 2–3 шага.'
            : 'Отойди на 2–3 метра от камеры, чтобы в кадр попали голова и стопы.'}
        </p>
        <button type="button" className="btn btn--ghost btn--sm calib__skip" onClick={onDone}>
          Пропустить
        </button>
      </section>
    </main>
  );
}
