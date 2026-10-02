import { BotPoser, type V3 } from '../src/fight/botPose';
import type { BotView } from '../src/fight/fight';

const dist = (a: V3, b: V3) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
/** Камера — перед ботом на уровне глаз (координаты бота: y вниз, к зрителю −z). */
const AIM = { x: 0, y: -1.42, z: -1.0 };

/** Поза через долгое время в одном состоянии (сглаживание уже догнало). */
function settled(bot: Omit<BotView, 'since' | 'until'> & { ms?: number }, at = 0.5) {
  const ms = bot.ms ?? 1000;
  const view: BotView = { state: bot.state, attack: bot.attack, since: 0, until: ms };
  const poser = new BotPoser();
  let out = poser.update({ now: 0, bot: view, aim: AIM, hurt: null, blockedAt: -Infinity, ko: 0 });
  for (let t = 0; t <= ms * at; t += 8) {
    out = poser.update({ now: t, bot: view, aim: AIM, hurt: null, blockedAt: -Infinity, ko: 0 });
  }
  return out.pose as V3[];
}

describe('позы бота', () => {
  it('руки постоянной длины во всех состояниях', () => {
    const cases = [
      settled({ state: 'guard', attack: null }),
      settled({ state: 'shell', attack: null }),
      settled({ state: 'open', attack: null }),
      settled({ state: 'stagger', attack: null }),
      settled({ state: 'windup', attack: { kind: 'power', side: 'right' } }, 1),
      settled({ state: 'windup', attack: { kind: 'power', side: 'left' } }, 1),
      settled({ state: 'strike', attack: { kind: 'jab', side: 'left' }, ms: 130 }, 1),
    ];
    for (const p of cases) {
      expect(dist(p[11]!, p[13]!)).toBeCloseTo(0.3, 2);
      expect(dist(p[13]!, p[15]!)).toBeCloseTo(0.27, 2);
      expect(dist(p[12]!, p[14]!)).toBeCloseTo(0.3, 2);
      expect(dist(p[14]!, p[16]!)).toBeCloseTo(0.27, 2);
      for (const q of p) if (q) expect(Number.isFinite(q.x + q.y + q.z)).toBe(true);
    }
  });

  it('джеб: левая рука вытянута в цель, правая — у подбородка', () => {
    const guard = settled({ state: 'guard', attack: null });
    const jab = settled({ state: 'strike', attack: { kind: 'jab', side: 'left' }, ms: 130 }, 1.2);
    expect(dist(jab[15]!, AIM)).toBeLessThan(dist(guard[15]!, AIM) - 0.3);
    expect(dist(jab[11]!, jab[15]!)).toBeGreaterThan(0.5);
    expect(dist(jab[16]!, guard[16]!)).toBeLessThan(0.08);
  });

  it('мощный правый: на замахе правая отведена назад, левая опущена; в ударе правая — в цель', () => {
    const guard = settled({ state: 'guard', attack: null });
    const wind = settled({ state: 'windup', attack: { kind: 'power', side: 'right' } }, 1);
    expect(wind[16]!.z).toBeGreaterThan(guard[16]!.z + 0.1); // назад
    expect(wind[15]!.y).toBeGreaterThan(guard[15]!.y + 0.05); // левая ниже
    const hit = settled({ state: 'strike', attack: { kind: 'power', side: 'right' }, ms: 190 }, 1.2);
    expect(dist(hit[16]!, AIM)).toBeLessThan(dist(guard[16]!, AIM) - 0.35);
  });

  it('глухой блок — перчатки у лица; открыт — руки у пояса', () => {
    const shell = settled({ state: 'shell', attack: null });
    const open = settled({ state: 'open', attack: null });
    const nose = shell[0]!;
    expect(Math.abs(shell[15]!.y - nose.y)).toBeLessThan(0.1);
    expect(Math.abs(shell[16]!.y - nose.y)).toBeLessThan(0.1);
    expect(open[15]!.y).toBeGreaterThan(open[11]!.y + 0.2);
    expect(open[16]!.y).toBeGreaterThan(open[12]!.y + 0.2);
  });
});
