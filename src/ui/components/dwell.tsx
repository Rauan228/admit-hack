// U-06: курсор-рука и выбор удержанием. Движок шлёт pointer (доли экрана, уже зеркально),
// провайдер двигает курсор и ищет кнопку под ним; удержание DWELL_MS над одной кнопкой = нажатие.
// Прогресс пишется прямо в стиль элемента (--p), без ре-рендеров React на каждом кадре.

import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { live, useEngineEvents } from '../engine/bus';
import { sfx } from '../audio/sfx';
import './dwell.css';

export const DWELL_MS = 1200;
/** ?nodwell — курсор виден, но удержание не нажимает кнопки (скриншоты, запись демо мышью). */
const DWELL_DISABLED = new URLSearchParams(globalThis.location?.search ?? '').has('nodwell');
/** После выбора — пауза, чтобы та же рука не нажала следующую кнопку на месте старой. */
const COOLDOWN_MS = 700;
const TRAIL = 5;

interface Target {
  el: HTMLElement;
  onSelect: () => void;
  disabled: boolean;
}

interface Registry {
  register(t: Target): () => void;
}

const DwellContext = createContext<Registry | null>(null);

/** hand = false — курсор-рука выключен (демо без камеры: там кнопки нажимают мышью). */
export function DwellProvider({ children, hand = true }: { children: ReactNode; hand?: boolean }) {
  const handOn = useRef(hand);
  useEffect(() => {
    handOn.current = hand;
  }, [hand]);
  const targets = useRef(new Set<Target>());
  const cursorRef = useRef<HTMLDivElement>(null);
  const trailRefs = useRef<(HTMLSpanElement | null)[]>([]);
  const state = useRef({ hovered: null as Target | null, since: 0, cooldownUntil: 0 });

  const registry = useRef<Registry>({
    register(t) {
      targets.current.add(t);
      return () => {
        targets.current.delete(t);
        if (state.current.hovered === t) state.current.hovered = null;
      };
    },
  });

  useEngineEvents((e) => {
    if (e.type === 'pointer_lost' || e.type === 'gesture') resetHover();
  });

  function resetHover() {
    const h = state.current.hovered;
    if (h) {
      h.el.classList.remove('is-hover');
      h.el.style.setProperty('--p', '0');
    }
    state.current.hovered = null;
  }

  useEffect(() => {
    let raf = 0;
    // Шлейф: каждая точка догоняет предыдущую — курсор ощущается живым и видно направление руки.
    const trail = Array.from({ length: TRAIL }, () => ({ x: 0, y: 0 }));
    let trailReady = false;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      const cursor = cursorRef.current;
      const p = handOn.current ? live.pointer : null;
      const now = performance.now();
      if (!cursor) return;
      if (!p) {
        cursor.classList.remove('is-visible');
        trailRefs.current.forEach((el) => el?.classList.remove('is-visible'));
        trailReady = false;
        resetHover();
        return;
      }
      const x = p.x * window.innerWidth;
      const y = p.y * window.innerHeight;
      cursor.classList.add('is-visible');
      cursor.style.transform = `translate(${x}px, ${y}px)`;
      let lead = { x, y };
      trail.forEach((pt, i) => {
        if (!trailReady) Object.assign(pt, lead);
        pt.x += (lead.x - pt.x) * 0.45;
        pt.y += (lead.y - pt.y) * 0.45;
        const el = trailRefs.current[i];
        if (el) {
          el.classList.add('is-visible');
          el.style.transform = `translate(${pt.x}px, ${pt.y}px) scale(${1 - (i + 1) / (TRAIL + 2)})`;
        }
        lead = pt;
      });
      trailReady = true;

      let hit: Target | null = null;
      for (const t of targets.current) {
        if (t.disabled) continue;
        const r = t.el.getBoundingClientRect();
        // Небольшой запас вокруг кнопки: рукой сложнее попасть, чем мышью.
        const pad = 14;
        if (x >= r.left - pad && x <= r.right + pad && y >= r.top - pad && y <= r.bottom + pad) {
          hit = t;
          break;
        }
      }

      const s = state.current;
      if (hit !== s.hovered) {
        resetHover();
        if (hit && now >= s.cooldownUntil) {
          s.hovered = hit;
          s.since = now;
          hit.el.classList.add('is-hover');
          sfx.hover();
        }
      }
      const progress = s.hovered ? Math.min(1, (now - s.since) / DWELL_MS) : 0;
      cursor.style.setProperty('--p', String(progress));
      if (s.hovered) {
        s.hovered.el.style.setProperty('--p', String(progress));
        if (progress >= 1 && !DWELL_DISABLED) {
          const t = s.hovered;
          resetHover();
          s.cooldownUntil = now + COOLDOWN_MS;
          sfx.select();
          t.onSelect();
        }
      }
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <DwellContext.Provider value={registry.current}>
      {children}
      {Array.from({ length: TRAIL }, (_, i) => (
        <span
          key={i}
          ref={(el) => {
            trailRefs.current[i] = el;
          }}
          className="hand-trail"
          style={{ opacity: 0.5 - i * 0.08 }}
          aria-hidden="true"
        />
      ))}
      <div ref={cursorRef} className="hand-cursor" aria-hidden="true">
        <svg viewBox="0 0 64 64">
          <circle className="hand-cursor__track" cx="32" cy="32" r="26" />
          <circle className="hand-cursor__ring" cx="32" cy="32" r="26" pathLength="1" />
        </svg>
        <span className="hand-cursor__dot" />
      </div>
    </DwellContext.Provider>
  );
}

export interface DwellButtonProps {
  onSelect: () => void;
  children: ReactNode;
  className?: string;
  variant?: 'primary' | 'ghost' | 'default';
  size?: 'sm' | 'md' | 'lg';
  disabled?: boolean;
  ariaLabel?: string;
  style?: CSSProperties;
}

/** Кнопка, которую можно нажать рукой (удержание) или, запасным путём, мышью / пальцем. */
export function DwellButton({
  onSelect,
  children,
  className,
  variant = 'default',
  size = 'md',
  disabled = false,
  ariaLabel,
  style,
}: DwellButtonProps) {
  const registry = useContext(DwellContext);
  const ref = useRef<HTMLButtonElement>(null);
  const handler = useRef(onSelect);
  useLayoutEffect(() => {
    handler.current = onSelect;
  });

  useEffect(() => {
    const el = ref.current;
    if (!el || !registry) return;
    return registry.register({ el, onSelect: () => handler.current(), disabled });
  }, [registry, disabled]);

  const cls = [
    'btn',
    'dwell',
    variant !== 'default' ? `btn--${variant}` : '',
    size !== 'md' ? `btn--${size}` : '',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <button
      ref={ref}
      type="button"
      className={cls}
      disabled={disabled}
      aria-label={ariaLabel}
      style={style}
      onClick={() => {
        sfx.select();
        onSelect();
      }}
    >
      <span className="dwell__fill" aria-hidden="true" />
      <span className="dwell__label">{children}</span>
    </button>
  );
}
