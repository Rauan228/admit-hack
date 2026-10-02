// Звуки боя (E-36, U-25): синтез WebAudio без файлов — удары, блоки, свист замаха, гонг и стадион.
// Свой AudioContext (общий sfx платформы — только интерфейсные звуки). Создаётся по первому жесту.
//
// Микшер: всё → общий фильтр (мощный пропущенный удар «глушит» звук, будто заложило уши) → компрессор →
// выход; толпа и удары ещё и в реверберацию зала (импульс — сгенерированный шум с затуханием).
//
// Толпа:
// - гул — шум в полосах речи, громкость плавает (много людей говорят разом), растёт с накалом боя;
// - реакции — хор «голосов» (пилы со своей высотой и вибрато) через фильтры гласных: «оо» на попадание,
//   «аа» и рёв со свистом на мощный удар и нокдаун, вздох на пропущенный, «буу», если бой стоит;
// - аплодисменты — заранее собранный буфер из сотен хлопков (короткие отфильтрованные щелчки шума).

let ctx: AudioContext | null = null;
let noise: AudioBuffer | null = null;
let claps: AudioBuffer | null = null;
let bus: { master: GainNode; muffle: BiquadFilterNode; dry: GainNode; wet: GainNode } | null = null;
let bed: { gain: GainNode; bands: { g: GainNode; f: BiquadFilterNode }[] } | null = null;
/** Накал толпы 0…1: растёт от событий, сам остывает. */
let heat = 0.25;
let heatAt = 0;
let lastBabble = 0;

export function unlockFightAudio(): void {
  try {
    ctx ??= new AudioContext();
    if (ctx.state === 'suspended') void ctx.resume();
    bus ??= makeBus(ctx);
  } catch {
    ctx = null;
  }
}

function makeBus(ac: AudioContext) {
  const comp = ac.createDynamicsCompressor();
  comp.threshold.value = -14;
  comp.knee.value = 10;
  comp.ratio.value = 4;
  comp.attack.value = 0.003;
  comp.release.value = 0.2;
  comp.connect(ac.destination);
  const muffle = ac.createBiquadFilter();
  muffle.type = 'lowpass';
  muffle.frequency.value = 20000;
  muffle.Q.value = 0.7;
  muffle.connect(comp);
  const master = ac.createGain();
  master.gain.value = 0.9;
  master.connect(muffle);
  const dry = ac.createGain();
  dry.connect(master);
  const verb = ac.createConvolver();
  verb.buffer = impulse(ac, 2.6);
  const wet = ac.createGain();
  wet.gain.value = 0.9;
  wet.connect(verb).connect(master);
  return { master, muffle, dry, wet };
}

/** Импульс зала: стерео-шум с экспоненциальным затуханием, хвост темнее начала. */
function impulse(ac: AudioContext, sec: number): AudioBuffer {
  const n = Math.floor(ac.sampleRate * sec);
  const buf = ac.createBuffer(2, n, ac.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    let lp = 0;
    for (let i = 0; i < n; i++) {
      const t = i / ac.sampleRate;
      const k = Math.min(0.95, 0.2 + t * 0.5);
      lp = lp * k + (Math.random() * 2 - 1) * (1 - k);
      d[i] = lp * Math.exp(-t / 0.75) * (t < 0.012 ? t / 0.012 : 1) * 1.6;
    }
  }
  return buf;
}

function noiseBuffer(ac: AudioContext): AudioBuffer {
  if (noise) return noise;
  const buf = ac.createBuffer(1, ac.sampleRate * 2, ac.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i += 1) d[i] = Math.random() * 2 - 1;
  noise = buf;
  return buf;
}

/** Куда подключать: сухой выход и (доля) реверберации. */
function out(node: AudioNode, wet = 0.2): void {
  if (!bus || !ctx) return;
  node.connect(bus.dry);
  if (wet > 0) {
    const s = ctx.createGain();
    s.gain.value = wet;
    node.connect(s).connect(bus.wet);
  }
}

