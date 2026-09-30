import type { RepSummary } from '../src/engine/exercises/fsm';
import type { FormErrorDef } from '../src/engine/hints';
import { RuleEngine, type RepContext, type RuleDef } from '../src/engine/rules';
import type { Phase } from '../src/engine/types';

/** Игрушечные метрики: у каждой ошибки свой флажок. */
interface M {
  a: boolean;
  b: boolean;
  c: boolean;
  depth: number;
}

const def = (code: string, priority: number, phases: Phase[] = ['down', 'bottom', 'up']): FormErrorDef => ({
  code,
  message: `подсказка ${code}`,
  joints: [25],
  arrow: 'out',
  severity: 'bad',
  phases,
  priority,
  penalty: 10 * priority,
});

const CATALOG = [def('a', 1), def('b', 2), def('c', 3, ['bottom']), def('shallow', 1, ['bottom'])];
const CFG = { holdMs: 200, minFrames: 3, cooldownMs: 4000, minGapMs: 1500, prerollMs: 500 };

const RULES: RuleDef<M>[] = [
  { code: 'a', kind: 'frame', check: (m) => (m.a ? {} : null) },
  { code: 'b', kind: 'frame', check: (m) => (m.b ? { joints: [26], arrow: 'in' } : null) },
  { code: 'c', kind: 'frame', check: (m) => (m.c ? {} : null) },
  {
    code: 'shallow',
    kind: 'rep',
    on: ['bottom', 'attempt'],
    check: (ctx) => (ctx.atBottom.depth < 1 ? {} : null),
  },
];

const M0: M = { a: false, b: false, c: false, depth: 1.2 };
const engine = () => new RuleEngine<M>('squat', RULES, CATALOG, CFG);

/** Подать одинаковые метрики n кадров с шагом 33 мс начиная с t0; вернуть показанные коды. */
function frames(e: RuleEngine<M>, m: Partial<M>, n: number, t0: number, phase: Phase = 'down'): string[] {
  const shown: string[] = [];
  for (let i = 0; i < n; i++) {
    const ev = e.onFrame({ ...M0, ...m }, phase, t0 + i * 33);
    if (ev) shown.push(ev.code);
  }
  return shown;
}

const ctx = (depth: number): RepContext<M> => {
  const summary: RepSummary = { startT: 0, bottomT: 500, endT: 1500, pMax: depth, durationMs: 1500 };
  return { summary, frames: [], atBottom: { ...M0, depth } };
};

describe('движок правил: антидребезг', () => {
  it('нарушение короче 200 мс не засчитывается', () => {
    const e = engine();
    expect(frames(e, { a: true }, 5, 0)).toEqual([]); // 5 кадров = 132 мс
    expect(frames(e, {}, 1, 200)).toEqual([]);
    expect(e.repErrors).toEqual([]);
  });

  it('держится 200 мс — засчитано и показано один раз', () => {
    const e = engine();
    expect(frames(e, { a: true }, 20, 0)).toEqual(['a']);
    expect(e.repErrors).toEqual(['a']);
  });

  it('антидребезг по времени, а не по кадрам: на 15 FPS тоже ~200 мс', () => {
    const e = engine();
    const shown: string[] = [];
    // 15 FPS: шаг 66 мс. Три кадра = 132 мс — рано; четвёртый (198 мс) — ещё рано; пятый — пора.
    for (let i = 0; i < 5; i++) {
      const ev = e.onFrame({ ...M0, a: true }, 'down', i * 66);
      if (ev) shown.push(`${ev.code}@${i}`);
    }
    expect(shown).toEqual(['a@4']);
  });

  it('мигающее нарушение (через кадр) не накапливается', () => {
    const e = engine();
    const shown: string[] = [];
    for (let i = 0; i < 60; i++) {
      const ev = e.onFrame({ ...M0, a: i % 2 === 0 }, 'down', i * 33);
      if (ev) shown.push(ev.code);
    }
    expect(shown).toEqual([]);
  });
});

describe('движок правил: привязка к фазе', () => {
  it('правило «только в нижней точке» молчит на спуске', () => {
    const e = engine();
    expect(frames(e, { c: true }, 30, 0, 'down')).toEqual([]);
    expect(frames(e, { c: true }, 30, 1000, 'bottom')).toEqual(['c']);
  });

  it('в исходном положении (start) правила техники не проверяются', () => {
    expect(frames(engine(), { a: true, b: true }, 60, 0, 'start')).toEqual([]);
  });
});

