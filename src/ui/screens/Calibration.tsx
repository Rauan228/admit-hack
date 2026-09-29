// U-05: калибровка. Движок сам говорит, что не так (отойди, повернись, добавь света),
// экран показывает это крупно, озвучивает и переходит в меню, когда «ok» держится 1,5 с.

import { useEffect, useRef, useState } from 'react';
import type { CalibrationStatus } from '../../engine/types';
import { isMobileDevice } from '../../engine/perf';
import { say } from '../audio/voice';
import { sfx } from '../audio/sfx';
import { Icon } from '../components/Icon';
import { useEngineEvents } from '../engine/bus';
import './Calibration.css';

const HOLD_MS = 1500;

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
  return (
    <main className="screen calib">
      <div className={`calib__frame ${ok ? 'is-ok' : status ? 'is-bad' : ''}`} aria-hidden="true">
        <svg viewBox="0 0 100 200" preserveAspectRatio="xMidYMid meet" className="calib__silhouette">
          <circle cx="50" cy="22" r="13" />
          <path d="M50 37v62M50 99l-17 80M50 99l17 80M22 52l28 8 28-8M22 52l-6 46M78 52l6 46" />
        </svg>
        <span className="calib__corner calib__corner--tl" />
        <span className="calib__corner calib__corner--tr" />
        <span className="calib__corner calib__corner--bl" />
        <span className="calib__corner calib__corner--br" />
      </div>

      <section className="calib__panel card" aria-live="polite">
        <span className={`badge ${ok ? 'badge--good' : 'badge--primary'}`}>
          {ok ? <Icon name="check" size={16} /> : <Icon name="user" size={16} />}
          {ok ? 'Вижу тебя целиком' : 'Калибровка'}
        </span>
        <h2 className="calib__hint">{hint}</h2>
        <div className="calib__progress" role="progressbar" aria-valuenow={Math.round(progress * 100)}>
          <span style={{ transform: `scaleX(${progress})` }} />
        </div>
        <p className="muted calib__tip">
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