/** Шумовой удар через фильтр: f — частота фильтра, dur — длительность. */
function thud(
  f: number,
  dur: number,
  gain: number,
  type: BiquadFilterType = 'lowpass',
  at = 0,
  wet = 0.15,
  q = 0.8,
): void {
  if (!ctx) return;
  const t0 = ctx.currentTime + 0.005 + at;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(ctx);
  const flt = ctx.createBiquadFilter();
  flt.type = type;
  flt.frequency.setValueAtTime(f, t0);
  flt.Q.value = q;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(gain, t0 + 0.002);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  src.connect(flt).connect(g);
  out(g, wet);
  src.start(t0, Math.random() * 1.5);
  src.stop(t0 + dur + 0.02);
}

function tone(
  f: number,
  to: number | null,
  dur: number,
  gain: number,
  type: OscillatorType,
  at = 0,
  wet = 0.1,
): void {
  if (!ctx) return;
  const t0 = ctx.currentTime + 0.005 + at;
  const osc = ctx.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(f, t0);
  if (to) osc.frequency.exponentialRampToValueAtTime(to, t0 + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(gain, t0 + 0.004);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g);
  out(g, wet);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}

/** Удар кулака: бас (тело удара), шлепок кожи, хлопок воздуха; weight 0…1 — от джеба до тяжёлого. */
function impact(weight: number, bright = 1, wet = 0.18): void {
  const w = Math.max(0, Math.min(1, weight));
  tone(120 + 40 * (1 - w), 42, 0.12 + 0.18 * w, 0.55 + 0.4 * w, 'sine', 0, wet * 0.5);
  thud(2600 * bright, 0.045 + 0.02 * w, 0.5 + 0.3 * w, 'bandpass', 0, wet, 0.9);
  thud(5200 * bright, 0.02, 0.22, 'highpass', 0, wet * 0.5);
  thud(420, 0.09 + 0.1 * w, 0.6 + 0.4 * w, 'lowpass', 0.003, wet);
}

function vibrate(pattern: number | number[]): void {
  try {
    navigator.vibrate?.(pattern);
  } catch {
    /* нет вибро — ок */
  }
}

