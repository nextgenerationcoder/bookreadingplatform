import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyWordsUsed } from '../game/vocab.js';

const TARGETS = [
  { german: 'gehen', persian: 'رفتن' },
  { german: 'Termin', persian: 'قرار ملاقات' },
  { german: 'schnell', persian: 'سریع' },
];

test('verifyWordsUsed accepts an exact match', () => {
  const result = verifyWordsUsed(['gehen'], TARGETS, 'Ich muss jetzt gehen, es ist spät.');
  assert.deepEqual(result, [{ german: 'gehen', persian: 'رفتن' }]);
});

test('verifyWordsUsed accepts a loosely inflected form (stem match)', () => {
  const result = verifyWordsUsed(['gehen'], TARGETS, 'Er geht jeden Tag ins Büro.');
  assert.deepEqual(result, [{ german: 'gehen', persian: 'رفتن' }]);
});

test('verifyWordsUsed is case-insensitive on both the claim and the text', () => {
  const result = verifyWordsUsed(['TERMIN'], TARGETS, 'ich habe einen termin um drei uhr.');
  assert.deepEqual(result, [{ german: 'Termin', persian: 'قرار ملاقات' }]);
});

test('verifyWordsUsed rejects a word the AI was never actually offered as a target', () => {
  const result = verifyWordsUsed(['Kaffee'], TARGETS, 'Ich trinke gerne Kaffee am Morgen.');
  assert.deepEqual(result, []);
});

test('verifyWordsUsed rejects a claimed word that does not actually appear in the text', () => {
  const result = verifyWordsUsed(['schnell'], TARGETS, 'Das Meeting war sehr lang und langweilig.');
  assert.deepEqual(result, []);
});

test('verifyWordsUsed handles multiple claims, keeping only the verified ones', () => {
  const result = verifyWordsUsed(['gehen', 'schnell', 'Kaffee'], TARGETS, 'Sie geht schnell zum Meeting.');
  assert.deepEqual(result, [
    { german: 'gehen', persian: 'رفتن' },
    { german: 'schnell', persian: 'سریع' },
  ]);
});

test('verifyWordsUsed returns an empty array for no claims or malformed input', () => {
  assert.deepEqual(verifyWordsUsed([], TARGETS, 'Irgendein Text.'), []);
  assert.deepEqual(verifyWordsUsed(undefined, TARGETS, 'Irgendein Text.'), []);
  assert.deepEqual(verifyWordsUsed([42, null, 'gehen'], TARGETS, 'Er geht los.'), [{ german: 'gehen', persian: 'رفتن' }]);
});
