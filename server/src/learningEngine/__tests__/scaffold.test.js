import test from 'node:test';
import assert from 'node:assert/strict';
import { visibleAidsForScaffold } from '../scaffold.js';

test('S3 shows model, frame, and word bank', () => {
  assert.deepEqual(visibleAidsForScaffold('S3'), { showModel: true, showFrame: true, showWordBank: true });
});

test('S2 shows only the frame skeleton, no model and no word bank', () => {
  const aids = visibleAidsForScaffold('S2');
  assert.equal(aids.showFrame, true);
  assert.equal(aids.showModel, false);
  assert.equal(aids.showWordBank, false);
});

test('S1 hides model, frame, and word bank - cue only', () => {
  assert.deepEqual(visibleAidsForScaffold('S1'), { showModel: false, showFrame: false, showWordBank: false });
});

test('S0 hides everything', () => {
  assert.deepEqual(visibleAidsForScaffold('S0'), { showModel: false, showFrame: false, showWordBank: false });
});
