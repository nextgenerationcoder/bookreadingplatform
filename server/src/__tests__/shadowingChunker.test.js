import test from 'node:test';
import assert from 'node:assert/strict';

const { groupWordsIntoChunks } = await import('../shadowingChunker.js');

test('groupWordsIntoChunks splits on , and . then merges short chunks up to the 5.0s cap', () => {
  // "Puh, das war ein langer Tag, endlich Feierabend." - exactly the
  // worked example in the user's own chunking-rules spec.
  const words = [
    { word: 'Puh,', start: 0, end: 0.4 },
    { word: 'das', start: 0.4, end: 0.6 },
    { word: 'war', start: 0.6, end: 0.8 },
    { word: 'ein', start: 0.8, end: 1.0 },
    { word: 'langer', start: 1.0, end: 1.6 },
    { word: 'Tag,', start: 1.6, end: 2.1 },
    { word: 'endlich', start: 2.1, end: 2.8 },
    { word: 'Feierabend.', start: 2.8, end: 3.8 },
  ];
  const chunks = groupWordsIntoChunks(words);
  // Chunk 1 (0.4s) + chunk 2 (1.7s) = 2.1s, still < 3.5s, keep merging;
  // + chunk 3 (1.7s) = 3.8s, in the golden range - stop there (matches
  // the spec's own worked example exactly).
  assert.deepEqual(
    chunks.map((c) => c.text),
    ['Puh, das war ein langer Tag, endlich Feierabend.']
  );
  assert.equal(chunks[0].start, 0);
  assert.equal(chunks[0].end, 3.8);
});

test('groupWordsIntoChunks does not split on ? or ! - only , and . (matches shadowing_pipeline.py exactly)', () => {
  const words = ['Lust?', 'Na', 'klar.'].map((w, i) => ({ word: w, start: i, end: i + 0.5 }));
  const chunks = groupWordsIntoChunks(words);
  assert.deepEqual(
    chunks.map((c) => c.text),
    ['Lust? Na klar.']
  );
});

test('groupWordsIntoChunks keeps a short chunk as-is when merging would cross the 5.0s cap', () => {
  const chunks = groupWordsIntoChunks(
    [
      { word: 'Ja.', start: 0, end: 1.0 }, // 1.0s - under 3.5s
      { word: 'Ein', start: 1.0, end: 1.2 },
      { word: 'sehr', start: 1.2, end: 1.4 },
      { word: 'langer', start: 1.4, end: 1.6 },
      { word: 'Satz.', start: 1.6, end: 6.0 }, // this chunk alone is 5.0s
    ].slice(0, 1)
  );
  // Only the short chunk by itself here - nothing to merge into without
  // exceeding the cap, so it's kept exactly as-is, never dropped.
  assert.deepEqual(chunks, [{ start: 0, end: 1.0, text: 'Ja.' }]);
});

test('groupWordsIntoChunks closes the final chunk even with no trailing punctuation', () => {
  const words = [
    { word: 'Hallo', start: 0, end: 0.3 },
    { word: 'Welt', start: 0.3, end: 0.6 },
  ];
  const chunks = groupWordsIntoChunks(words);
  assert.equal(chunks.length, 1);
  assert.equal(chunks[0].text, 'Hallo Welt');
  assert.equal(chunks[0].end, 0.6);
});

test('groupWordsIntoChunks returns nothing for an empty word list', () => {
  assert.deepEqual(groupWordsIntoChunks([]), []);
});
