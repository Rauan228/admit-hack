// Один WebGL-рендерер на всё приложение. Каждый видимый атлет рисуется в угол общего буфера (scissor)
// и копируется в свой 2D-холст — так на странице может быть сколько угодно атлетов без лимита
// WebGL-контекстов (на телефонах их ~8).

import { ACESFilmicToneMapping, SRGBColorSpace, WebGLRenderer, type Camera, type Scene } from 'three';

let renderer: WebGLRenderer | null = null;
let failed = false;
let bufW = 0;
let bufH = 0;

export function sharedRenderer(mobile: boolean): WebGLRenderer | null {
  if (renderer || failed) return renderer;
  try {
    renderer = new WebGLRenderer({ antialias: !mobile, alpha: true, powerPreference: 'high-performance' });
  } catch {
    failed = true;
    return null;
  }
  renderer.setPixelRatio(1);
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.setClearColor(0x000000, 0);
  renderer.setScissorTest(true);
  return renderer;
}

/** Нарисовать сцену в область W×H общего буфера и скопировать в 2D-холст назначения. */
export function blitTo(
  r: WebGLRenderer,
  scene: Scene,
  camera: Camera,
  target: CanvasRenderingContext2D,
  W: number,
  H: number,
): boolean {
  if (W > bufW || H > bufH) {
    bufW = Math.min(2048, Math.max(bufW, W));
    bufH = Math.min(2048, Math.max(bufH, H));
    r.setSize(bufW, bufH, false);
  }
  r.setViewport(0, 0, W, H);
  r.setScissor(0, 0, W, H);
  r.clear();
  r.render(scene, camera);
  target.clearRect(0, 0, W, H);
  target.drawImage(r.domElement, 0, bufH - H, W, H, 0, 0, W, H);
  return true;
}
