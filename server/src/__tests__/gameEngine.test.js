import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createInitialState,
  applyChoice,
  isFired,
  CHEF_MEINUNG_START,
  SYMPATHIE_START,
  BECKER_SYMPATHIE_START,
  LENA_FLIRT_START,
  XP_PER_FRECH,
  CHEF_PROFESSIONAL_MIN,
  CHEF_PROFESSIONAL_MAX,
  CHEF_ANNOYED_MULT_MIN,
  CHEF_ANNOYED_MULT_MAX,
  CHEF_IMPRESSED_MULT,
  CHEEKY_SYMPATHIE_MIN,
  CHEEKY_SYMPATHIE_MAX,
  PROFESSIONAL_SYMPATHIE_MIN,
  FLIRT_MIN,
  FLIRT_MAX,
  CHECK_SUCCESS_XP_MULT,
  CHECK_FAILURE_CHEF_MULT,
} from '../game/engine.js';

// A seeded fake rng: returns a fixed sequence of [0,1) values, cycling if
// exhausted - lets a test pin down exactly which branch (e.g. "impressed"
// vs "annoyed") and exactly which randInt result a call produces, instead
// of asserting only a range.
function fakeRng(sequence) {
  let i = 0;
  return () => sequence[i++ % sequence.length];
}

const EMPTY_TAGS = { frech: 0, chef_sieht: false, betrifft: null, flirt: false };

test('createInitialState returns the documented starting values', () => {
  const state = createInitialState();
  assert.equal(state.xp, 0);
  assert.equal(state.chef_meinung, CHEF_MEINUNG_START);
  assert.equal(state.npcs.jonas.sympathie, SYMPATHIE_START);
  assert.equal(state.npcs.lena.sympathie, SYMPATHIE_START);
  assert.equal(state.npcs.lena.flirt, LENA_FLIRT_START);
  assert.equal(state.npcs.becker.sympathie, BECKER_SYMPATHIE_START);
});

test('applyChoice with all-empty tags changes nothing and reports no effects', () => {
  const state = createInitialState();
  const { state: next, effects } = applyChoice(state, EMPTY_TAGS, fakeRng([0]));
  assert.deepEqual(next, state);
  assert.deepEqual(effects, []);
});

test('applyChoice never mutates the input state', () => {
  const state = createInitialState();
  const frozenCopy = JSON.parse(JSON.stringify(state));
  applyChoice(state, { frech: 3, chef_sieht: true, betrifft: 'jonas', flirt: true }, fakeRng([0, 0, 0, 0]));
  assert.deepEqual(state, frozenCopy);
});

test('frech > 0 adds frech * XP_PER_FRECH to xp, uncapped', () => {
  const state = createInitialState();
  const { state: next, effects } = applyChoice(state, { ...EMPTY_TAGS, frech: 3 }, fakeRng([0]));
  assert.equal(next.xp, 3 * XP_PER_FRECH);
  assert.deepEqual(
    effects.find((e) => e.target === 'xp'),
    { target: 'xp', delta: 3 * XP_PER_FRECH, reason: 'frech' }
  );
});

test('chef_sieht with frech === 0 increases chef_meinung within the professional range', () => {
  const state = createInitialState();
  // rng() = 0 -> randInt(min,max) picks the minimum of the range.
  const { state: next, effects } = applyChoice(state, { ...EMPTY_TAGS, chef_sieht: true }, fakeRng([0]));
  assert.equal(next.chef_meinung, CHEF_MEINUNG_START + CHEF_PROFESSIONAL_MIN);
  assert.ok(next.chef_meinung <= CHEF_MEINUNG_START + CHEF_PROFESSIONAL_MAX);
  assert.deepEqual(
    effects.find((e) => e.target === 'chef_meinung'),
    { target: 'chef_meinung', delta: CHEF_PROFESSIONAL_MIN, reason: 'professional' }
  );
});

test('chef_sieht with frech > 0 usually annoys the boss (forced via rng >= impressed chance)', () => {
  const state = createInitialState();
  // First rng() call (>= CHEF_IMPRESSED_CHANCE) selects "annoyed" branch;
  // second rng() call (0) picks the minimum annoyed multiplier.
  const { state: next, effects } = applyChoice(state, { ...EMPTY_TAGS, frech: 2, chef_sieht: true }, fakeRng([0.99, 0]));
  const expectedDelta = -(2 * CHEF_ANNOYED_MULT_MIN);
  assert.equal(next.chef_meinung, CHEF_MEINUNG_START + expectedDelta);
  assert.deepEqual(
    effects.find((e) => e.target === 'chef_meinung'),
    { target: 'chef_meinung', delta: expectedDelta, reason: 'annoyed' }
  );
});

