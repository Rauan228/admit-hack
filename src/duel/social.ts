// E-25: вызовы друзьям на странице дуэли. «Побей мой результат»: после боя — «Вызвать друга»
// (ссылкой в мессенджер или игроку из друзей / общего списка), у адресата — «Вызовы тебе» и карточка
// вызова по ссылке. Бой идёт против записи повторов вызова; ответ уходит автору.
// Все имена — только через textContent: ники и имена гостей приходят от других людей.

import { cupsLabel, describeAward, type ArenaStanding } from '../shared/arena';
import type { DuelExercise } from '../shared/duel';
import { ApiError, api, challengeUrl, type AnswerResult, type Challenge, type Me, type Player } from './api';
import { face } from './face';
import { duelExercise, exerciseTitle, formatName, repsWord } from './labels';
import { reloadLadder } from './ladder';

export interface RecordedOpponent {
  challengeId: string;
  name: string;
  /** E-29: вызов бросают в своём упражнении — отвечаешь в нём же. */
  exercise: DuelExercise;
  reps: number;
  durationMs: number;
  timeline: number[];
}

interface Hooks {
  /** Принять вызов: бой против записи. */
  accept(opp: RecordedOpponent): void;
  /** Вошёл или вышел (онлайн-дуэли нужно переподключиться с новой cookie). */
  accountChanged?(why: 'in' | 'out'): void;
  /** Подтянулись кубки — обновить рамку, если бой уже на экране. */
  rankChanged?(): void;
}

export interface AnswerNote {
  note: string;
  awardText: string;
  rival: { title: string | null; frame: string | null } | null;
}

/** Основной сайт — там, где есть API (зеркала на Pages и Vercel — только статика). */
const MAIN_SITE = 'https://forma.178.88.115.213.sslip.io/duel.html';
const INBOX_EVERY_MS = 30_000;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const el = {
  app: $<HTMLElement>('app'),
  account: $<HTMLDivElement>('account'),
  inbox: $<HTMLDivElement>('inbox'),
  card: $<HTMLDivElement>('challenge-card'),
  dialog: $<HTMLDialogElement>('invite'),
  invReps: $<HTMLElement>('inv-reps'),
  invEx: $<HTMLElement>('inv-ex'),
  invBody: $<HTMLDivElement>('inv-body'),
  invLogin: $<HTMLDivElement>('inv-login'),
  invShare: $<HTMLButtonElement>('inv-share'),
  invLink: $<HTMLInputElement>('inv-link'),
  invStatus: $<HTMLParagraphElement>('inv-status'),
  search: $<HTMLInputElement>('inv-search'),
  list: $<HTMLUListElement>('inv-list'),
};

let hooks: Hooks;
let me: Me | null = null;
let standing: ArenaStanding | null = null;
/** Форма входа открыта сразу — со страницы приглашения, без лишнего клика «Войти». */
let formOpen = false;
/** API доступен (на зеркалах без сервера — нет). */
let online = true;
let guestName = '';
let invite: {
  timeline: number[];
  durationMs: number;
  exercise: DuelExercise;
  linkId: string | null;
} | null = null;
/** Номер последнего запроса списка — ответ на устаревший поиск не рисуем. */
let listSeq = 0;

export async function initSocial(h: Hooks): Promise<void> {
  hooks = h;
  try {
    me = await api.me();
    if (me) {
      formOpen = false;
      standing = await api.standing().catch(() => null);
    }
  } catch {
    online = false;
  }
  // Форму входа могли открыть, пока узнавали сессию — не затираем её пустым ответом.
  if (me || !formOpen) renderAccount();
  void refreshInbox();
  void showLinkChallenge();
  window.addEventListener('hashchange', () => void showLinkChallenge());
  setInterval(() => {
    if (me && el.app.dataset.screen === 'intro' && document.visibilityState === 'visible')
      void refreshInbox();
  }, INBOX_EVERY_MS);

  el.invShare.addEventListener('click', () => void shareLink());
  let debounce = 0;
  el.search.addEventListener('input', () => {
    clearTimeout(debounce);
    debounce = window.setTimeout(() => void showPeople(), 250);
  });
}

