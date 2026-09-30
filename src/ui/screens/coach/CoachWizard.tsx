// Анкета ИИ-тренера: цель → данные → ограничения. Проверка каждого шага — общими правилами (checkProfile).

import {
  GOALS,
  LEVELS,
  LIMITS,
  bmi,
  type CoachProfile,
  type Goal,
  type Level,
  type Limit,
} from '../../../shared/coach';
import type { ExerciseId } from '../../../engine/types';
import { Ghost } from '../../components/Ghost';
import { Icon, type IconName } from '../../components/Icon';
import { order } from '../../lib/motion';
import { GOAL_ICON, bmiInfo, toProfile, type Draft } from './draft';
import { FlowSteps } from './parts';

/** Атлет на карточке цели — упражнение, которое лучше всего её показывает. */
const GOAL_ART: Record<Goal, ExerciseId> = {
  lose_weight: 'jumping_jack',
  build_muscle: 'push_up',
  tone: 'squat_press',
  endurance: 'high_knees',
  health: 'arm_circles',
};

const LIMIT_ICON: Record<Limit, IconName> = {
  no_jumps: 'ban',
  back: 'activity',
  knees: 'target',
  wrists: 'hand',
  shoulders: 'arms',
  one_arm: 'hand',
  one_leg: 'run',
  heart: 'heart',
  balance: 'scan',
  pregnancy: 'user',
  no_floor: 'moon',
};

const LEVEL_TEXT: Record<Level, string> = {
  beginner: 'Начнём с малого объёма и простых упражнений, чтобы поставить технику и втянуться.',
  intermediate: 'Подберём сбалансированную нагрузку с постепенным увеличением.',
  advanced: 'Больше подходов и повторов, короче отдых — ближе к верхним границам.',
};

const MINUTES = [10, 15, 20, 30, 45, 60];

