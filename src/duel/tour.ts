// Обучение при первом входе на арену: затемнение и подсветка частей настоящей страницы (не отдельный экран),
// карточка «1/5» с «Далее» и «Пропустить». Повторить — кнопка «?» в шапке.
// Клавиатура: Enter / → — дальше, ← — назад, Esc — пропустить. Уважает prefers-reduced-motion.

const DONE_KEY = 'forma.duel.tour';

interface Step {
  target: string;
  title: string;
  text: string;
}

const STEPS: Step[] = [
  {
    target: 'tour-ex',
    title: 'Выбери упражнение',
    text: 'Листай стрелками или нажми на превью. У каждого упражнения свой рейтинг — соревнуйся в том, что любишь.',
  },
  {
    target: 'tour-dur',
    title: 'Выбери длительность',
    text: 'Пуля — 30 секунд, блиц — минута, рапид — 3 минуты. Под ними видно, сколько игроков сейчас ищут бой.',
  },
  {
    target: 'tour-go',
    title: 'Найди соперника',
    text: 'Подберём игрока с близкими кубками. Камера считает повторы, а соперник видит только твой счёт — не видео. С другом или с ботом — кнопки ниже.',
  },
  {
    target: 'rating',
    title: 'Кубки и титулы',
    text: 'Победа приносит кубки, поражение — снимает. По сумме кубков растёт титул и меняется рамка вокруг аватара.',
  },
  {
    target: 'tour-lists',
    title: 'Дуэли и топ игроков',
    text: 'Здесь твои последние бои и лучшие игроки недели. Своё место в таблице подсвечено. Удачи на арене!',
  },
];

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const el = {
  root: $<HTMLDivElement>('tour'),
  hole: $<HTMLDivElement>('tour-hole'),
  card: $<HTMLDivElement>('tour-card'),
  step: $<HTMLElement>('tour-step'),
  title: $<HTMLElement>('tour-title'),
  text: $<HTMLElement>('tour-text'),
  next: $<HTMLButtonElement>('tour-next'),
  skip: $<HTMLButtonElement>('tour-skip'),
};

let index = -1;
let raf = 0;
let settleUntil = 0;
let returnFocus: HTMLElement | null = null;
const reduced = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

export function initTour(canStart: () => boolean): void {
  $<HTMLButtonElement>('tour-open').addEventListener('click', () => startTour());
  el.next.addEventListener('click', () => go(index + 1));
  el.skip.addEventListener('click', () => finish());
  // Клик мимо карточки не закрывает (легко промахнуться); страница под затемнением не нажимается.
  document.addEventListener('keydown', onKey);
  window.addEventListener('resize', place);
  document.addEventListener('scroll', place, true);
  if (seen()) return;
  // Первый визит: даём странице собраться (шрифт, карточки), потом показываем.
  setTimeout(() => {
    if (!seen() && canStart()) startTour();
  }, 900);
}

export function tourOpen(): boolean {
  return index >= 0;
}

export function startTour(): void {
  returnFocus = document.activeElement as HTMLElement | null;
  el.root.hidden = false;
  el.root.classList.toggle('is-still', reduced());
  go(0);
}

function go(i: number): void {
  if (i >= STEPS.length) return finish();
  index = Math.max(0, i);
  const s = STEPS[index]!;
  el.step.textContent = `${index + 1}/${STEPS.length}`;
  el.title.textContent = s.title;
  el.text.textContent = s.text;
  el.next.textContent = index === STEPS.length - 1 ? 'Готово' : 'Далее';
  el.skip.hidden = index === STEPS.length - 1;
  const target = document.getElementById(s.target);
  target?.scrollIntoView({ block: 'center', behavior: reduced() ? 'auto' : 'smooth' });
  // Пока страница докручивается — держим подсветку на цели.
  settleUntil = performance.now() + 700;
  cancelAnimationFrame(raf);
  const follow = () => {
    place();
    if (performance.now() < settleUntil) raf = requestAnimationFrame(follow);
  };
  follow();
  el.next.focus({ preventScroll: true });
}

function place(): void {
  if (index < 0) return;
  const target = document.getElementById(STEPS[index]!.target);
  if (!target) return;
  const r = target.getBoundingClientRect();
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const pad = 8;
  const top = Math.max(6, r.top - pad);
  const left = Math.max(6, r.left - pad);
  const bottom = Math.min(vh - 6, r.bottom + pad);
  const right = Math.min(vw - 6, r.right + pad);
  Object.assign(el.hole.style, {
    top: `${top}px`,
    left: `${left}px`,
    width: `${Math.max(0, right - left)}px`,
    height: `${Math.max(0, bottom - top)}px`,
  });
  // Карточка — под целью, над ней или сбоку; на телефоне — по ширине экрана.
  const card = el.card.getBoundingClientRect();
  const gap = 14;
  const narrow = vw < 640;
  const w = narrow ? vw - 32 : Math.min(360, vw - 32);
  let x = narrow ? 16 : Math.min(Math.max(16, left), vw - w - 16);
  let y: number;
  if (bottom + gap + card.height <= vh - 16) y = bottom + gap;
  else if (top - gap - card.height >= 16) y = top - gap - card.height;
  else if (!narrow && right + gap + w <= vw - 16) {
    x = right + gap;
    y = Math.min(Math.max(16, top), vh - card.height - 16);
  } else if (!narrow && left - gap - w >= 16) {
    x = left - gap - w;
    y = Math.min(Math.max(16, top), vh - card.height - 16);
  } else y = vh - card.height - 16; // цель во весь экран — карточка поверх, у нижнего края
  Object.assign(el.card.style, { width: `${w}px`, left: `${x}px`, top: `${y}px` });
}

function onKey(e: KeyboardEvent): void {
  if (index < 0) return;
  if (e.key === 'Escape') {
    e.preventDefault();
    finish();
  } else if (e.key === 'ArrowRight') {
    e.preventDefault();
    go(index + 1);
  } else if (e.key === 'ArrowLeft') {
    e.preventDefault();
    go(index - 1);
  } else if (e.key === 'Tab') {
    // Фокус не уходит под затемнение: только «Пропустить» и «Далее».
    const items = [el.skip, el.next].filter((b) => !b.hidden);
    const at = items.indexOf(document.activeElement as HTMLButtonElement);
    e.preventDefault();
    items[(at + (e.shiftKey ? -1 : 1) + items.length) % items.length]?.focus();
  }
}

function finish(): void {
  index = -1;
  cancelAnimationFrame(raf);
  el.root.hidden = true;
  try {
    localStorage.setItem(DONE_KEY, '1');
  } catch {
    /* приватный режим — покажем ещё раз, не страшно */
  }
  returnFocus?.focus?.({ preventScroll: true });
}

function seen(): boolean {
  try {
    return localStorage.getItem(DONE_KEY) === '1';
  } catch {
    return false;
  }
}
