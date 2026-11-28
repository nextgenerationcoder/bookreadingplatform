import test from 'node:test';
import assert from 'node:assert/strict';

const { chunkByPunctuation, mergeShortChunks } = await import('../chunkingCore.js');

test('chunkByPunctuation defaults to splitting on , and . only', () => {
  const words = ['Lust?', 'Ja,', 'klar.'].map((w, i) => ({ word: w, start: i, end: i + 0.5 }));
  assert.deepEqual(
    chunkByPunctuation(words).map((c) => c.text),
    ['Lust? Ja,', 'klar.']
  );
});

test('chunkByPunctuation accepts a custom regex (e.g. Hören\'s own ,.?!)', () => {
  const words = ['Lust?', 'Ja,', 'klar.'].map((w, i) => ({ word: w, start: i, end: i + 0.5 }));
  assert.deepEqual(
    chunkByPunctuation(words, /[,.?!]/).map((c) => c.text),
    ['Lust?', 'Ja,', 'klar.']
  );
});

test('mergeShortChunks never crosses hardCap even if the result is still short', () => {
  const chunks = [
    { start: 0, end: 1, text: 'Ja.' },
    { start: 1, end: 7, text: 'Ein sehr langer Satz hier drin.' }, // 6s alone, already over hardCap
  ];
  const merged = mergeShortChunks(chunks, { mergeBelow: 3.5, hardCap: 5.0 });
  // Merging would make 7s (> 5.0 hardCap), so "Ja." stays on its own.
  assert.deepEqual(merged.map((c) => c.text), ['Ja.', 'Ein sehr langer Satz hier drin.']);
});