test('chef_sieht with frech > 0 can impress the boss instead (forced via rng < impressed chance)', () => {
  const state = createInitialState();
  const { state: next, effects } = applyChoice(state, { ...EMPTY_TAGS, frech: 2, chef_sieht: true }, fakeRng([0.01]));
  const expectedDelta = 2 * CHEF_IMPRESSED_MULT;
  assert.equal(next.chef_meinung, CHEF_MEINUNG_START + expectedDelta);
  assert.deepEqual(
    effects.find((e) => e.target === 'chef_meinung'),
    { target: 'chef_meinung', delta: expectedDelta, reason: 'impressed' }
  );
});

test('a cheeky action involving Jonas amuses him (sympathie goes up)', () => {
  const state = createInitialState();
  const { state: next } = applyChoice(state, { ...EMPTY_TAGS, frech: 1, betrifft: 'jonas' }, fakeRng([0]));
  assert.equal(next.npcs.jonas.sympathie, SYMPATHIE_START + CHEEKY_SYMPATHIE_MIN);
});

test('a cheeky action involving Becker annoys him (sympathie goes down)', () => {
  const state = createInitialState();
  const { state: next } = applyChoice(state, { ...EMPTY_TAGS, frech: 1, betrifft: 'becker' }, fakeRng([0]));
  assert.equal(next.npcs.becker.sympathie, BECKER_SYMPATHIE_START - CHEEKY_SYMPATHIE_MIN);
});

test('a professional (frech=0) action involving an NPC gives a small positive bump', () => {
  const state = createInitialState();
  const { state: next } = applyChoice(state, { ...EMPTY_TAGS, betrifft: 'becker' }, fakeRng([0]));
  assert.equal(next.npcs.becker.sympathie, BECKER_SYMPATHIE_START + PROFESSIONAL_SYMPATHIE_MIN);
});

test('betrifft "krueger" never touches npcs (she is not in the npcs map)', () => {
  const state = createInitialState();
  const { state: next, effects } = applyChoice(state, { ...EMPTY_TAGS, frech: 1, betrifft: 'krueger' }, fakeRng([0]));
  assert.deepEqual(next.npcs, state.npcs);
  assert.ok(!effects.some((e) => e.target.startsWith('npc:')));
});

test('flirt increases lena.flirt within the documented range', () => {
  const state = createInitialState();
  const { state: next, effects } = applyChoice(state, { ...EMPTY_TAGS, flirt: true }, fakeRng([0]));
  assert.equal(next.npcs.lena.flirt, LENA_FLIRT_START + FLIRT_MIN);
  const { state: next2 } = applyChoice(state, { ...EMPTY_TAGS, flirt: true }, fakeRng([0.999]));
  assert.equal(next2.npcs.lena.flirt, LENA_FLIRT_START + FLIRT_MAX);
  assert.deepEqual(
    effects.find((e) => e.target === 'npc:lena:flirt'),
    { target: 'npc:lena:flirt', delta: FLIRT_MIN, reason: 'flirt' }
  );
});

test('everything clamps to [0, 100] and never goes out of bounds', () => {
  let state = createInitialState();
  state = applyChoice(state, { ...EMPTY_TAGS, flirt: true }, fakeRng([0.999])).state;
  for (let i = 0; i < 20; i++) {
    state = applyChoice(state, { ...EMPTY_TAGS, flirt: true }, fakeRng([0.999])).state;
  }
  assert.equal(state.npcs.lena.flirt, 100);

  let becker = BECKER_SYMPATHIE_START;
  let s2 = createInitialState();
  for (let i = 0; i < 20; i++) {
    s2 = applyChoice(s2, { ...EMPTY_TAGS, frech: 3, betrifft: 'becker' }, fakeRng([0])).state;
  }
  assert.equal(s2.npcs.becker.sympathie, 0);
  assert.ok(becker >= 0); // sanity, not a real assertion on the loop var
});

test('isFired is true exactly when chef_meinung <= 0', () => {
  const state = createInitialState();
  assert.equal(isFired(state), false);
  assert.equal(isFired({ ...state, chef_meinung: 1 }), false);
  assert.equal(isFired({ ...state, chef_meinung: 0 }), true);
  assert.equal(isFired({ ...state, chef_meinung: -5 }), true);
});

test('repeated cheeky choices seen by the boss eventually get the player fired', () => {
  let state = createInitialState();
  let fired = false;
  for (let i = 0; i < 50 && !fired; i++) {
    const result = applyChoice(state, { frech: 3, chef_sieht: true, betrifft: null, flirt: false }, fakeRng([0.99, 0.999])); // force "annoyed" branch, max multiplier
    state = result.state;
    fired = isFired(state);
  }
  assert.equal(fired, true);
  assert.equal(state.chef_meinung, 0);
});

