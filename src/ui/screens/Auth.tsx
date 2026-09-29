// Вход и регистрация (почта + пароль). Появляется, когда гость хочет сохранить результат или открыть свой прогресс.
// Почту и пароль вводят с клавиатуры или телефона; «Назад» — и рукой (удержание), и жестом «обе руки вверх».

import { useState, type FormEvent } from 'react';
import { DwellButton } from '../components/dwell';
import { Icon } from '../components/Icon';
import { order } from '../lib/motion';
import { ApiError, login, register, type ApiUser } from '../store/api';
import './Auth.css';

type Mode = 'login' | 'register';

export function Auth({
  reason,
  pending,
  onDone,
  onBack,
}: {
  /** Зачем просим войти — заголовок экрана. */
  reason: 'save' | 'progress' | 'account';
  /** Что сохранится после входа: «Челлендж 60 с · 12 чистых». */
  pending?: string;
  onDone: (u: ApiUser) => void;
  onBack: () => void;
}) {
  const [mode, setMode] = useState<Mode>(reason === 'save' ? 'register' : 'login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [nick, setNick] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setError(null);
    setBusy(true);
    try {
      const u = mode === 'login' ? await login(email, password) : await register(email, password, nick);
      onDone(u);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Что-то пошло не так — попробуй ещё раз');
    } finally {
      setBusy(false);
    }
  };

  const title =
    reason === 'save' ? 'Сохрани результат' : reason === 'progress' ? 'Твой прогресс' : 'Аккаунт FORMA';

  return (
    <main className="screen auth">
      <section className="auth__pitch">
        <span className="eyebrow rise" style={order(0)}>
          {mode === 'login' ? 'Вход' : 'Регистрация'} · 30 секунд
        </span>
        <h1 className="auth__title rise" style={order(1)}>
          {title}
        </h1>
        {pending && (
          <p className="auth__pending rise" style={order(2)}>
            <Icon name="trophy" size={22} /> {pending}
            <small>сохранится сразу после входа</small>
          </p>
        )}
        <ul className="auth__perks">
          <li className="rise" style={order(3)}>
            <Icon name="trophy" size={24} className="primary" />
            <span>
              <b>Общий рейтинг</b> — сравни себя с другими в каждом режиме: сегодня, за неделю, за всё время
            </span>
          </li>
          <li className="rise" style={order(4)}>
            <Icon name="zap" size={24} className="primary" />
            <span>
              <b>Личные рекорды</b> — видно, как растёшь: «вчера 10, сегодня 12»
            </span>
          </li>
          <li className="rise" style={order(5)}>
            <Icon name="check" size={24} className="primary" />
            <span>
              <b>Только чистая техника</b> — в рейтинг идут повторения без ошибок
            </span>
          </li>
        </ul>
      </section>

      <form className="card auth__card rise" style={order(2)} onSubmit={submit} noValidate>
        <div className="auth__tabs" role="tablist">
          {(['register', 'login'] as const).map((m) => (
            <button
              key={m}
              type="button"
              role="tab"
              aria-selected={mode === m}
              className={`auth__tab ${mode === m ? 'is-on' : ''}`}
              onClick={() => {
                setMode(m);
                setError(null);
              }}
            >
              {m === 'register' ? 'Регистрация' : 'Вход'}
            </button>
          ))}
        </div>

        <label className="field">
          <span>Почта</span>
          <input
            type="email"
            autoComplete="email"
            inputMode="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@mail.com"
            required
          />
        </label>
        {mode === 'register' && (
          <label className="field">
            <span>Ник в рейтинге</span>
            <input
              type="text"
              autoComplete="nickname"
              value={nick}
              maxLength={20}
              onChange={(e) => setNick(e.target.value)}
              placeholder="Например, Рауан"
              required
            />
            <small className="muted">3–20 символов, его увидят другие</small>
          </label>
        )}
        <label className="field">
          <span>Пароль</span>
          <input
            type="password"
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={mode === 'register' ? 'Минимум 8 символов' : ''}
            required
          />
        </label>

        {error && (
          <p className="auth__error" role="alert">
            <Icon name="alert" size={20} /> {error}
          </p>
        )}

        <button type="submit" className="btn btn--primary auth__submit" disabled={busy}>
          {busy ? 'Секунду…' : mode === 'login' ? 'Войти' : 'Создать аккаунт'}
          {!busy && <Icon name="play" size={22} />}
        </button>
        <p className="auth__switch muted">
          {mode === 'login' ? 'Ещё нет аккаунта? ' : 'Уже есть аккаунт? '}
          <button
            type="button"
            className="auth__link"
            onClick={() => setMode(mode === 'login' ? 'register' : 'login')}
          >
            {mode === 'login' ? 'Зарегистрироваться' : 'Войти'}
          </button>
        </p>
      </form>

      <footer className="auth__foot">
        <DwellButton size="sm" variant="ghost" onSelect={onBack}>
          <Icon name="back" size={22} /> {reason === 'save' ? 'Не сохранять' : 'Назад'}
        </DwellButton>
      </footer>
    </main>
  );
}
