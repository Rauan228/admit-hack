// U-11: голос тренера (Web Speech API, ru-RU). Правила очереди:
// - подсказка техники перебивает всё остальное (она важнее счёта);
// - счёт и реплики не перебивают подсказку, а просто пропускаются, если голос занят;
// - одна и та же фраза не чаще раза в 3 с (движок и так держит кулдаун 4 с на подсказку).

import { loadMuted } from '../store/progress';

type Priority = 'hint' | 'count' | 'info';

let muted = loadMuted();
let voice: SpeechSynthesisVoice | null = null;
let speakingPriority: Priority | null = null;
const lastSaid = new Map<string, number>();

const synth: SpeechSynthesis | null =
  typeof window !== 'undefined' && 'speechSynthesis' in window ? window.speechSynthesis : null;

function pickVoice(): void {
  if (!synth) return;
  const voices = synth.getVoices().filter((v) => v.lang.toLowerCase().startsWith('ru'));
  // Предпочитаем «естественные» облачные голоса: они звучат заметно лучше системных.
  voice =
    voices.find((v) => /natural|online|google/i.test(v.name)) ??
    voices.find((v) => v.localService) ??
    voices[0] ??
    null;
}

if (synth) {
  pickVoice();
  synth.addEventListener?.('voiceschanged', pickVoice);
}

export function setVoiceMuted(value: boolean): void {
  muted = value;
  if (value) synth?.cancel();
}

export function hasVoice(): boolean {
  return !!synth;
}

export function say(text: string, priority: Priority = 'info'): void {
  if (!synth || muted || !text) return;
  const now = performance.now();
  if (now - (lastSaid.get(text) ?? -Infinity) < 3000) return;

  if (synth.speaking || synth.pending) {
    if (priority !== 'hint') return; // не перебиваем
    synth.cancel();
  }
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'ru-RU';
  if (voice) u.voice = voice;
  u.rate = priority === 'count' ? 1.15 : 1.05;
  u.pitch = 1;
  u.volume = 1;
  speakingPriority = priority;
  u.onend = () => {
    if (speakingPriority === priority) speakingPriority = null;
  };
  lastSaid.set(text, now);
  synth.speak(u);
}

export function stopVoice(): void {
  synth?.cancel();
  speakingPriority = null;
}

/** Первое произнесение должно случиться внутри жеста пользователя (Safari), иначе голос молчит. */
export function unlockVoice(): void {
  if (!synth) return;
  const u = new SpeechSynthesisUtterance(' ');
  u.volume = 0;
  synth.speak(u);
}

const NUMBERS = [
  'ноль',
  'раз',
  'два',
  'три',
  'четыре',
  'пять',
  'шесть',
  'семь',
  'восемь',
  'девять',
  'десять',
  'одиннадцать',
  'двенадцать',
  'тринадцать',
  'четырнадцать',
  'пятнадцать',
  'шестнадцать',
  'семнадцать',
  'восемнадцать',
  'девятнадцать',
  'двадцать',
];

export function numberWord(n: number): string {
  return NUMBERS[n] ?? String(n);
}
