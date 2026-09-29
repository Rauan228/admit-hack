// E-25: вызовы друзьям на странице дуэли. «Побей мой результат»: после боя — «Вызвать друга»
// (ссылкой в мессенджер или игроку из друзей / общего списка), у адресата — «Вызовы тебе» и карточка
// вызова по ссылке. Бой идёт против записи повторов вызова; ответ уходит автору.
// Все имена — только через textContent: ники и имена гостей приходят от других людей.

import { ApiError, api, challengeUrl, type Challenge, type Me, type Player } from './api';

export interface RecordedOpponent {
  challengeId: string;
  name: string;
  reps: number;
  durationMs: number;
  timeline: number[];
}

interface Hooks {
  /** Принять вызов: бой против записи. */
  accept(opp: RecordedOpponent): void;
  /** Вошёл или вышел (онлайн-дуэли нужно переподключиться с новой cookie). */
  accountChanged?(): void;
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
  invBody: $<HTMLDivElement>('inv-body'),
  invLogin: $<HTMLDivElement>('inv-login'),
  invShare: $<HTMLButtonElement>('inv-share'),
  invLink: $<HTMLInputElement>('inv-link'),
  invStatus: $<HTMLParagraphElement>('inv-status'),
  tabFriends: $<HTMLButtonElement>('tab-friends'),
  tabAll: $<HTMLButtonElement>('tab-all'),
  search: $<HTMLInputElement>('inv-search'),
  list: $<HTMLUListElement>('inv-list'),
};

let hooks: Hooks;
let me: Me | null = null;
/** API доступен (на зеркалах без сервера — нет). */
let online = true;
let guestName = '';
let invite: { timeline: number[]; durationMs: number; linkId: string | null; tab: 'friends' | 'all' } | null =
  null;