describe('движок правил: одна подсказка за раз', () => {
  it('две ошибки сразу — показывается важнейшая, вторая записана в ошибки повтора', () => {
    const e = engine();
    const shown = frames(e, { a: true, b: true }, 20, 0);
    expect(shown).toEqual(['a']);
    expect(e.repErrors).toEqual(['a', 'b']);
  });

  it('менее важная ждёт паузы 1,5 с и показывается, если ещё держится', () => {
    const e = engine();
    const shown = frames(e, { a: true, b: true }, 80, 0); // 2,6 с
    expect(shown).toEqual(['a', 'b']);
  });

  it('исправился до показа — подсказку не говорим, но ошибка в повторе осталась', () => {
    const e = engine();
    frames(e, { a: true, b: true }, 20, 0); // показана a, b ждёт
    expect(frames(e, {}, 60, 700)).toEqual([]); // b исправлена
    expect(e.repErrors).toEqual(['a', 'b']);
  });

  it('более важная ошибка перебивает паузу', () => {
    const e = engine();
    expect(frames(e, { b: true }, 10, 0)).toEqual(['b']);
    // Через 0,5 с появилась главная ошибка — ждать 1,5 с не будем.
    expect(frames(e, { a: true }, 10, 500)).toEqual(['a']);
  });

  it('подсказка берёт суставы и стрелку из проверки, если та их уточнила', () => {
    const e = engine();
    let ev = null;
    for (let i = 0; i < 20 && !ev; i++) ev = e.onFrame({ ...M0, b: true }, 'down', i * 33);
    expect(ev).toMatchObject({ code: 'b', joints: [26], arrow: 'in', severity: 'bad', exercise: 'squat' });
    expect(ev?.message).toBe('подсказка b');
  });
});

describe('движок правил: кулдаун 4 с', () => {
  it('та же ошибка в следующем повторе раньше 4 с — не повторяем фразу, но в ошибки пишем', () => {
    const e = engine();
    expect(frames(e, { a: true }, 20, 0)).toEqual(['a']);
    e.beginRep();
    expect(frames(e, { a: true }, 20, 2000)).toEqual([]);
    expect(e.repErrors).toEqual(['a']);
  });

  it('через 4 с та же фраза снова звучит', () => {
    const e = engine();
    frames(e, { a: true }, 20, 0);
    e.beginRep();
    expect(frames(e, { a: true }, 20, 4500)).toEqual(['a']);
  });

  it('в одном повторе одна и та же ошибка не звучит дважды, даже после исправления', () => {
    const e = engine();
    frames(e, { a: true }, 20, 0);
    frames(e, {}, 5, 700);
    expect(frames(e, { a: true }, 200, 900)).toEqual([]);
  });
});

describe('движок правил: разовые проверки', () => {
  it('мало глубины в нижней точке', () => {
    const e = engine();
    expect(e.onRepMoment('bottom', ctx(0.7), 500)?.code).toBe('shallow');
    expect(e.repErrors).toEqual(['shallow']);
  });

  it('глубина в норме — тишина', () => {
    expect(engine().onRepMoment('bottom', ctx(1.1), 500)).toBeNull();
  });

  it('неглубокая попытка (повтор не засчитан) — всё равно подсказка «глубже»', () => {
    expect(engine().onRepMoment('attempt', ctx(0.35), 500)?.code).toBe('shallow');
  });

  it('правило срабатывает только на своих моментах', () => {
    expect(engine().onRepMoment('rep', ctx(0.5), 500)).toBeNull();
  });
});

describe('движок правил: конфигурация', () => {
  it('новое правило — одна запись; код без подсказки в каталоге — сразу ошибка, а не молчание', () => {
    const extra: RuleDef<M> = { code: 'nope', kind: 'frame', check: () => ({}) };
    expect(() => new RuleEngine<M>('squat', [...RULES, extra], CATALOG, CFG)).toThrow(/nope/);
  });

  it('beginRep очищает ошибки повтора', () => {
    const e = engine();
    frames(e, { a: true }, 20, 0);
    e.beginRep();
    expect(e.repErrors).toEqual([]);
  });

  it('нарушение, которое идёт и в исходном положении, и в движении, — ошибка нового повтора сразу', () => {
    // Круги руками: «руки ниже плеч» ловится вверху круга (для счётчика — исходное положение).
    const cat = [def('a', 1, ['start', 'down', 'bottom', 'up'])];
    const e = new RuleEngine<M>('arm_circles', RULES.slice(0, 1), cat, CFG);
    frames(e, { a: true }, 10, 0, 'start');
    e.beginRep();
    e.onFrame({ ...M0, a: true }, 'down', 330);
    expect(e.repErrors).toEqual(['a']);
    // Исправился к началу движения — прошлое нарушение новому повтору не достаётся.
    const f = new RuleEngine<M>('arm_circles', RULES.slice(0, 1), cat, CFG);
    frames(f, { a: true }, 10, 0, 'start');
    f.beginRep();
    f.onFrame(M0, 'down', 330);
    frames(f, { a: true }, 2, 363);
    expect(f.repErrors).toEqual([]);
  });

  it('reset забывает и кулдауны', () => {
    const e = engine();
    frames(e, { a: true }, 20, 0);
    e.reset();
    expect(frames(e, { a: true }, 20, 1000)).toEqual(['a']);
  });
});
