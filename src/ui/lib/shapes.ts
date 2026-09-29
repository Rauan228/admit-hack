// Сужающаяся капсула: круг радиуса r1 в A, круг r2 в B и внешние касательные между ними.
// Так рисуются конечности — у плеча толще, к кисти тоньше, как у настоящего тела.

export type Pt = { x: number; y: number };

export function capsulePath(ctx: CanvasRenderingContext2D, A: Pt, B: Pt, r1: number, r2: number): void {
  const dx = B.x - A.x;
  const dy = B.y - A.y;
  const d = Math.hypot(dx, dy);
  ctx.beginPath();
  if (d <= Math.abs(r1 - r2) + 0.5) {
    const big = r1 >= r2 ? A : B;
    ctx.arc(big.x, big.y, Math.max(r1, r2), 0, Math.PI * 2);
    return;
  }
  const th = Math.atan2(dy, dx);
  const phi = Math.acos(Math.max(-1, Math.min(1, (r1 - r2) / d)));
  const STEPS = 10;
  // Задняя сторона круга A: от θ+φ до θ+2π−φ.
  for (let i = 0; i <= STEPS; i += 1) {
    const a = th + phi + ((2 * Math.PI - 2 * phi) * i) / STEPS;
    const x = A.x + r1 * Math.cos(a);
    const y = A.y + r1 * Math.sin(a);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  // Передняя сторона круга B: от θ−φ до θ+φ.
  for (let i = 0; i <= STEPS; i += 1) {
    const a = th - phi + (2 * phi * i) / STEPS;
    ctx.lineTo(B.x + r2 * Math.cos(a), B.y + r2 * Math.sin(a));
  }
  ctx.closePath();
}

export function mixHex(a: string, b: string, t: number): string {
  const pa = parseInt(a.slice(1), 16);
  const pb = parseInt(b.slice(1), 16);
  const ch = (s: number) => Math.round(((pa >> s) & 255) + (((pb >> s) & 255) - ((pa >> s) & 255)) * t);
  return `rgb(${ch(16)}, ${ch(8)}, ${ch(0)})`;
}
