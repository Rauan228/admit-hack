// U-14: звуки интерфейса, синтезированные WebAudio — без файлов, мгновенно, работают офлайн.
// AudioContext создаётся по первому жесту (кнопка «Начать»): иначе браузер не даст звук.

import { loadMuted } from '../store/progress';

let ctx: AudioContext | null = null;
let muted = loadMuted();

export function unlockAudio(): void {
  try {
    ctx ??= new AudioContext();
    if (ctx.state === 'suspended') void ctx.resume();
  } catch {
    ctx = null;
  }
}

export function setSfxMuted(value: boolean): void {
  muted = value;
}

interface Tone {
  f: number;
  /** Частота в конце (глиссандо). */
  to?: number;
  dur: number;
  type?: OscillatorType;
  gain?: number;
  at?: number;
}

function play(tones: Tone[]): void {
  if (muted || !ctx) return;
  const t0 = ctx.currentTime + 0.01;
  for (const t of tones) {
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    const start = t0 + (t.at ?? 0);
    osc.type = t.type ?? 'sine';
    osc.frequency.setValueAtTime(t.f, start);
    if (t.to) osc.frequency.exponentialRampToValueAtTime(t.to, start + t.dur);
    const peak = t.gain ?? 0.18;
    g.gain.setValueAtTime(0.0001, start);
    g.gain.exponentialRampToValueAtTime(peak, start + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, start + t.dur);
    osc.connect(g).connect(ctx.destination);
    osc.start(start);
    osc.stop(start + t.dur + 0.02);
  }
}

function vibrate(pattern: number | number[]): void {
  if (muted) return;
  try {
    navigator.vibrate?.(pattern);
  } catch {
    /* нет вибро — ок */
  }
}

export const sfx = {
  hover: () => play([{ f: 660, dur: 0.05, type: 'triangle', gain: 0.05 }]),
  select: () => {
    play([
      { f: 520, dur: 0.09, type: 'triangle', gain: 0.14 },
      { f: 880, dur: 0.14, type: 'triangle', gain: 0.14, at: 0.07 },
    ]);
    vibrate(20);
  },
  repClean: () => {
    play([
      { f: 880, dur: 0.12, type: 'sine', gain: 0.2 },
      { f: 1320, dur: 0.22, type: 'sine', gain: 0.16, at: 0.08 },
    ]);
    vibrate(30);
  },
  repFlawed: () => play([{ f: 440, dur: 0.16, type: 'triangle', gain: 0.14 }]),
  error: () => {
    play([{ f: 220, to: 170, dur: 0.22, type: 'sawtooth', gain: 0.06 }]);
    vibrate([40, 40, 40]);
  },
  tick: () => play([{ f: 740, dur: 0.08, type: 'square', gain: 0.06 }]),
  go: () => play([{ f: 988, dur: 0.35, type: 'square', gain: 0.08 }]),
  fanfare: () => {
    const notes = [523, 659, 784, 1047];
    play(notes.map((f, i) => ({ f, dur: 0.28, type: 'triangle' as const, gain: 0.16, at: i * 0.11 })));
    vibrate([60, 40, 120]);
  },
};