export function CoachWizard({
  step,
  draft,
  error,
  onStep,
  onChange,
  onNext,
  onBack,
}: {
  step: number;
  draft: Draft;
  error: string | null;
  onStep: (s: number) => void;
  onChange: (d: Partial<Draft>) => void;
  onNext: () => void;
  onBack: () => void;
}) {
  const profile = toProfile(draft);
  const toggleLimit = (l: Limit) =>
    onChange({
      limits: draft.limits.includes(l) ? draft.limits.filter((x) => x !== l) : [...draft.limits, l],
    });

  return (
    <main className="page coach">
      <div className="page__inner ch-inner">
        <button type="button" className="back-link" onClick={onBack}>
          <Icon name="back" size={16} /> {step === 0 ? 'Назад' : 'К тренеру'}
        </button>
        <FlowSteps at={step} onJump={onStep} />

        {step === 0 && (
          <section className="ch-step rise" style={order(0)}>
            <h1 className="ch-title">Какая у тебя цель?</h1>
            <p className="ch-sub">Это поможет подобрать подходящие упражнения и структуру тренировок.</p>
            <div className="ch-goals">
              {(Object.keys(GOALS) as Goal[]).map((g, i) => (
                <button
                  key={g}
                  type="button"
                  className={`ch-goal ch-goal--${g} ${draft.goal === g ? 'is-active' : ''} rise`}
                  style={order(i + 1)}
                  onClick={() => onChange({ goal: g })}
                  aria-pressed={draft.goal === g}
                >
                  <span className="ch-goal__art" aria-hidden="true">
                    <Ghost exercise={GOAL_ART[g]} still phase={0.3} className="ch-goal__ghost" />
                  </span>
                  <span className="ch-goal__text">
                    <span className="ch-goal__icon">
                      <Icon name={GOAL_ICON[g]} size={26} />
                    </span>
                    <b>{GOALS[g].title}</b>
                    <small>{GOALS[g].sub}</small>
                  </span>
                </button>
              ))}
            </div>
          </section>
        )}

        {step === 1 && (
          <section className="ch-step rise" style={order(0)}>
            <h1 className="ch-title">Расскажи о себе</h1>
            <p className="ch-sub">Чем точнее данные, тем лучше план подойдёт именно тебе.</p>
            <div className="ch-body">
              <div className="ch-form">
                <div className="ch-row">
                  <span className="ch-label">Пол</span>
                  <div className="ch-choice ch-choice--2">
                    {(['male', 'female'] as const).map((s) => (
                      <button
                        key={s}
                        type="button"
                        className={draft.sex === s ? 'is-active' : ''}
                        onClick={() => onChange({ sex: s })}
                      >
                        {s === 'male' ? 'Мужской' : 'Женский'}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="ch-fields">
                  <NumField
                    label="Возраст"
                    unit="лет"
                    value={draft.age}
                    onChange={(v) => onChange({ age: v })}
                  />
                  <NumField
                    label="Рост"
                    unit="см"
                    value={draft.heightCm}
                    onChange={(v) => onChange({ heightCm: v })}
                  />
                  <NumField
                    label="Вес"
                    unit="кг"
                    value={draft.weightKg}
                    onChange={(v) => onChange({ weightKg: v })}
                  />
                </div>
                <div className="ch-fields ch-fields--one">
                  <NumField
                    label="Желаемый вес"
                    hint="(необязательно)"
                    unit="кг"
                    value={draft.targetKg}
                    onChange={(v) => onChange({ targetKg: v })}
                  />
                </div>
                <div className="ch-row">
                  <span className="ch-label">Уровень подготовки</span>
                  <div className="ch-choice ch-choice--3">
                    {(Object.keys(LEVELS) as Level[]).map((l) => (
                      <button
                        key={l}
                        type="button"
                        className={draft.level === l ? 'is-active' : ''}
                        onClick={() => onChange({ level: l })}
                      >
                        {LEVELS[l]}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="ch-fields ch-fields--two">
                  <div className="ch-row">
                    <span className="ch-label">Сколько тренировок в неделю?</span>
                    <div className="ch-counter">
                      <button
                        type="button"
                        aria-label="Меньше"
                        onClick={() => onChange({ daysPerWeek: Math.max(1, draft.daysPerWeek - 1) })}
                      >
                        −
                      </button>
                      <b>
                        {draft.daysPerWeek}{' '}
                        <small>
                          {draft.daysPerWeek === 1 ? 'раз' : draft.daysPerWeek < 5 ? 'раза' : 'раз'}
                        </small>
                      </b>
                      <button
                        type="button"
                        aria-label="Больше"
                        onClick={() => onChange({ daysPerWeek: Math.min(7, draft.daysPerWeek + 1) })}
                      >
                        +
                      </button>
                    </div>
                  </div>
                  <div className="ch-row">
                    <span className="ch-label">Минут на одну тренировку?</span>
                    <div className="ch-counter">
                      <button
                        type="button"
                        aria-label="Меньше"
                        onClick={() =>
                          onChange({
                            minutesPerSession:
                              MINUTES[Math.max(0, MINUTES.indexOf(draft.minutesPerSession) - 1)] ?? 20,
                          })
                        }
                      >
                        −
                      </button>
                      <b>
                        {draft.minutesPerSession} <small>минут</small>
                      </b>
                      <button
                        type="button"
                        aria-label="Больше"
                        onClick={() =>
                          onChange({
                            minutesPerSession:
                              MINUTES[
                                Math.min(MINUTES.length - 1, MINUTES.indexOf(draft.minutesPerSession) + 1)
                              ] ?? 20,
                          })
                        }
                      >
                        +
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              <aside className="ch-aside">
                <BmiCard profile={profile} />
                <div className="ch-card ch-level">
                  <span className="ch-label">Примерно так выглядит твой уровень</span>
                  <div className="ch-level__row">
                    <span className="ch-level__icon">
                      <Icon name="activity" size={20} />
                    </span>
                    <span>
                      <b>{LEVELS[draft.level]}</b>
                      <small>{LEVEL_TEXT[draft.level]}</small>
                    </span>
                  </div>
                </div>
              </aside>
            </div>
          </section>
        )}

        {step === 2 && (
          <section className="ch-step rise" style={order(0)}>
            <h1 className="ch-title">Есть ли ограничения?</h1>
            <p className="ch-sub">
              Выбери всё, что касается тебя, — это сделает план безопасным. Отмеченное уберём из плана
              наверняка.
            </p>
            <div className="ch-limits">
              <button
                type="button"
                className={`ch-limit ${draft.limits.length === 0 ? 'is-active' : ''}`}
                onClick={() => onChange({ limits: [] })}
                aria-pressed={draft.limits.length === 0}
              >
                <span className="ch-limit__icon">
                  <Icon name="check" size={22} />
                </span>
                <span>
                  <b>Нет ограничений</b>
                  <small>Могу делать всё</small>
                </span>
              </button>
              {(Object.keys(LIMITS) as Limit[]).map((l) => (
                <button
                  key={l}
                  type="button"
                  className={`ch-limit ${draft.limits.includes(l) ? 'is-active' : ''}`}
                  onClick={() => toggleLimit(l)}
                  aria-pressed={draft.limits.includes(l)}
                >
                  <span className="ch-limit__icon">
                    <Icon name={LIMIT_ICON[l]} size={22} />
                  </span>
                  <span>
                    <b>{LIMITS[l].title}</b>
                    <small>{LIMITS[l].sub}</small>
                  </span>
                </button>
              ))}
            </div>
            <label className="ch-notes">
              <span className="ch-label">
                Расскажи подробнее <em>(необязательно)</em>
              </span>
              <textarea
                rows={4}
                maxLength={1500}
                value={draft.notes}
                onChange={(e) => onChange({ notes: e.target.value })}
                placeholder="Например: у меня нет левой руки; иногда болит правое колено после нагрузки; предпочитаю упражнения стоя"
              />
              <small>{draft.notes.length} / 1500</small>
            </label>
          </section>
        )}

        {error && (
          <p className="ch-error" role="alert">
            <Icon name="alert" size={18} /> {error}
          </p>
        )}

        <footer className="ch-nav">
          {step > 0 && (
            <button type="button" className="btn btn--lg ch-nav__back" onClick={() => onStep(step - 1)}>
              <Icon name="back" size={18} /> Назад
            </button>
          )}
          <button type="button" className="btn btn--primary btn--lg ch-nav__next" onClick={onNext}>
            {step < 2 ? 'Продолжить' : 'Составить план'} <Icon name="chevron" size={18} />
          </button>
        </footer>
      </div>
    </main>
  );
}

function BmiCard({ profile }: { profile: CoachProfile }) {
  const ok =
    Number.isFinite(profile.heightCm) && profile.heightCm >= 100 && Number.isFinite(profile.weightKg);
  const v = ok ? bmi(profile) : null;
  const info = v ? bmiInfo(v) : null;
  // Шкала 16…40: зелёная зона — 18,5…25.
  const pos = v ? Math.min(100, Math.max(0, ((v - 16) / 24) * 100)) : 0;
  return (
    <div className="ch-card ch-bmi">
      <span className="ch-label">Твой ИМТ</span>
      <div className="ch-bmi__value">
        <b>{v ?? '—'}</b>
        {info && <span className={`ch-badge ch-badge--${info.tone}`}>{info.label}</span>}
      </div>
      <div className="ch-bmi__scale" aria-hidden="true">
        {v && <i style={{ left: `${pos}%` }} />}
      </div>
      <div className="ch-bmi__ticks" aria-hidden="true">
        <span>16</span>
        <span>18.5</span>
        <span>25</span>
        <span>30</span>
        <span>40</span>
      </div>
      <p>{info ? info.text : 'Введи рост и вес — посчитаем индекс массы тела.'}</p>
    </div>
  );
}

function NumField({
  label,
  unit,
  hint,
  value,
  onChange,
}: {
  label: string;
  unit: string;
  hint?: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="ch-field">
      <span className="ch-label">
        {label} {hint && <em>{hint}</em>}
      </span>
      <span className="ch-input">
        <input
          type="text"
          inputMode="decimal"
          value={value}
          onChange={(e) => onChange(e.target.value.replace(/[^\d.,]/g, '').slice(0, 5))}
        />
        <i>{unit}</i>
      </span>
    </label>
  );
}
