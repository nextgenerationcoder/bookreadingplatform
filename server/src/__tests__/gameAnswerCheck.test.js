import test from 'node:test';
import assert from 'node:assert/strict';
import { checkExerciseAnswer, checkAllExercises } from '../game/answerCheck.js';

test('checkExerciseAnswer: translate matches, ignoring case/whitespace/trailing punctuation', () => {
  const exercise = { type: 'translate', expectedAnswer: 'Ich brauche es.' };
  assert.equal(checkExerciseAnswer(exercise, 'ich brauche es'), true);
  assert.equal(checkExerciseAnswer(exercise, '  Ich   brauche es.  '), true);
  assert.equal(checkExerciseAnswer(exercise, 'Ich brauche es nicht'), false);
});

test('checkExerciseAnswer: scramble uses the same normalized comparison as translate', () => {
  const exercise = { type: 'scramble', expectedAnswer: 'Ich habe ein Buch' };
  assert.equal(checkExerciseAnswer(exercise, 'Ich habe ein Buch'), true);
  assert.equal(checkExerciseAnswer(exercise, 'Habe ich ein Buch'), false);
});

test('checkExerciseAnswer: translate/scramble reject a non-string submission', () => {
  const exercise = { type: 'translate', expectedAnswer: 'Ich brauche es.' };
  assert.equal(checkExerciseAnswer(exercise, [{ german: 'x', persian: 'y' }]), false);
  assert.equal(checkExerciseAnswer(exercise, null), false);
});

test('checkExerciseAnswer: matching succeeds when every pair is present, any order', () => {
  const exercise = {
    type: 'matching',
    pairs: [
      { german: 'brauchen', persian: 'نیاز داشتن' },
      { german: 'warum', persian: 'چرا' },
    ],
  };
  assert.equal(
    checkExerciseAnswer(exercise, [
      { german: 'warum', persian: 'چرا' },
      { german: 'brauchen', persian: 'نیاز داشتن' },
    ]),
    true
  );
});

test('checkExerciseAnswer: matching fails on a wrong pairing or missing/extra pairs', () => {
  const exercise = {
    type: 'matching',
    pairs: [
      { german: 'brauchen', persian: 'نیاز داشتن' },
      { german: 'warum', persian: 'چرا' },
    ],
  };
  assert.equal(
    checkExerciseAnswer(exercise, [
      { german: 'brauchen', persian: 'چرا' }, // wrong pairing
      { german: 'warum', persian: 'نیاز داشتن' },
    ]),
    false
  );
  assert.equal(checkExerciseAnswer(exercise, [{ german: 'brauchen', persian: 'نیاز داشتن' }]), false); // missing one
});

test('checkAllExercises: "easy" (1 exercise) succeeds only if that one is correct', () => {
  const exercises = [{ type: 'translate', expectedAnswer: 'Guten Morgen' }];
  assert.equal(checkAllExercises(exercises, ['Guten Morgen']), true);
  assert.equal(checkAllExercises(exercises, ['Guten Tag']), false);
});

test('checkAllExercises: "hard" (2 exercises) requires BOTH correct, not just one', () => {
  const exercises = [
    { type: 'translate', expectedAnswer: 'Guten Morgen' },
    { type: 'translate', expectedAnswer: 'Auf Wiedersehen' },
  ];
  assert.equal(checkAllExercises(exercises, ['Guten Morgen', 'Auf Wiedersehen']), true);
  assert.equal(checkAllExercises(exercises, ['Guten Morgen', 'Tschüss']), false, 'one wrong answer fails the whole check');
  assert.equal(checkAllExercises(exercises, ['Guten Morgen']), false, 'a missing answer fails the whole check');
});
