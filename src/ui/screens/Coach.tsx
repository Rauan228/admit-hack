// Раздел «ИИ-тренер» (/app/plan): главная тренера → анкета (цель, данные, ограничения) → «ИИ анализирует»
// → готовый план. День плана запускается обычной тренировкой; пройденные дни копятся в истории (store/coach).

import { useEffect, useState } from 'react';
import { checkProfile, type CoachPlan, type Goal } from '../../shared/coach';
import { ApiError, fetchCoachPlan, generateCoachPlan, useAuth } from '../store/api';
import {
  loadCoachPlan,
  loadCoachProfile,
  loadHistory,
  saveCoachPlan,
  saveCoachProfile,
} from '../store/coach';
import { CoachHome } from './coach/CoachHome';
import { CoachResult, CoachThinking } from './coach/CoachResult';
import { CoachWizard } from './coach/CoachWizard';
import { toDraft, toProfile, type Draft } from './coach/draft';
import './Coach.css';

type View =
  { v: 'home' } | { v: 'form'; step: number } | { v: 'thinking' } | { v: 'plan'; week: number; day?: number };

export function Coach({
  onStart,
  onBack,
}: {
  /** Начать день index недели week. */
  onStart: (plan: CoachPlan, index: number, week: number) => void;
  onBack: () => void;
}) {
  const { user } = useAuth();
  const [plan, setPlan] = useState<CoachPlan | null>(loadCoachPlan);
  const [draft, setDraft] = useState<Draft>(() => toDraft(loadCoachProfile()));
  const [view, setView] = useState<View>({ v: 'home' });
  const [error, setError] = useState<string | null>(null);

  // Вошёл, а на устройстве плана нет — берём последний с сервера.
  useEffect(() => {
    if (!user || plan) return;
    let live = true;
    fetchCoachPlan()
      .then((r) => {
        if (!live || !r.plan) return;
        saveCoachPlan(r.plan);
        setPlan(r.plan);
        if (r.profile) {
          saveCoachProfile(r.profile);
          setDraft(toDraft(r.profile));
        }
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [user, plan]);

  const build = async () => {
    const profile = toProfile(draft);
    saveCoachProfile(profile);
    setView({ v: 'thinking' });
    setError(null);
    try {
      const r = await generateCoachPlan(profile);
      saveCoachPlan(r.plan);
      setPlan(r.plan);
      setView({ v: 'plan', week: 1 });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Не получилось составить план — попробуй ещё раз');
      setView({ v: 'form', step: 2 });
    }
  };

  const profile = loadCoachProfile();
  const history = plan ? loadHistory(plan) : [];

  if (view.v === 'thinking') return <CoachThinking profile={toProfile(draft)} />;

  if (view.v === 'form')
    return (
      <CoachWizard
        step={view.step}
        draft={draft}
        error={error}
        onStep={(step) => {
          setError(null);
          setView({ v: 'form', step });
        }}
        onChange={(d) => {
          setDraft((old) => ({ ...old, ...d }));
          setError(null);
        }}
        onNext={() => {
          const err = view.step === 0 ? null : checkProfile(toProfile(draft));
          if (err) return setError(err);
          if (view.step < 2) setView({ v: 'form', step: view.step + 1 });
          else void build();
        }}
        onBack={() => setView({ v: 'home' })}
      />
    );

  if (view.v === 'plan' && plan)
    return (
      <CoachResult
        plan={plan}
        profile={profile}
        history={history}
        week={view.week}
        day={view.day}
        onStart={(i, w) => onStart(plan, i, w)}
        onEdit={() => setView({ v: 'form', step: 0 })}
        onRebuild={() => void build()}
        onHome={() => setView({ v: 'home' })}
      />
    );

  return (
    <CoachHome
      plan={plan}
      profile={profile}
      history={history}
      onCreate={(goal?: Goal) => {
        if (goal) setDraft((d) => ({ ...d, goal }));
        setView({ v: 'form', step: goal ? 1 : 0 });
      }}
      onEdit={(step) => setView({ v: 'form', step })}
      onStart={(i, w) => plan && onStart(plan, i, w)}
      onOpen={(week, day) => setView({ v: 'plan', week, day })}
      onBack={onBack}
    />
  );
}