// --- Skill checks (checkResult param) ---------------------------------

test('checkResult "success" always impresses the boss, overriding the random annoyed/impressed roll', () => {
  const state = createInitialState();
  // rng() = 0.99 would normally force the "annoyed" branch (>= impressed
  // chance) - checkResult should override that entirely.
  const { state: next, effects } = applyChoice(state, { frech: 2, chef_sieht: true, betrifft: null, flirt: false }, fakeRng([0.99]), 'success');
  assert.ok(next.chef_meinung > CHEF_MEINUNG_START, 'chef_meinung should increase on a successful check, not decrease');
  const chefEffect = effects.find((e) => e.target === 'chef_meinung');
  assert.equal(chefEffect.reason, 'check-success');
  assert.ok(chefEffect.delta > 0);
});

test('checkResult "success" gives a bigger XP bonus than the same frech without a check', () => {
  const state = createInitialState();
  const withCheck = applyChoice(state, { frech: 2, chef_sieht: false, betrifft: null, flirt: false }, fakeRng([0]), 'success');
  const withoutCheck = applyChoice(state, { frech: 2, chef_sieht: false, betrifft: null, flirt: false }, fakeRng([0]), null);
  assert.equal(withCheck.state.xp, Math.round(2 * XP_PER_FRECH * CHECK_SUCCESS_XP_MULT));
  assert.ok(withCheck.state.xp > withoutCheck.state.xp);
});

test('checkResult "failure" always extra-annoys the boss and withholds the XP', () => {
  const state = createInitialState();
  // rng() = 0.01 would normally force "impressed" (< impressed chance) -
  // checkResult should override that entirely toward annoyed instead.
  const { state: next, effects } = applyChoice(state, { frech: 2, chef_sieht: true, betrifft: null, flirt: false }, fakeRng([0.01, 0]), 'failure');
  assert.ok(next.chef_meinung < CHEF_MEINUNG_START, 'chef_meinung should decrease on a failed check');
  const chefEffect = effects.find((e) => e.target === 'chef_meinung');
  assert.equal(chefEffect.reason, 'check-failure');
  assert.ok(chefEffect.delta < 0);
  assert.equal(next.xp, 0, 'no XP earned for a failed attempt');
  const xpEffect = effects.find((e) => e.target === 'xp');
  assert.equal(xpEffect.reason, 'frech-failure');
  assert.equal(xpEffect.delta, 0);
});

test('a failed check\'s boss penalty is worse than the same frech failing WITHOUT a check (worst case)', () => {
  const state = createInitialState();
  const failedCheck = applyChoice(state, { frech: 3, chef_sieht: true, betrifft: null, flirt: false }, fakeRng([0.99, 0.999]), 'failure');
  const normalAnnoyed = applyChoice(state, { frech: 3, chef_sieht: true, betrifft: null, flirt: false }, fakeRng([0.99, 0.999]), null);
  const failedDelta = failedCheck.effects.find((e) => e.target === 'chef_meinung').delta;
  const normalDelta = normalAnnoyed.effects.find((e) => e.target === 'chef_meinung').delta;
  assert.ok(Math.abs(failedDelta) > Math.abs(normalDelta));
  assert.equal(failedDelta, normalDelta * CHECK_FAILURE_CHEF_MULT);
});

test('checkResult is irrelevant when chef_sieht is false - no chef_meinung effect either way', () => {
  const state = createInitialState();
  const { effects: successEffects } = applyChoice(state, { frech: 2, chef_sieht: false, betrifft: null, flirt: false }, fakeRng([0]), 'success');
  const { effects: failureEffects } = applyChoice(state, { frech: 2, chef_sieht: false, betrifft: null, flirt: false }, fakeRng([0]), 'failure');
  assert.ok(!successEffects.some((e) => e.target === 'chef_meinung'));
  assert.ok(!failureEffects.some((e) => e.target === 'chef_meinung'));
});

test('checkResult null behaves identically to omitting it (backward compatible default)', () => {
  const state = createInitialState();
  const withNull = applyChoice(state, { frech: 1, chef_sieht: true, betrifft: 'jonas', flirt: false }, fakeRng([0.5, 0.5]), null);
  const withDefault = applyChoice(state, { frech: 1, chef_sieht: true, betrifft: 'jonas', flirt: false }, fakeRng([0.5, 0.5]));
  assert.deepEqual(withNull.state, withDefault.state);
});
