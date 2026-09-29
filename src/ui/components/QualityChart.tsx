// Оценка каждого повторения столбиками. Цвет дублируется подписью «чисто / с ошибкой» —
// смысл не передаётся одним цветом.

import { scoreColor } from '../theme';

export function QualityChart({ scores }: { scores: number[] }) {
  if (scores.length === 0) return <p className="muted">Повторений не было</p>;
  const w = 100 / scores.length;
  const clean = scores.filter((s) => s >= 85).length;
  return (
    <figure className="qchart" aria-label={`Оценки повторений: ${scores.join(', ')}`}>
      <svg viewBox="0 0 100 40" preserveAspectRatio="none" className="qchart__svg">
        <line x1="0" x2="100" y1={40 - 40 * 0.85} y2={40 - 40 * 0.85} className="qchart__goal" />
        {scores.map((s, i) => {
          const h = Math.max(2, (s / 100) * 40);
          return (
            <rect
              key={i}
              x={i * w + w * 0.14}
              width={w * 0.72}
              y={40 - h}
              height={h}
              rx={Math.min(1.6, w * 0.2)}
              fill={scoreColor(s)}
            />
          );
        })}
      </svg>
      <figcaption className="qchart__caption">
        <span>
          <i className="dot dot--good" /> чисто (85+): {clean}
        </span>
        <span>
          <i className="dot dot--warn" /> с ошибкой: {scores.length - clean}
        </span>
      </figcaption>
    </figure>
  );
}