// ——— Аккаунт ———
function renderAccount(): void {
  el.account.replaceChildren();
  if (!online) {
    const p = text('p', 'account__note', 'Вызовы друзьям работают на основном сайте: ');
    const a = document.createElement('a');
    a.href = MAIN_SITE;
    a.textContent = 'forma…/duel.html';
    p.append(a);
    el.account.append(p);
    return;
  }
  if (me) {
    const box = document.createElement('div');
    box.className = 'account__me';
    const avatar = face(me.nick, standing?.frame ?? null, 40);
    if (standing?.title) avatar.title = standing.title.name;
    const who = document.createElement('div');
    who.className = 'account__who';
    who.append(text('b', '', me.nick), rankBlock(standing));
    box.append(avatar, who);
    const out = button('Выйти', 'btn btn--sm btn--ghost');
    out.addEventListener('click', async () => {
      await api.logout().catch(() => undefined);
      me = null;
      standing = null;
      formOpen = false;
      hooks.accountChanged?.('out');
      renderAccount();
      el.inbox.replaceChildren();
      void showLinkChallenge();
    });
    el.account.append(box, out);
    return;
  }
  const p = text(
    'p',
    'account__note',
    'Пуля, блиц и рапид — только с аккаунтом. Бой с ботом кубки не меняет. На вызов по ссылке можно ответить и гостем, но кубки получит только вошедший.',
  );
  el.account.append(p);
  if (formOpen) {
    el.account.append(loginForm(onSignedIn));
    return;
  }
  const open = button('Войти', 'btn btn--sm');
  open.addEventListener('click', () => openLogin());
  el.account.append(open);
}

/** Соревнование без аккаунта не стартует — открываем вход прямо в панели. */
export function openLogin(): void {
  if (me || !online) return;
  formOpen = true;
  renderAccount();
  el.account.scrollIntoView({ block: 'nearest' });
}

/** После боя подтянуть кубки, рамку и таблицу. */
export async function refreshRank(): Promise<void> {
  if (!me) return;
  standing = await api.standing().catch(() => standing);
  renderAccount();
  reloadLadder();
  hooks.rankChanged?.();
}

/** Буква и рамка для табло: пока идёт бой, титул мог смениться. */
export function myFace(): { name: string; frame: string | null; title: string | null } {
  return {
    name: me?.nick ?? 'Ты',
    frame: standing?.frame ?? null,
    title: standing?.title?.name ?? null,
  };
}

function rankBlock(s: ArenaStanding | null): HTMLElement {
  const wrap = document.createElement('span');
  wrap.className = 'account__rank';
  if (!s) {
    wrap.append(text('span', 'account__meta', 'Кубки появятся после первой соревновательной дуэли'));
    return wrap;
  }
  const title = s.title?.name ?? 'Без титула';
  const next = s.nextTitle ? ` · до «${s.nextTitle.name}» ${cupsLabel(s.nextTitle.left)}` : '';
  wrap.append(text('span', 'account__meta', `${title} · ${cupsLabel(s.cups)} · уровень ${s.level}${next}`));
  const bar = document.createElement('span');
  bar.className = 'account__bar';
  bar.setAttribute('role', 'progressbar');
  bar.setAttribute('aria-valuemin', '0');
  bar.setAttribute('aria-valuenow', String(s.into));
  bar.setAttribute('aria-valuemax', String(s.span));
  bar.setAttribute('aria-label', `Уровень ${s.level}, опыт ${s.xp}`);
  const fill = document.createElement('span');
  fill.style.width = `${Math.min(100, (s.into / Math.max(1, s.span)) * 100)}%`;
  bar.append(fill);
  wrap.append(bar);
  return wrap;
}

function onSignedIn(user: Me): void {
  me = user;
  formOpen = false;
  hooks.accountChanged?.('in');
  renderAccount();
  void refreshRank();
  void refreshInbox();
  void showLinkChallenge();
}

