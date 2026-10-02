// Бой от первого лица по записи (dev/fpv-replay.html): тот же конвейер, что на fight.html, но кадры —
// из записи позы, без камеры. Идёт настоящий бой с ботом (FightMatch, ?bot=, зерно ?seed=): его стойка,
// блоки, замахи и удары, твои удары детектора, уклоны и блок по стойке, реакции трибун, «потемнело в
// глазах» от мощного. window.renderFrame(i) рисует кадр i (кадры идут по порядку).
// ?fixture=/путь/к/записи.json&video=/путь/к/видео.mp4

import { LandmarkSmoother, RenderSmoother, smoothPose } from '../src/engine/filter';
import { torsoLength } from '../src/engine/geometry';
import { decodeDetection, type FixtureFile } from '../src/engine/recorder';
import type { Landmark } from '../src/engine/types';
import { FightMatch, findFightBot, type BotView, type PunchResult } from '../src/fight/fight';
import { DAZE_MS, FpvView, PUNCH_CONTACT_MS, type FpvPunch, type FpvState } from '../src/fight/fpv';
import { GloveTracker, type GloveSide } from '../src/fight/gloves';
import { PunchDetector } from '../src/fight/punch';
import { StanceTracker } from '../src/fight/stance';
import { coverView, drawSkeleton } from '../src/ui/lib/skeleton';

const q = new URLSearchParams(location.search);
const file = (await (await fetch(q.get('fixture')!)).json()) as FixtureFile;
const video = document.getElementById('video') as HTMLVideoElement;
if (q.get('video')) {
  video.src = q.get('video')!;
  await new Promise((r) => video.addEventListener('loadeddata', r, { once: true }));
}
const fpvCanvas = document.getElementById('fpv') as HTMLCanvasElement;
const fpv = new FpvView(fpvCanvas, false);
const pip = (document.getElementById('pip') as HTMLCanvasElement).getContext('2d')!;
const hud = (document.getElementById('hud') as HTMLCanvasElement).getContext('2d')!;

const smoother = new LandmarkSmoother();
const render = new RenderSmoother();
const gloves = new GloveTracker();
const stance = new StanceTracker();
const punchDet = new PunchDetector();
const punches: Partial<Record<GloveSide, FpvPunch>> = {};
const t0 = file.frames[0]!.t;
const match = new FightMatch(
  {
    bot: findFightBot(q.get('bot') ?? 'athlete'),
    seed: Number(q.get('seed') ?? 5),
    rules: { prepMs: 0, introMs: 0 },
  },
  t0,
);
/** Удары, ждущие касания: время касания, рука, в корпус ли. */
const contacts: { at: number; side: GloveSide; low: boolean }[] = [];
let botView: BotView = { state: 'guard', since: t0, until: Infinity, attack: null };
let botHurt: FpvState['botHurt'] = null;
let botBlockedAt = -Infinity;
let knock: FpvState['knock'] = null;
let words: { text: string; at: number; color: string }[] = [];
let next = 0;
let lms: Landmark[] = [];
let shift = { x: 0, y: 0 };
let guardUp = false;

const WORD: Partial<Record<PunchResult['kind'], string>> = {
  open: 'ОТКРЫЛСЯ!',
  counter: 'КОНТРАТАКА!',
  interrupt: 'ПОЙМАЛ НА ЗАМАХЕ!',
  body: 'В КОРПУС!',
  blocked: 'БЛОК',
};

function events(t: number): void {
  for (const e of match.tick(t)) {
    if (e.type === 'bot_state') botView = { state: e.state, since: e.at, until: e.until, attack: e.attack };
    if (e.type === 'bot_hit') {
      if (e.result === 'landed') {
        knock = { at: t, side: e.side, power: e.kind === 'power' };
        words.push({ text: `-${e.damage}`, at: t, color: '#ef4444' });
        fpv.crowd(e.kind === 'power' ? 0.9 : 0.45);
        if (e.kind === 'power') fpv.photoBurst(1200);
      } else words.push({ text: e.result === 'dodged' ? 'УКЛОН!' : 'ТВОЙ БЛОК', at: t, color: '#22c55e' });
    }
  }
}

function step(i: number): void {
  const f = file.frames[i]!;
  const d = decodeDetection(f);
  const frame = d ? smoothPose(smoother, d.image, d.world, f.t, file.aspect) : null;
  const scale = d ? torsoLength({ t: f.t, aspect: file.aspect, image: d.image, world: null }) || 0.25 : 0;
  lms = d && frame ? render.apply(d.image, frame.image, f.t, file.aspect, scale) : [];
  const st = stance.update(lms, f.t, file.aspect);
  shift = { x: st.shiftX, y: st.shiftY };
  guardUp = st.guard;
  match.setGuard(f.t, st.guard);
  if (st.dodge) match.dodge(f.t);
  gloves.update(lms, f.t, file.aspect);
  for (const p of punchDet.update(lms, f.t, file.aspect)) {
    punches[p.side] = { start: p.t, low: p.low, hook: p.hook };
    contacts.push({ at: p.t + PUNCH_CONTACT_MS, side: p.side, low: p.low });
  }
}

