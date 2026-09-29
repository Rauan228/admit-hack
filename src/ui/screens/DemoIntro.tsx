// Демо без камеры: сначала объясняем, что это и зачем, и только по кнопке запускаем тур.

import { Ghost } from '../components/Ghost';
import { Icon } from '../components/Icon';
import { order } from '../lib/motion';
import { DEMO_STEPS } from './demoSteps';
import './DemoIntro.css';

export function DemoIntro({
  onWatch,
  onCamera,
  onBack,
}: {
  onWatch: () => void;
  onCamera: () => void;
  onBack: () => void;
}) {
  return (
    <main className="page demo-intro">
      <div className="page__inner demo-intro__grid">
        <section className="demo-intro__text">
          <button type="button" className="back-link" onClick={onBack}>
            <Icon name="back" size={16} /> Назад
          </button>
          <span className="demo-intro__badge rise" style={order(0)}>
            Демо без камеры
          </span>
          <h1 className="demo-intro__title rise" style={order(1)}>
            Посмотри, как FORMA ведёт тренировку
          </h1>
          <p className="demo-intro__lead muted rise" style={order(2)}>
            Нет камеры под рукой? Виртуальный спортсмен пройдёт короткую тренировку, а мы по шагам покажем,
            что видит FORMA. Около 40 секунд.
          </p>

          <ol className="demo-intro__steps">
            {DEMO_STEPS.map((s, i) => (
              <li key={s.id} className="rise" style={order(3 + i)}>
                <span className="demo-intro__num">{i + 1}</span>
                <div>
                  <b>{s.title}</b>
                  <small className="muted">{s.short}</small>
                </div>
              </li>
            ))}
          </ol>

          <div className="demo-intro__actions rise" style={order(9)}>
            <button type="button" className="btn btn--primary" onClick={onWatch}>
              <Icon name="play" size={18} /> Смотреть демо
            </button>
            <button type="button" className="btn" onClick={onCamera}>
              <Icon name="camera" size={18} /> Лучше с камерой
            </button>
          </div>
          <p className="demo-intro__note muted rise" style={order(10)}>
            В демо управляй мышью или пальцем. Выйти можно в любой момент — кнопка «Выйти из демо» внизу
            экрана. Результаты демо в рейтинг не попадают.
          </p>
        </section>

        <div className="demo-intro__visual rise" style={order(2)} aria-hidden="true">
          <Ghost exercise="squat" className="demo-intro__ghost" sway />
          <span className="demo-intro__tag demo-intro__tag--a">
            <Icon name="check" size={16} /> Повтор засчитан · 96
          </span>
          <span className="demo-intro__tag demo-intro__tag--b">
            <Icon name="alert" size={16} /> Колени внутрь — разведи по носкам
          </span>
        </div>
      </div>
    </main>
  );
}
