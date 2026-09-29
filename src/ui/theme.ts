// Цвета для canvas: те же значения, что в styles/tokens.css (canvas не читает CSS-переменные на каждом кадре).
export const COLORS = {
  bg: '#0b1120',
  bgDeep: '#070b16',
  fg: '#f8fafc',
  muted: '#a5b1c4',
  primary: '#f97316',
  primary2: '#fb923c',
  good: '#22c55e',
  warn: '#facc15',
  bad: '#ef4444',
  info: '#38bdf8',
} as const;

/** Цвет оценки повторения 0..100. */
export function scoreColor(score: number): string {
  if (score >= 85) return COLORS.good;
  if (score >= 60) return COLORS.warn;
  return COLORS.bad;
}