export const fightSfx = {
  /** Твой удар попал: weight — тяжесть (контратака и сорванный замах — тяжелее), combo — серия. */
  punch(combo: number, weight = 0.3): void {
    impact(weight + Math.min(0.3, combo * 0.05), 1 + combo * 0.04);
    vibrate(25);
  },
  /** Удар в корпус — глуше, и бот выдыхает. */
  body(): void {
    impact(0.55, 0.6);
    grunt(140, 0.18);
    vibrate(30);
  },
  /** Бот заблокировал — удар в перчатки: мягкий плотный хлопок без баса. */
  blockedByBot(): void {
    thud(900, 0.07, 0.45, 'lowpass', 0, 0.12);
    thud(1800, 0.03, 0.2, 'bandpass', 0, 0.1);
    tone(220, 160, 0.06, 0.12, 'triangle');
  },
  /** Замах бота — свист: мощный — длиннее и ниже. */
  whoosh(power = false): void {
    if (!ctx) return;
    const t0 = ctx.currentTime + 0.005;
    const dur = power ? 0.42 : 0.22;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer(ctx);
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.Q.value = 1.4;
    f.frequency.setValueAtTime(power ? 300 : 600, t0);
    f.frequency.exponentialRampToValueAtTime(power ? 1600 : 2400, t0 + dur * 0.8);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(power ? 0.35 : 0.22, t0 + dur * 0.7);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f).connect(g);
    out(g, 0.08);
    src.start(t0, Math.random());
    src.stop(t0 + dur + 0.02);
  },
  /** Пропущенный джеб. */
  hurt(): void {
    impact(0.6, 0.9, 0.12);
    vibrate([60, 30, 60]);
  },
  /** Пропущенный мощный: тяжёлый удар, звон в ушах, звук «глохнет» и возвращается. */
  heavyHurt(): void {
    if (!ctx || !bus) return;
    impact(1, 0.8, 0.1);
    tone(48, 30, 0.6, 0.9, 'sine');
    thud(160, 0.5, 0.9, 'lowpass');
    const t0 = ctx.currentTime + 0.01;
    const m = bus.muffle.frequency;
    m.cancelScheduledValues(t0);
    m.setValueAtTime(m.value, t0);
    m.exponentialRampToValueAtTime(380, t0 + 0.04);
    m.setValueAtTime(380, t0 + 0.5);
    m.exponentialRampToValueAtTime(20000, t0 + 1.8);
    // Звон: чистый высокий тон, медленно гаснет (мимо фильтра — он «в голове»).
    const osc = ctx.createOscillator();
    osc.frequency.value = 3900;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(0.07, t0 + 0.08);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 2.2);
    osc.connect(g).connect(ctx.destination);
    osc.start(t0);
    osc.stop(t0 + 2.3);
    // Сердце — два удара.
    tone(55, 40, 0.16, 0.5, 'sine', 0.55, 0);
    tone(55, 40, 0.16, 0.4, 'sine', 0.8, 0);
    vibrate([120, 40, 200]);
  },
  /** Ты в блоке — удар в твои перчатки. */
  guard(power = false): void {
    thud(power ? 700 : 1100, power ? 0.12 : 0.08, power ? 0.7 : 0.45, 'lowpass', 0, 0.12);
    tone(power ? 140 : 200, 100, 0.1, power ? 0.35 : 0.15, 'sine');
    vibrate(20);
  },
  /** Уклон — кулак свистит мимо уха. */
  dodge(): void {
    thud(1800, 0.22, 0.16, 'bandpass', 0, 0.05, 2);
    tone(900, 1700, 0.18, 0.04, 'sine');
  },
  /** Гонг: звон колокола (неровные обертоны, долгий хвост). */
  bell(times = 1): void {
    for (let i = 0; i < times; i++) {
      const at = i * 0.28;
      tone(1180, null, 1.6, 0.16, 'sine', at, 0.4);
      tone(1180 * 2.76, null, 0.9, 0.06, 'sine', at, 0.3);
      tone(1180 * 5.4, null, 0.4, 0.03, 'sine', at, 0.2);
      tone(590, null, 1.9, 0.07, 'triangle', at, 0.4);
      thud(4000, 0.03, 0.25, 'highpass', at);
    }
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

/** Выдох / стон бота: голос через фильтр «у». */
function grunt(f0: number, dur: number): void {
  if (!ctx) return;
  choir({ vowel: [330, 800], voices: 1, f0: [f0, f0], dur, gain: 0.25, rise: 0.85, wet: 0.1 });
}

// ——— Толпа ———

interface Choir {
  /** Форманты гласной, Гц. */
  vowel: [number, number];
  voices: number;
  /** Высота голосов: от и до, Гц. */
  f0: [number, number];
  dur: number;
  gain: number;
  /** Высота к концу (×). */
  rise: number;
  wet?: number;
  attack?: number;
  at?: number;
}

/** Хор голосов на одну гласную: каждый голос — пила со своей высотой, вибрато и задержкой. */
function choir(c: Choir): void {
  if (!ctx) return;
  const t0 = ctx.currentTime + 0.01 + (c.at ?? 0);
  const sum = ctx.createGain();
  sum.gain.value = 1 / Math.sqrt(c.voices);
  // Форманты: две полосы параллельно + немного «дыхания» (шум).
  const env = ctx.createGain();
  for (const [f, q, k] of [
    [c.vowel[0], 5, 1],
    [c.vowel[1], 6, 0.6],
  ] as const) {
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = f;
    bp.Q.value = q;
    const g = ctx.createGain();
    g.gain.value = k * 3;
    sum.connect(bp).connect(g).connect(env);
  }
  const atk = c.attack ?? 0.12;
  env.gain.setValueAtTime(0.0001, t0);
  env.gain.exponentialRampToValueAtTime(c.gain, t0 + atk);
  env.gain.setTargetAtTime(c.gain * 0.7, t0 + atk, c.dur * 0.3);
  env.gain.setTargetAtTime(0.0001, t0 + c.dur * 0.6, c.dur * 0.18);
  out(env, c.wet ?? 0.55);
  for (let i = 0; i < c.voices; i++) {
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    const f = c.f0[0] + Math.random() * (c.f0[1] - c.f0[0]);
    const d = Math.random() * 0.08;
    osc.frequency.setValueAtTime(f, t0 + d);
    osc.frequency.linearRampToValueAtTime(f * (1 + (c.rise - 1) * 0.6), t0 + d + c.dur * 0.35);
    osc.frequency.linearRampToValueAtTime(f * c.rise, t0 + d + c.dur);
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 4 + Math.random() * 3;
    const lg = ctx.createGain();
    lg.gain.value = f * 0.015;
    lfo.connect(lg).connect(osc.frequency);
    osc.connect(sum);
    osc.start(t0 + d);
    lfo.start(t0 + d);
    osc.stop(t0 + c.dur * 1.6 + 0.1);
    lfo.stop(t0 + c.dur * 1.6 + 0.1);
  }
  // Дыхание толпы — шум в тех же формантах.
  const n = ctx.createBufferSource();
  n.buffer = noiseBuffer(ctx);
  const nf = ctx.createBiquadFilter();
  nf.type = 'bandpass';
  nf.frequency.value = (c.vowel[0] + c.vowel[1]) / 2;
  nf.Q.value = 0.8;
  const ng = ctx.createGain();
  ng.gain.value = 0.25;
  n.connect(nf).connect(ng).connect(env);
  n.start(t0, Math.random());
  n.stop(t0 + c.dur * 1.6 + 0.1);
}

/** Свист из толпы: синус с вибрато и изгибом высоты. */
function whistle(at: number): void {
  if (!ctx) return;
  const t0 = ctx.currentTime + 0.01 + at;
  const f = 2200 + Math.random() * 1200;
  const osc = ctx.createOscillator();
  osc.frequency.setValueAtTime(f * 0.85, t0);
  osc.frequency.linearRampToValueAtTime(f * 1.08, t0 + 0.12);
  osc.frequency.setValueAtTime(f * 1.08, t0 + 0.3);
  osc.frequency.linearRampToValueAtTime(f * 0.8, t0 + 0.55);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(0.03, t0 + 0.05);
  g.gain.setValueAtTime(0.03, t0 + 0.45);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.6);
  osc.connect(g);
  out(g, 0.6);
  osc.start(t0);
  osc.stop(t0 + 0.65);
}