/** Форма входа / регистрации (почта, ник, пароль) — тот же аккаунт, что на платформе. */
function loginForm(done: (u: Me) => void): HTMLFormElement {
  let register = false;
  const form = document.createElement('form');
  form.className = 'login';
  const email = field('Почта', 'email', 'email');
  const nick = field('Ник', 'text', 'nickname');
  const pass = field('Пароль', 'password', 'current-password');
  nick.label.hidden = true;
  email.input.required = pass.input.required = true;
  const submit = button('Войти', 'btn btn--primary');
  submit.type = 'submit';
  const toggle = button('Нет аккаунта? Регистрация', 'btn btn--sm btn--ghost');
  const error = text('p', 'login__error', '');
  error.setAttribute('role', 'alert');
  toggle.addEventListener('click', () => {
    register = !register;
    nick.label.hidden = !register;
    // Скрытое обязательное поле не дало бы отправить форму входа.
    nick.input.required = register;
    submit.textContent = register ? 'Зарегистрироваться' : 'Войти';
    toggle.textContent = register ? 'Уже есть аккаунт? Войти' : 'Нет аккаунта? Регистрация';
    pass.input.autocomplete = register ? 'new-password' : 'current-password';
  });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    submit.disabled = true;
    error.textContent = '';
    try {
      const u = register
        ? await api.register(email.input.value, nick.input.value, pass.input.value)
        : await api.login(email.input.value, pass.input.value);
      done(u);
    } catch (err) {
      error.textContent = (err as Error).message;
    } finally {
      submit.disabled = false;
    }
  });
  form.append(email.label, nick.label, pass.label, submit, toggle, error);
  return form;
}

// ——— Вызовы тебе ———
async function refreshInbox(): Promise<void> {
  if (!me) return;
  let data;
  try {
    data = await api.inbox();
  } catch {
    return;
  }
  el.inbox.replaceChildren();
  const waiting = data.incoming.filter((c) => !c.answered);
  const answers = data.outgoing
    .flatMap((c) => c.answers.map((a) => ({ ...a, mine: c.reps, exercise: duelExercise(c.exercise) })))
    .slice(-3);
  if (!waiting.length && !answers.length) return;
  if (waiting.length) {
    el.inbox.append(text('h2', 'panel__title', 'Вызовы тебе'));
    const ul = document.createElement('ul');
    ul.className = 'people';
    for (const c of waiting.slice(0, 5)) {
      const li = row(
        c.from,
        `${exerciseTitle(duelExercise(c.exercise))} · ${c.reps} за ${formatName(c.durationMs)}`,
      );
      const go = button('Принять', 'btn btn--sm');
      go.addEventListener('click', () => void acceptById(c.id, go));
      li.append(go);
      ul.append(li);
    }
    el.inbox.append(ul);
  }
  if (answers.length) {
    el.inbox.append(text('h2', 'panel__title', 'Ответы на твои вызовы'));
    const ul = document.createElement('ul');
    ul.className = 'people';
    for (const a of answers.reverse()) {
      const li = row(a.name, `${exerciseTitle(a.exercise)} · ${a.reps} против твоих ${a.mine}`);
      li.dataset.outcome = a.reps > a.mine ? 'lose' : a.reps < a.mine ? 'win' : 'draw';
      ul.append(li);
    }
    el.inbox.append(ul);
  }
}

async function acceptById(id: string, btn: HTMLButtonElement): Promise<void> {
  btn.disabled = true;
  try {
    accept(await api.getChallenge(id));
  } catch (err) {
    btn.disabled = false;
    btn.textContent = (err as Error).message;
  }
}

function accept(c: Challenge): void {
  hooks.accept({
    challengeId: c.id,
    name: c.from,
    exercise: duelExercise(c.exercise),
    reps: c.reps,
    durationMs: c.durationMs,
    timeline: c.timeline,
  });
}