/** Довести бой до t: касания твоих ударов — по порядку вместе с событиями бота. */
function advance(t: number): void {
  contacts.sort((a, b) => a.at - b.at);
  while (contacts.length && contacts[0]!.at <= t) {
    const c = contacts.shift()!;
    events(c.at);
    const r = match.punch(c.at, true, c.low);
    if (!r) continue;
    if (r.blocked) botBlockedAt = c.at;
    else {
      botHurt = { at: c.at, side: c.side, low: c.low };
      fpv.crowd(r.kind === 'interrupt' ? 1 : r.kind === 'counter' ? 0.75 : 0.5);
      if (r.kind === 'interrupt' || r.ko) fpv.photoBurst(1500);
      words.push({ text: `-${r.damage}`, at: c.at, color: '#fde68a' });
    }
    const w = WORD[r.kind];
    if (w) words.push({ text: w, at: c.at, color: r.blocked ? '#a1a1aa' : '#f97316' });
  }
  events(t);
}

const w = window as unknown as { renderFrame: (i: number) => Promise<number>; ready: boolean };
w.renderFrame = async (i) => {
  while (next <= i && next < file.frames.length) step(next++);
  const t = file.frames[Math.min(i, file.frames.length - 1)]!.t;
  advance(t);
  const s = match.snapshot(t);
  fpv.screen({ round: 'РАУНД 1', clock: '', me: s.hpMe, bot: s.hpBot, botName: 'Атлет' });
  const state: FpvState = {
    now: t,
    bot: botView,
    botHurt,
    botBlockedAt,
    botKo: 0,
    gloves: gloves.read(t),
    shiftX: shift.x,
    shiftY: shift.y,
    shake: t - botBlockedAt < 150 ? 0.5 : 0,
    knock,
    punches,
  };
  // «Потемнело в глазах» — как на странице (fight.css, .is-dazed): вспышка и размытие.
  const dz = knock?.power ? (t - knock.at) / DAZE_MS : 1;
  fpvCanvas.style.filter =
    dz >= 0 && dz < 1
      ? `blur(${(7 * (1 - dz) ** 2).toFixed(2)}px) brightness(${(1 + 1.4 * (1 - dz) ** 3).toFixed(2)}) saturate(${(0.35 + 0.65 * dz).toFixed(2)})`
      : '';
  // Первый кадр — когда модель бота загрузилась.
  while (!fpv.render(state)) await new Promise((r) => setTimeout(r, 100));
  if (video.src) {
    video.currentTime = t / 1000;
    await new Promise((r) => video.addEventListener('seeked', r, { once: true }));
    const v = coverView(540, 720, video.videoWidth, video.videoHeight, true);
    pip.save();
    pip.translate(540, 0);
    pip.scale(-1, 1);
    pip.drawImage(video, v.ox, v.oy, v.dw, v.dh);
    pip.restore();
    if (lms.length) drawSkeleton(pip, v, lms, { color: guardUp ? '#38bdf8' : '#22c55e', glow: null });
  }
  hud.clearRect(0, 0, 1280, 720);
  // Здоровье.
  const bar = (x: number, v: number, color: string, label: string, right: boolean) => {
    hud.fillStyle = 'rgba(0,0,0,0.55)';
    hud.fillRect(x - 6, 14, 432, 44);
    hud.fillStyle = 'rgba(255,255,255,0.15)';
    hud.fillRect(x, 36, 420, 14);
    hud.fillStyle = color;
    const fw = (420 * v) / 100;
    hud.fillRect(right ? x + 420 - fw : x, 36, fw, 14);
    hud.fillStyle = '#fff';
    hud.font = '700 16px system-ui';
    hud.textAlign = right ? 'right' : 'left';
    hud.fillText(label, right ? x + 420 : x, 30);
  };
  bar(24, s.hpMe, '#ef4444', `ТЫ ${s.hpMe}`, false);
  bar(1280 - 24 - 420, s.hpBot, '#3b82f6', `АТЛЕТ ${s.hpBot}`, true);
  hud.textAlign = 'center';
  hud.fillStyle = 'rgba(255,255,255,0.8)';
  hud.font = '600 15px system-ui';
  const kind = botView.attack
    ? ` ${botView.attack.kind === 'power' ? 'мощный' : 'джеб'} ${botView.attack.side === 'left' ? 'левой' : 'правой'}`
    : '';
  hud.fillText(`бот: ${botView.state}${kind} · ${((t - t0) / 1000).toFixed(1)} с`, 640, 84);
  if (botView.state === 'windup') {
    hud.fillStyle = botView.attack?.kind === 'power' ? '#ef4444' : '#f97316';
    hud.font = `900 ${botView.attack?.kind === 'power' ? 76 : 54}px system-ui`;
    hud.fillText('!', 640, 170);
  }
  words = words.filter((x) => t - x.at < 900);
  words.forEach((x, k) => {
    const u = (t - x.at) / 900;
    hud.globalAlpha = 1 - u * u;
    hud.fillStyle = x.color;
    hud.font = '900 40px system-ui';
    hud.fillText(x.text, 640 + ((k % 3) - 1) * 160, 300 - u * 60 - (k % 2) * 46);
    hud.globalAlpha = 1;
  });
  return file.frames.length;
};
w.ready = true;
