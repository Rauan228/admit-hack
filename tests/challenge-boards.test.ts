import { describe, expect, it } from 'vitest';
import {
  CHALLENGE_EXERCISES,
  boardKind,
  challengeBoard,
  challengeExercise,
  isBoard,
  rate,
  validate,
} from '../src/shared/rating';

describe('челлендж 60 с на любом упражнении', () => {
  it('приседания — прежняя доска challenge, остальные — challenge:<упражнение>', () => {
    expect(challengeBoard('squat')).toBe('challenge');
    expect(challengeBoard('push_up')).toBe('challenge:push_up');
    expect(challengeExercise('challenge')).toBe('squat');
    expect(challengeExercise('challenge:boxing')).toBe('boxing');
    expect(challengeExercise('single:squat')).toBeNull();
  });

  it('планки в челлендже нет (она на время), дубликата приседаний тоже', () => {
    expect(CHALLENGE_EXERCISES).not.toContain('plank');
    expect(isBoard('challenge:plank')).toBe(false);
    expect(isBoard('challenge:squat')).toBe(false);
    expect(isBoard('challenge:nope')).toBe(false);
    for (const ex of CHALLENGE_EXERCISES) expect(isBoard(challengeBoard(ex))).toBe(true);
  });

  it('рейтинг и проверка — как у челленджа приседаний', () => {
    const r = {
      board: challengeBoard('jumping_jack'),
      reps: 40,
      cleanReps: 35,
      avgScore: 88,
      durationSec: 60,
    };
    expect(boardKind(r.board)).toBe('challenge');
    expect(rate(r)).toEqual({ rating: 35, tiebreak: 88 });
    expect(validate(r)).toBeNull();
    expect(validate({ ...r, durationSec: 90 })).toBe('Челлендж длится 60 секунд');
  });
});
