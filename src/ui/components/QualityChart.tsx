// Оценка каждого повторения столбиками. Цвет дублируется подписью «чисто / с ошибкой» —
// смысл не передаётся одним цветом. Стили — в screens/Summary.css.

/** Порог «чистого» повторения. */
const CLEAN = 85;

export function QualityChart({ scores }: { scores: number[] }) {
  const clean = scores.filter((s) => s >= CLEAN).length;
  // Подписи номеров — у каждого, если столбиков немного, иначе у каждого второго или пятого.
  const step = scores.length <= 16 ? 1 : scores.length <= 32 ? 2 : 5;
  return (
    <figure className="qchart" aria-label={`Оценки повторений: ${scores.join(', ')}`}>
      <figcaption className="qchart__head">
        <h2 className="qchart__title">Каждое повторение</h2>
        <span className="qchart__legend">
          <span>
            <i className="qchart__dot qchart__dot--good" /> Чисто · {clean}
          </span>
          <span>
            <i className="qchart__dot qchart__dot--bad" /> С ошибкой · {scores.length - clean}
          </span>
        </span>
      </figcaption>
      {scores.length === 0 ? (
        <p className="qchart__empty">Повторений не было</p>
      ) : (
        <div className="qchart__body">
          <div className="qchart__plot">
            <span className="qchart__goal" style={{ bottom: `${CLEAN}%` }} aria-hidden="true">
              <small>{CLEAN}</small>
            </span>
            {scores.map((s, i) => (
              <span key={i} className="qchart__col">
                <span
                  className={`qchart__bar ${s >= CLEAN ? 'qchart__bar--good' : 'qchart__bar--bad'}`}
                  style={{ height: `${Math.max(4, s)}%`, animationDelay: `${500 + i * 50}ms` }}
                  title={`Повторение ${i + 1}: ${s}`}
                />
                <span className="qchart__n">{(i + 1) % step === 0 ? i + 1 : ''}</span>
              </span>
            ))}
          </div>
        </div>
      )}
    </figure>
  );
}