/** Буфер аплодисментов: сотни хлопков (щелчок шума, у каждого своя «ладонь» — тембр и громкость). */
function clapBuffer(ac: AudioContext): AudioBuffer {
  if (claps) return claps;
  const sec = 3;
  const sr = ac.sampleRate;
  const buf = ac.createBuffer(2, sr * sec, sr);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    const n = 900;
    for (let k = 0; k < n; k++) {
      const start = Math.floor(Math.random() * (d.length - sr * 0.05));
      const len = Math.floor(sr * (0.012 + Math.random() * 0.03));
      const amp = 0.08 + Math.random() * 0.25;
      // Тембр хлопка: одна полюсная фильтрация шума — от глухого к звонкому.
      const a = 0.2 + Math.random() * 0.6;
      let y = 0;
      let prev = 0;
      for (let i = 0; i < len; i++) {
        const x = Math.random() * 2 - 1;
        y = a * y + (1 - a) * x;
        const hp = y - prev;
        prev = y;
        d[start + i]! += hp * amp * Math.exp(-i / (len * 0.25)) * 2.5;
      }
    }
  }
  claps = buf;
  return buf;
}

export const crowdSfx = {
  /** Запустить гул трибун (раз за бой; повторный вызов — ничего). */
  start(): void {
    if (!ctx || !bus || bed) return;
    const gain = ctx.createGain();
    gain.gain.value = 0.0001;
    gain.gain.setTargetAtTime(0.5, ctx.currentTime, 1.2);
    out(gain, 0.7);
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer(ctx);
    src.loop = true;
    // Полосы речи: у каждой своя громкость, плавает — «много людей говорят».
    const bands = [260, 420, 650, 900, 1300, 1900, 2600].map((f) => {
      const flt = ctx!.createBiquadFilter();
      flt.type = 'bandpass';
      flt.frequency.value = f;
      flt.Q.value = 1.6;
      const g = ctx!.createGain();
      g.gain.value = 0.06;
      src.connect(flt).connect(g).connect(gain);
      return { g, f: flt };
    });
    src.start();
    bed = { gain, bands };
  },
  stop(): void {
    if (!ctx || !bed) return;
    bed.gain.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.6);
    const b = bed;
    setTimeout(() => b.gain.disconnect(), 3000);
    bed = null;
  },
  /** Каждый кадр: гул дышит, громкость — от накала. */
  update(now: number): void {
    if (!ctx || !bed) return;
    heat += (0.25 - heat) * (1 - Math.exp(-(now - heatAt) / 4000));
    heatAt = now;
    if (now - lastBabble < 110) return;
    lastBabble = now;
    const t = ctx.currentTime;
    for (const b of bed.bands) {
      const v = (0.03 + Math.random() * 0.07) * (0.6 + heat * 1.6);
      b.g.gain.setTargetAtTime(v, t, 0.08);
      b.f.frequency.setTargetAtTime(b.f.frequency.value * (0.97 + Math.random() * 0.06), t, 0.2);
    }
    bed.gain.gain.setTargetAtTime(0.35 + heat * 0.6, t, 0.4);
  },
  /** «Оох» — попадание. level 0…1. */
  ooh(level = 0.5): void {
    bump(level * 0.6);
    choir({
      vowel: [420, 820],
      voices: 14 + Math.round(level * 14),
      f0: [110, 260],
      dur: 0.9 + level * 0.5,
      gain: 0.07 + level * 0.1,
      rise: 1.18,
    });
  },
  /** «Ааа!» с рёвом и свистом — мощный удар, сорванный замах, нокдаун. */
  roar(level = 1): void {
    bump(level);
    choir({
      vowel: [780, 1250],
      voices: 26,
      f0: [140, 340],
      dur: 1.6 + level,
      gain: 0.12 + level * 0.1,
      rise: 1.1,
      attack: 0.08,
    });
    thud(1600, 1.2 + level, 0.12 * level, 'bandpass', 0.05, 0.8, 0.5);
    for (let i = 0; i < Math.round(1 + level * 3); i++) whistle(0.2 + Math.random() * 1.2);
  },
  /** Вздох «ах!» — тебя хорошо достали. */
  gasp(level = 0.6): void {
    bump(level * 0.5);
    choir({
      vowel: [700, 1150],
      voices: 18,
      f0: [160, 320],
      dur: 0.45,
      gain: 0.08 + level * 0.06,
      rise: 0.82,
      attack: 0.04,
    });
  },
  /** «Буу» — бой стоит. */
  boo(): void {
    choir({ vowel: [330, 760], voices: 22, f0: [95, 180], dur: 2.2, gain: 0.08, rise: 0.95, attack: 0.3 });
  },
  /** Аплодисменты, сек. */
  applause(sec = 3, level = 1): void {
    if (!ctx) return;
    const t0 = ctx.currentTime + 0.05;
    const src = ctx.createBufferSource();
    src.buffer = clapBuffer(ctx);
    src.loop = true;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(0.5 * level, t0 + 0.4);
    g.gain.setTargetAtTime(0.0001, t0 + sec * 0.7, sec * 0.15);
    src.connect(g);
    out(g, 0.5);
    src.start(t0, Math.random() * 2);
    src.stop(t0 + sec + 1);
  },
};

function bump(level: number): void {
  heat = Math.min(1, Math.max(heat, 0.25 + level * 0.75));
}