export async function initSocial(h: Hooks): Promise<void> {
  hooks = h;
  try {
    me = await api.me();
  } catch {
    online = false;
  }
  renderAccount();
  void refreshInbox();
  void showLinkChallenge();
  window.addEventListener('hashchange', () => void showLinkChallenge());
  setInterval(() => {
    if (me && el.app.dataset.screen === 'intro' && document.visibilityState === 'visible')
      void refreshInbox();
  }, INBOX_EVERY_MS);

  el.invShare.addEventListener('click', () => void shareLink());
  el.tabFriends.addEventListener('click', () => void showTab('friends'));
  el.tabAll.addEventListener('click', () => void showTab('all'));
  let debounce = 0;
  el.search.addEventListener('input', () => {
    clearTimeout(debounce);
    debounce = window.setTimeout(() => void showTab('all'), 250);
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
    const p = text('p', 'account__note', 'Ты — ');
    p.append(text('b', '', me.nick));
    const out = button('Выйти', 'btn btn--link');
    out.addEventListener('click', async () => {
      await api.logout().catch(() => undefined);
      me = null;
      hooks.accountChanged?.();
      renderAccount();
      el.inbox.replaceChildren();
      void showLinkChallenge();
    });
    el.account.append(p, out);
    return;
  }
  const p = text('p', 'account__note', 'Войди, чтобы звать друзей и видеть вызовы.');
  const open = button('Войти', 'btn btn--link');
  open.addEventListener('click', () => {
    open.remove();
    el.account.append(loginForm(onSignedIn));
  });
  el.account.append(p, open);
}

function onSignedIn(user: Me): void {
  me = user;
  hooks.accountChanged?.();
  renderAccount();
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
  const toggle = button('Нет аккаунта? Регистрация', 'btn btn--link');
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
  const answers = data.outgoing.flatMap((c) => c.answers.map((a) => ({ ...a, mine: c.reps }))).slice(-3);
  if (!waiting.length && !answers.length) return;
  if (waiting.length) {
    el.inbox.append(text('h2', 'inbox__title', 'Вызовы тебе'));
    const ul = document.createElement('ul');
    ul.className = 'people';
    for (const c of waiting.slice(0, 5)) {
      const li = row(c.from, `${c.reps} за ${Math.round(c.durationMs / 1000)} с`);
      const go = button('Принять', 'btn btn--small btn--primary');
      go.addEventListener('click', () => void acceptById(c.id, go));
      li.append(go);
      ul.append(li);
    }
    el.inbox.append(ul);
  }
  if (answers.length) {
    el.inbox.append(text('h2', 'inbox__title', 'Ответы на твои вызовы'));
    const ul = document.createElement('ul');
    ul.className = 'people';
    for (const a of answers.reverse()) ul.append(row(a.name, `${a.reps} против твоих ${a.mine}`));
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
    el.card.append(text('p', 'challenge__text', 'Вызовы открываются на основном сайте.'));
    return;
  }
  let c: Challenge;
  try {
    c = await api.getChallenge(id);
  } catch (err) {
    el.card.append(text('p', 'challenge__text', (err as Error).message));
    return;
  }
  const head = text('p', 'challenge__from', '');
  head.append(text('b', '', c.from), c.mine ? ' — это твой вызов' : ' вызывает тебя');
  const reps = text('p', 'challenge__reps', `${c.reps}`);
  reps.append(text('span', '', ` за ${Math.round(c.durationMs / 1000)} с — сделаешь больше?`));
  el.card.append(head, reps);

  if (c.mine) {
    const list = c.answers.length
      ? c.answers.map((a) => `${a.name} — ${a.reps}`).join(', ')
      : 'Пока никто не ответил.';
    el.card.append(text('p', 'challenge__text', list));
    return;
  }
  if (c.to && !c.forMe) {
    el.card.append(text('p', 'challenge__text', `Этот вызов для ${c.to}. Если это ты — войди.`));
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
  const go = button('Принять вызов', 'btn btn--primary');
  go.addEventListener('click', () => accept(c));
  el.card.append(go);
}

/** Ответ на вызов после боя; возвращает строку для экрана итогов. */
export async function sendAnswer(opp: RecordedOpponent, timeline: number[]): Promise<string> {
  try {
    await api.answer(opp.challengeId, timeline, me ? undefined : guestName || undefined);
    void refreshInbox();
    return `Ответ отправлен — ${opp.name} увидит твой результат.`;
  } catch (err) {
    if (err instanceof ApiError && err.status === 409) return 'Ответ уже был — этот бой шёл без зачёта.';
    return (err as Error).message;
  }
}

// ——— Окно «Вызвать друга» ———
export function openInvite(timeline: number[], durationMs: number, suggest?: string): void {
  invite = { timeline, durationMs, linkId: null, tab: 'friends' };
  el.invReps.textContent = String(timeline.length);
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
  void showTab(suggest ? 'all' : 'friends');
}

async function shareLink(): Promise<void> {
  if (!invite) return;
  el.invShare.disabled = true;
  try {
    invite.linkId ??= await api.challenge(invite.timeline, invite.durationMs);
    const url = challengeUrl(invite.linkId);
    el.invLink.value = url;
    el.invLink.hidden = false;
    const text = `Я сделал ${invite.timeline.length} отжиманий за минуту в FORMA. Сможешь больше?`;
    if (navigator.share) {
      await navigator.share({ title: 'Дуэль на отжиманиях', text, url }).catch(() => undefined);
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

async function showTab(tab: 'friends' | 'all'): Promise<void> {
  if (!invite) return;
  invite.tab = tab;
  el.tabFriends.setAttribute('aria-selected', String(tab === 'friends'));
  el.tabAll.setAttribute('aria-selected', String(tab === 'all'));
  el.search.hidden = tab !== 'all';
  let people: Player[];
  try {
    people =
      tab === 'friends'
        ? (await api.friends()).map((f) => ({ nick: f.nick, friend: true }))
        : await api.players(el.search.value.trim());
  } catch (err) {
    el.list.replaceChildren(text('li', 'people__empty', (err as Error).message));
    return;
  }
  if (invite.tab !== tab) return; // пока ждали ответ, переключили вкладку
  el.list.replaceChildren();
  if (!people.length) {
    el.list.append(
      text(
        'li',
        'people__empty',
        tab === 'friends'
          ? 'Друзей пока нет — найди игрока во вкладке «Все игроки» и отметь звёздочкой.'
          : 'Никого не нашли.',
      ),
    );
    return;
  }
  for (const p of people) el.list.append(personRow(p));
}

function personRow(p: Player): HTMLLIElement {
  const li = row(p.nick, '');
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
  const send = button('Пригласить', 'btn btn--small btn--primary');
  send.addEventListener('click', async () => {
    if (!invite) return;
    send.disabled = true;
    try {
      await api.challenge(invite.timeline, invite.durationMs, p.nick);
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
  li.append(text('span', 'person__nick', name));
  if (note) li.append(text('span', 'person__note', note));
  return li;
}