// ——— Вызов по ссылке (#c=<id>) ———
async function showLinkChallenge(): Promise<void> {
  const id = /^#c=([A-Za-z0-9]{1,32})$/.exec(location.hash)?.[1];
  el.card.replaceChildren();
  el.card.hidden = !id;
  if (!id) return;
  if (!online) {
    el.card.append(text('p', 'callout__text', 'Вызовы открываются на основном сайте.'));
    return;
  }
  let c: Challenge;
  try {
    c = await api.getChallenge(id);
  } catch (err) {
    el.card.append(text('p', 'callout__text', (err as Error).message));
    return;
  }
  const ex = duelExercise(c.exercise);
  const head = text('p', 'callout__title', '');
  head.append(text('b', '', c.from), c.mine ? ' — это твой вызов' : ' вызывает тебя');
  const score = text('p', 'callout__score', '');
  score.append(
    text('b', '', String(c.reps)),
    text('span', '', `${repsWord(c.reps)} · ${exerciseTitle(ex)} за ${formatName(c.durationMs)}`),
  );
  el.card.append(head, score);
  if (!c.mine) el.card.append(text('p', 'callout__text', 'Сделаешь больше?'));

  if (c.mine) {
    const list = c.answers.length
      ? c.answers.map((a) => `${a.name} — ${a.reps}`).join(', ')
      : 'Пока никто не ответил.';
    el.card.append(text('p', 'callout__text', list));
    return;
  }
  if (c.to && !c.forMe) {
    el.card.append(text('p', 'callout__text', `Этот вызов для ${c.to}. Если это ты — войди.`));
    if (!me) el.card.append(loginForm(onSignedIn));
    return;
  }
  if (!me) {
    const name = field('Как тебя подписать', 'text', 'nickname');
    name.input.maxLength = 20;
    name.input.placeholder = 'Гость';
    name.input.value = guestName;
    name.input.addEventListener('input', () => (guestName = name.input.value.trim()));
    el.card.append(name.label);
  }
  const go = button('Принять вызов', 'btn btn--primary callout__go');
  go.addEventListener('click', () => accept(c));
  el.card.append(go);
}

/** Ответ на вызов после боя: строка для итога и, если бой рейтинговый, кубки. */
export async function sendAnswer(opp: RecordedOpponent, timeline: number[]): Promise<AnswerNote> {
  const empty = (note: string): AnswerNote => ({ note, awardText: '', rival: null });
  try {
    const res: AnswerResult = await api.answer(
      opp.challengeId,
      timeline,
      me ? undefined : guestName || undefined,
    );
    void refreshInbox();
    if (res.award) void refreshRank();
    return {
      note: `Ответ отправлен — ${opp.name} увидит твой результат.`,
      awardText: res.award ? describeAward(res.award) : 'Кубки не изменились.',
      rival: res.rival,
    };
  } catch (err) {
    if (err instanceof ApiError && err.status === 409)
      return empty('Ответ уже был — этот бой шёл без зачёта.');
    return empty((err as Error).message);
  }
}

// ——— Окно «Вызвать друга» ———
export function openInvite(
  timeline: number[],
  durationMs: number,
  exercise: DuelExercise,
  suggest?: string,
): void {
  invite = { timeline, durationMs, exercise, linkId: null };
  el.invReps.textContent = String(timeline.length);
  el.invEx.textContent = `${exerciseTitle(exercise)} за ${formatName(durationMs)}.`;
  el.invStatus.textContent = '';
  el.invLink.hidden = true;
  el.search.value = suggest ?? '';
  renderInvite(suggest);
  el.dialog.showModal();
}

function renderInvite(suggest?: string): void {
  el.invLogin.replaceChildren();
  const ready = online && !!me;
  el.invBody.hidden = !ready;
  el.invLogin.hidden = ready;
  if (!online) {
    el.invLogin.append(text('p', 'account__note', 'Вызовы друзьям работают на основном сайте.'));
    return;
  }
  if (!me) {
    el.invLogin.append(text('p', 'account__note', 'Войди, чтобы бросить вызов — друг увидит твой ник.'));
    el.invLogin.append(
      loginForm((u) => {
        onSignedIn(u);
        renderInvite(suggest);
      }),
    );
    return;
  }
  void showPeople();
}

