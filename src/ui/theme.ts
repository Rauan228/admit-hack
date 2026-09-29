// Цвета для canvas: те же значения, что в styles/tokens.css (canvas не читает CSS-переменные на каждом кадре).
export const COLORS = {
  bg: '#09090b',
  bgDeep: '#050506',
  fg: '#f4f4f5',
  muted: '#a1a1aa',
  primary: '#f97316',
  primary2: '#fb923c',
  good: '#22c55e',
  warn: '#facc15',
  bad: '#ef4444',
  info: '#8fb3d9',
} as const;

/** Цвет оценки повторения 0..100. */
export function scoreColor(score: number): string {
  if (score >= 85) return COLORS.good;
  if (score >= 60) return COLORS.warn;
  return COLORS.bad;
}
