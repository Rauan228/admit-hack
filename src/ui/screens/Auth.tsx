// Вход и регистрация (почта + пароль). Появляется, когда гость хочет сохранить результат или открыть свой прогресс.
// Почту и пароль вводят с клавиатуры или телефона; «Назад» — и рукой (удержание), и жестом «обе руки вверх».

import { useState, type FormEvent } from 'react';
import { DwellButton } from '../components/dwell';
import { Icon, type IconName } from '../components/Icon';
import { order } from '../lib/motion';
import { ApiError, login, register, type ApiUser } from '../store/api';
import './Auth.css';

type Mode = 'login' | 'register';
type Field = 'email' | 'password' | 'nick' | 'form';

/** К какому полю относится ошибка сервера — показываем её прямо под ним. */
function fieldOf(msg: string): Field {
  const m = msg.toLowerCase();
  const mail = m.includes('почт') || m.includes('email');
  const pass = m.includes('парол');
  // «Неверная почта или пароль» — про всю форму.
  if (mail && pass) return 'form';
  if (mail) return 'email';
  if (pass) return 'password';
  if (/(^|\s)ник/.test(m)) return 'nick';
  return 'form';
}

const PERKS: { icon: IconName; title: string; text: string }[] = [
  {
    icon: 'trophy',
    title: 'Общий рейтинг',
    text: 'Сравни себя с другими в каждом режиме: сегодня, за неделю, за всё время',
  },
  { icon: 'chart', title: 'Личные рекорды', text: 'Видно, как растёшь: «вчера 10, сегодня 12»' },
  { icon: 'check', title: 'Только чистая техника', text: 'В рейтинг идут повторения без ошибок' },
];

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

  const switchTo = (m: Mode) => {
    setMode(m);
    setError(null);
  };

  const title =
    reason === 'save' ? 'Сохрани результат' : reason === 'progress' ? 'Твой прогресс' : 'Аккаунт FORMA';
  let errField: Field | null = error ? fieldOf(error) : null;
  if (errField === 'nick' && mode !== 'register') errField = 'form';

  const errorAt = (f: Field) =>
    error && errField === f ? (
      <span className="auth-field__error" role="alert">
        <Icon name="alert" size={14} /> {error}
      </span>
    ) : null;

  return (
    <main className="page auth">
      <div className="page__inner auth__inner">
        <header className="auth__intro rise" style={order(0)}>
          <h1 className="page__title auth__title">{title}</h1>
          <p className="page__sub auth__lead">Твой прогресс заслуживает, чтобы его сохранить.</p>
          {pending && (
            <p className="auth__pending">
              <span className="auth__pending-icon" aria-hidden="true">
                <Icon name="trophy" size={18} />
              </span>
              <span>
                <b>{pending}</b>
                <small>сохранится сразу после входа</small>
              </span>
            </p>
          )}
        </header>

        <ul className="auth__perks">
          {PERKS.map((p, i) => (
            <li key={p.title} className="rise" style={order(2 + i)}>
              <span className="auth__perk-icon" aria-hidden="true">
                <Icon name={p.icon} size={20} />
              </span>
              <span>
                <b>{p.title}</b>
                <small>{p.text}</small>
              </span>
            </li>
          ))}
        </ul>

        <div className="auth__side rise" style={order(1)}>
          <form className="auth__card" onSubmit={submit} noValidate>
            <div className="auth__tabs" role="tablist">
              {(['login', 'register'] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  role="tab"
                  aria-selected={mode === m}
                  className={`auth__tab ${mode === m ? 'is-active' : ''}`}
                  onClick={() => switchTo(m)}
                >
                  {m === 'register' ? 'Регистрация' : 'Вход'}
                </button>
              ))}
            </div>

            <label className="auth-field">
              <span className="auth-field__label">Почта</span>
              <input
                type="email"
                autoComplete="email"
                inputMode="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@mail.com"
                aria-invalid={errField === 'email' || undefined}
                required
              />
              {errorAt('email')}
            </label>
            {mode === 'register' && (
              <label className="auth-field">
                <span className="auth-field__label">Ник в рейтинге</span>
                <input
                  type="text"
                  autoComplete="nickname"
                  value={nick}
                  maxLength={20}
                  onChange={(e) => setNick(e.target.value)}
                  placeholder="Например, Рауан"
                  aria-invalid={errField === 'nick' || undefined}
                  required
                />
                {errorAt('nick') ?? (
                  <small className="auth-field__help">3–20 символов, его увидят другие</small>
                )}
              </label>
            )}
            <label className="auth-field">
              <span className="auth-field__label">Пароль</span>
              <input
                type="password"
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={mode === 'register' ? 'Минимум 8 символов' : ''}
                aria-invalid={errField === 'password' || undefined}
                required
              />
              {errorAt('password')}
            </label>

            {errField === 'form' && (
              <p className="auth__error" role="alert">
                <Icon name="alert" size={18} /> {error}
              </p>
            )}

            <button type="submit" className="btn btn--primary auth__submit" disabled={busy}>
              {busy ? 'Секунду…' : mode === 'login' ? 'Войти' : 'Создать аккаунт'}
            </button>
            <p className="auth__switch">
              {mode === 'login' ? 'Ещё нет аккаунта? ' : 'Уже есть аккаунт? '}
              <button
                type="button"
                className="auth__link"
                onClick={() => switchTo(mode === 'login' ? 'register' : 'login')}
              >
                {mode === 'login' ? 'Зарегистрироваться' : 'Войти'}
              </button>
            </p>
          </form>

          <DwellButton size="sm" variant="ghost" className="auth__back" onSelect={onBack}>
            <Icon name="back" size={18} /> {reason === 'save' ? 'Не сохранять' : 'Назад'}
          </DwellButton>
        </div>
      </div>
    </main>
  );
}