async function shareLink(): Promise<void> {
  if (!invite) return;
  el.invShare.disabled = true;
  try {
    invite.linkId ??= await api.challenge(invite.timeline, invite.durationMs, invite.exercise);
    const url = challengeUrl(invite.linkId);
    el.invLink.value = url;
    el.invLink.hidden = false;
    const n = invite.timeline.length;
    const title = exerciseTitle(invite.exercise);
    const text = `${title}: ${n} ${repsWord(n)} за ${formatName(invite.durationMs)} в FORMA. Сможешь больше?`;
    if (navigator.share) {
      await navigator.share({ title: `Дуэль: ${title}`, text, url }).catch(() => undefined);
      el.invStatus.textContent = 'Ссылка готова.';
    } else {
      await navigator.clipboard?.writeText(url).catch(() => undefined);
      el.invStatus.textContent = 'Ссылка скопирована — отправь её другу.';
    }
  } catch (err) {
    el.invStatus.textContent = (err as Error).message;
  } finally {
    el.invShare.disabled = false;
  }
}

/** Все игроки приложения с поиском по нику; друзья (★) — первыми. */
async function showPeople(): Promise<void> {
  if (!invite) return;
  const seq = ++listSeq;
  let people: Player[];
  try {
    people = await api.players(el.search.value.trim());
  } catch (err) {
    el.list.replaceChildren(text('li', 'people__empty', (err as Error).message));
    return;
  }
  if (seq !== listSeq) return; // пока ждали ответ, поиск уже поменялся
  el.list.replaceChildren();
  if (!people.length) {
    el.list.append(
      text(
        'li',
        'people__empty',
        el.search.value.trim()
          ? 'Никого не нашли — проверь ник или поделись ссылкой.'
          : 'Пока в приложении больше никого — поделись ссылкой.',
      ),
    );
    return;
  }
  for (const p of people) el.list.append(personRow(p));
}

function personRow(p: Player): HTMLLIElement {
  const bits = [p.title, p.cups ? cupsLabel(p.cups) : ''].filter((part): part is string => !!part);
  const li = row(p.nick, bits.join(' · '));
  const avatar = face(p.nick, p.frame ?? null, 32);
  if (p.title) avatar.title = p.title;
  li.prepend(avatar);
  const star = button(p.friend ? '★' : '☆', 'person__star');
  star.setAttribute('aria-pressed', String(p.friend));
  star.setAttribute('aria-label', p.friend ? `Убрать ${p.nick} из друзей` : `Добавить ${p.nick} в друзья`);
  star.addEventListener('click', async () => {
    const add = star.getAttribute('aria-pressed') !== 'true';
    try {
      await api.setFriend(p.nick, add);
      star.textContent = add ? '★' : '☆';
      star.setAttribute('aria-pressed', String(add));
      star.setAttribute('aria-label', add ? `Убрать ${p.nick} из друзей` : `Добавить ${p.nick} в друзья`);
    } catch (err) {
      el.invStatus.textContent = (err as Error).message;
    }
  });
  const send = button('Пригласить', 'btn btn--sm');
  send.addEventListener('click', async () => {
    if (!invite) return;
    send.disabled = true;
    try {
      await api.challenge(invite.timeline, invite.durationMs, invite.exercise, p.nick);
      send.textContent = 'Отправлено';
    } catch (err) {
      send.disabled = false;
      el.invStatus.textContent = (err as Error).message;
    }
  });
  li.append(star, send);
  return li;
}

// ——— Мелкие DOM-помощники ———
function text<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, value: string) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  node.textContent = value;
  return node;
}

function button(label: string, className: string): HTMLButtonElement {
  const b = text('button', className, label);
  b.type = 'button';
  return b;
}

function field(label: string, type: string, autocomplete: string) {
  const l = text('label', 'field', label);
  const input = document.createElement('input');
  input.type = type;
  input.setAttribute('autocomplete', autocomplete);
  l.append(input);
  return { label: l, input };
}

function row(name: string, note: string): HTMLLIElement {
  const li = text('li', 'person', '');
  const who = text('span', 'person__who', '');
  who.append(text('span', 'person__nick', name));
  if (note) who.append(text('span', 'person__note', note));
  li.append(who);
  return li;
}
