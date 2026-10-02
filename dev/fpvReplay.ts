// Бой от первого лица по записи (dev/fpv-replay.html): тот же конвейер, что на fight.html, но кадры —
// из записи позы, без камеры. window.renderFrame(i) рисует кадр i (кадры идут по порядку).
// ?fixture=/путь/к/записи.json&video=/путь/к/видео.mp4

import { createExercise } from '../src/engine/exercises';
import { LandmarkSmoother, RenderSmoother, smoothPose } from '../src/engine/filter';
import { torsoLength } from '../src/engine/geometry';
import { decodeDetection, type FixtureFile } from '../src/engine/recorder';
import { ExerciseSession } from '../src/engine/session';
import type { Landmark } from '../src/engine/types';
import { FpvView, PUNCH_CONTACT_MS, type FpvPunch } from '../src/fight/fpv';
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
const fpv = new FpvView(document.getElementById('fpv') as HTMLCanvasElement, false);
const pip = (document.getElementById('pip') as HTMLCanvasElement).getContext('2d')!;
const hud = (document.getElementById('hud') as HTMLCanvasElement).getContext('2d')!;

const smoother = new LandmarkSmoother();
const render = new RenderSmoother();
const session = new ExerciseSession(createExercise('boxing')!, 1000, 0);
const gloves = new GloveTracker();
const stance = new StanceTracker();
let reps = 0;
let hits = 0;
const punchDet = new PunchDetector();
const punches: Partial<Record<GloveSide, FpvPunch>> = {};
let lastHitAt = -Infinity;
let next = 0;
let lms: Landmark[] = [];
let shift = { x: 0, y: 0 };

function step(i: number): void {
  const f = file.frames[i]!;
  const d = decodeDetection(f);
  const frame = d ? smoothPose(smoother, d.image, d.world, f.t, file.aspect) : null;
  const scale = d ? torsoLength({ t: f.t, aspect: file.aspect, image: d.image, world: null }) || 0.25 : 0;
  lms = d && frame ? render.apply(d.image, frame.image, f.t, file.aspect, scale) : [];
  const st = stance.update(lms, f.t, file.aspect);
  shift = { x: st.shiftX, y: st.shiftY };
  gloves.update(lms, f.t, file.aspect);
  for (const p of punchDet.update(lms, f.t, file.aspect)) {
    punches[p.side] = { start: p.t, low: p.low, hook: p.hook };
    hits += 1;
    lastHitAt = p.t + PUNCH_CONTACT_MS;
  }
  for (const e of session.update(frame, f.t))
    if (e.type === 'rep') {
      reps += 1;
    }
}

const w = window as unknown as { renderFrame: (i: number) => Promise<number>; ready: boolean };
w.renderFrame = async (i) => {
  while (next <= i && next < file.frames.length) step(next++);
  const t = file.frames[Math.min(i, file.frames.length - 1)]!.t;
  const g = gloves.read(t);
  const sinceHit = t - lastHitAt;
  const recoil = sinceHit >= 0 && sinceHit < 260 ? (1 - sinceHit / 260) ** 2 : 0;
  const state = {
    botT: 25 * (1 + Math.sin(t / 380)),
    botLunge: 0,
    botRecoil: recoil,
    botKo: 0,
    gloves: g,
    shiftX: shift.x,
    shiftY: shift.y,
    shake: 0,
    punches,
    now: t,
  };
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
    if (lms.length) drawSkeleton(pip, v, lms, { color: '#22c55e', glow: null });
  }
  hud.clearRect(0, 0, 1280, 720);
  hud.fillStyle = 'rgba(0,0,0,0.6)';
  hud.fillRect(1040, 16, 224, 92);
  hud.fillStyle = '#fff';
  hud.font = '600 20px system-ui';
  hud.fillText(`удары: ${hits} (движок ${reps})`, 1056, 46);
  hud.font = '14px system-ui';
  hud.fillText(`${(t / 1000).toFixed(1)} с`, 1056, 70);
  (['left', 'right'] as const).forEach((side, k) => {
    hud.fillStyle = '#333';
    hud.fillRect(1056 + k * 100, 82, 90, 12);
    hud.fillStyle = '#ef4444';
    hud.fillRect(1056 + k * 100, 82, 90 * g[side].ext, 12);
  });
  if (sinceHit >= 0 && sinceHit < 400) {
    hud.fillStyle = '#f97316';
    hud.font = '900 64px system-ui';
    hud.fillText('УДАР', 560, 120);
  }
  return file.frames.length;
};
w.ready = true;
