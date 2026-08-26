import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultLearnerState } from '../learnerState.js';
import { applyLessonStateUpdate } from '../stateTransition.js';

const lesson = {
  stateUpdateRules: {
    seededChunksToAdd: ['Deshalb passt das gut.'],
    chunksToAdd: ['Darf ich kurz nachdenken?'],
    knownFormsToAdd: [{ slot: 'F01', pattern: '<Kernaussage>. Bei <Projekt> habe ich <Handlung>.' }],
    movesToSupported: ['M01', 'M02', 'M04'],
    stableFramesToAdd: [],
  },
};

test('seeding happens even without an exit-check attempt', () => {
  const state = applyLessonStateUpdate(defaultLearnerState(), lesson, { exitCheckAttempted: false });
  assert.deepEqual(state.seededButUnanalyzed, ['Deshalb passt das gut.']);
  assert.deepEqual(state.knownChunks, []);
  assert.deepEqual(state.knownMoves, []);
});

test('nothing is promoted just from clicking through the lesson (no exit check)', () => {
  const state = applyLessonStateUpdate(defaultLearnerState(), lesson, { exitCheckAttempted: false });
  assert.deepEqual(state.knownMoves, []);
  assert.deepEqual(state.knownForms, {});
  assert.deepEqual(state.stableFrames, []);
});

test('moves promote to "supported", never "installed", after a real exit-check attempt', () => {
  const state = applyLessonStateUpdate(defaultLearnerState(), lesson, { exitCheckAttempted: true });
  assert.deepEqual(
    state.knownMoves.map((m) => m.status),
    ['supported', 'supported', 'supported']
  );
  assert.ok(!state.knownMoves.some((m) => m.status === 'installed'));
});

test('a frame is not auto-promoted to stable just because the lesson finished', () => {
  const state = applyLessonStateUpdate(defaultLearnerState(), lesson, { exitCheckAttempted: true });
  assert.deepEqual(state.stableFrames, []);
  assert.deepEqual(state.knownForms.F01, ['<Kernaussage>. Bei <Projekt> habe ich <Handlung>.']);
});

test('re-applying the same lesson does not duplicate entries', () => {
  let state = defaultLearnerState();
  state = applyLessonStateUpdate(state, lesson, { exitCheckAttempted: true });
  state = applyLessonStateUpdate(state, lesson, { exitCheckAttempted: true });
  assert.equal(state.knownChunks.length, 1);
  assert.equal(state.knownMoves.length, 3);
  assert.equal(state.seededButUnanalyzed.length, 1);
});

test('an already-installed move is not downgraded back to supported', () => {
  const installed = { ...defaultLearnerState(), knownMoves: [{ id: 'M01', status: 'installed' }] };
  const state = applyLessonStateUpdate(installed, lesson, { exitCheckAttempted: true });
  const m01 = state.knownMoves.find((m) => m.id === 'M01');
  assert.equal(m01.status, 'installed');
});
