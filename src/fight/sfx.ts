// Звуки боя (E-36), синтез WebAudio без файлов: удар, блок, свист замаха, пропущенный удар, гонг, нокаут.
// Свой AudioContext (общий sfx платформы — только интерфейсные звуки). Создаётся по первому жесту.

let ctx: AudioContext | null = null;
let noise: AudioBuffer | null = null;

export function unlockFightAudio(): void {
  try {
    ctx ??= new AudioContext();
    if (ctx.state === 'suspended') void ctx.resume();
  } catch {
    ctx = null;
  }
}

function noiseBuffer(ac: AudioContext): AudioBuffer {
  if (noise) return noise;
  const buf = ac.createBuffer(1, ac.sampleRate, ac.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i += 1) d[i] = Math.random() * 2 - 1;
  noise = buf;
  return buf;
}

/** Шумовой удар через фильтр: f — частота фильтра, dur — длительность. */
function thud(f: number, dur: number, gain: number, type: BiquadFilterType = 'lowpass', at = 0): void {
  if (!ctx) return;
  const t0 = ctx.currentTime + 0.005 + at;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(ctx);
  const flt = ctx.createBiquadFilter();
  flt.type = type;
  flt.frequency.setValueAtTime(f, t0);
  flt.Q.value = 0.8;
  const g = ctx.createGain();
  g.gain.setValueAtTime(gain, t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  src.connect(flt).connect(g).connect(ctx.destination);
  src.start(t0);
  src.stop(t0 + dur + 0.02);
}

function tone(f: number, to: number | null, dur: number, gain: number, type: OscillatorType, at = 0): void {
  if (!ctx) return;
  const t0 = ctx.currentTime + 0.005 + at;
  const osc = ctx.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(f, t0);
  if (to) osc.frequency.exponentialRampToValueAtTime(to, t0 + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(gain, t0 + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g).connect(ctx.destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}

function vibrate(pattern: number | number[]): void {
  try {
    navigator.vibrate?.(pattern);
  } catch {
    /* нет вибро — ок */
  }
}

export const fightSfx = {
  /** Твой удар попал: глухой хлопок + низкий тон. */
  punch(combo: number): void {
    thud(900 + combo * 120, 0.12, 0.5);
    tone(140 + combo * 10, 70, 0.14, 0.25, 'sine');
    vibrate(25);
  },
  /** Бот заблокировал — сухой щелчок. */
  blockedByBot(): void {
    thud(2600, 0.06, 0.25, 'highpass');
    tone(520, 380, 0.08, 0.1, 'triangle');
  },
  /** Замах бота — свист. */
  whoosh(): void {
    thud(600, 0.3, 0.2, 'bandpass');
    tone(300, 900, 0.3, 0.05, 'sine');
  },
  /** Пропущенный удар — тяжёлый. */
  hurt(): void {
    thud(300, 0.25, 0.7);
    tone(110, 45, 0.3, 0.3, 'sawtooth');
    vibrate([60, 30, 60]);
  },
  /** Ты в блоке — удар в перчатки. */
  guard(): void {
    thud(1400, 0.1, 0.3);
    tone(330, 240, 0.1, 0.1, 'triangle');
    vibrate(20);
  },
  /** Уклон — лёгкий свист мимо. */
  dodge(): void {
    thud(1800, 0.2, 0.12, 'bandpass');
    tone(700, 1400, 0.18, 0.05, 'sine');
  },
  /** Гонг раунда. */
  bell(): void {
    tone(1180, null, 0.9, 0.18, 'sine');
    tone(1770, null, 0.6, 0.08, 'sine');
    tone(590, null, 1.2, 0.1, 'triangle');
    thud(3000, 0.05, 0.2, 'highpass');
  },
  tick(): void {
    tone(740, null, 0.08, 0.06, 'square');
  },
  go(): void {
    tone(988, null, 0.35, 0.1, 'square');
    thud(1200, 0.2, 0.3);
  },
  ko(): void {
    tone(220, 55, 0.9, 0.3, 'sawtooth');
    thud(200, 0.6, 0.8);
    vibrate([80, 40, 160]);
  },
  fanfare(): void {
    [523, 659, 784, 1047].forEach((f, i) => tone(f, null, 0.3, 0.16, 'triangle', i * 0.11));
    vibrate([60, 40, 120]);
  },
};
