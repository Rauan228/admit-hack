// U-04 + U-18: лендинг. Единственный клик в приложении — «Начать»: браузеру нужен жест,
// чтобы дать камеру и звук. Дальше всё управляется телом.

import { Ghost } from '../components/Ghost';
import { Icon, type IconName } from '../components/Icon';
import { Logo } from '../components/TopBar';
import './Landing.css';

const STEPS: { icon: IconName; title: string; text: string }[] = [
  { icon: 'camera', title: 'Встань перед камерой', text: 'В 2–3 метрах, чтобы было видно целиком' },
  { icon: 'hand', title: 'Подними руку', text: 'Появится курсор. Задержи его на кнопке — это выбор' },
  {
    icon: 'check',
    title: 'Тренируйся',
    text: 'Тренер считает повторы и подсказывает, как исправить технику',
  },
];

export function Landing({ onStart, onDemo }: { onStart: () => void; onDemo: () => void }) {
  return (
    <main className="screen landing">
      <div className="landing__bg" aria-hidden="true">
        <span className="landing__blob landing__blob--a" />
        <span className="landing__blob landing__blob--b" />
        <span className="landing__grid" />
      </div>

      <header className="landing__top">
        <Logo />
        <span className="badge">ADMIT Hackathon · Motion</span>
      </header>

      <section className="landing__hero">
        <div className="landing__copy">
          <span className="badge badge--primary">
            <Icon name="zap" size={16} /> AI-тренер через веб-камеру
          </span>
          <h1 className="landing__title">
            Тренер,
            <br />
            которому <span className="primary">не нужны руки</span>
          </h1>
          <p className="landing__lead">
            Считает приседания, выпады и «звёздочку», видит ошибки техники и говорит голосом, как их
            исправить. Меню — тоже жестами.
          </p>
          <div className="landing__cta">
            <button type="button" className="btn btn--primary btn--lg" onClick={onStart}>
              <Icon name="play" size={30} /> Начать
            </button>
            <button type="button" className="btn btn--ghost" onClick={onDemo}>
              Демо без камеры
            </button>
          </div>
          <p className="landing__privacy muted">
            Видео не покидает устройство: распознавание работает прямо в браузере.
          </p>
        </div>

        <div className="landing__figure" aria-hidden="true">
          <div className="landing__ring" />
          <Ghost exercise="squat" className="landing__ghost" />
        </div>
      </section>

      <ol className="landing__steps">
        {STEPS.map((s, i) => (
          <li key={s.title} className="landing__step">
            <span className="landing__num">{i + 1}</span>
            <Icon name={s.icon} size={30} className="primary" />
            <div>
              <h3>{s.title}</h3>
              <p className="muted">{s.text}</p>
            </div>
          </li>
        ))}
      </ol>
    </main>
  );
}
