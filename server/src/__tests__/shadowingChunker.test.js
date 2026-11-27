import test from 'node:test';
import assert from 'node:assert/strict';

const { groupWordsIntoChunks } = await import('../shadowingChunker.js');

test('groupWordsIntoChunks breaks at a natural pause before hitting maxWords', () => {
  const words = [
    { word: 'Das', start: 0, end: 0.3 },
    { word: 'Thema', start: 0.3, end: 0.6 },
    { word: 'ist', start: 1.2, end: 1.5 }, // 0.6s gap - a real pause
    { word: 'gut.', start: 1.5, end: 1.8 },
  ];
  const chunks = groupWordsIntoChunks(words, { maxWords: 3, pauseThreshold: 0.4 });
  assert.deepEqual(
    chunks.map((c) => c.text),
    ['Das Thema', 'ist gut.']
  );
  assert.equal(chunks[0].start, 0);
  assert.equal(chunks[0].end, 0.6);
});

test('groupWordsIntoChunks caps a long pause-free run at maxWords', () => {
  const words = ['A', 'B', 'C', 'D', 'E'].map((w, i) => ({ word: w, start: i * 0.2, end: i * 0.2 + 0.15 }));
  const chunks = groupWordsIntoChunks(words, { maxWords: 3, pauseThreshold: 0.4 });
  assert.deepEqual(
    chunks.map((c) => c.text),
    ['A B C', 'D E']
  );
});

test('groupWordsIntoChunks closes the final chunk even with no trailing pause', () => {
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
