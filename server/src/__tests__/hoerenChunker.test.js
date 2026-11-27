import test from 'node:test';
import assert from 'node:assert/strict';

const { removeHeader, chunkByPunctuation, removeFillerChunk, mergeShortChunks } = await import('../hoerenChunker.js');

test('removeHeader strips a spoken exercise-number announcement before the real content', () => {
  const words = [
    { word: 'B.', start: 0.7, end: 1.92 },
    { word: 'Aufgabe', start: 1.92, end: 2.54 },
    { word: '3,', start: 2.54, end: 4.06 },
    { word: '4', start: 4.06, end: 4.34 },
    { word: 'und', start: 4.34, end: 5.18 },
    { word: '6.', start: 5.18, end: 6.42 },
    { word: 'Puh,', start: 9.08, end: 9.4 },
    { word: 'das', start: 9.4, end: 10.08 },
  ];
  const body = removeHeader(words);
  assert.equal(body[0].word, 'Puh,');
  assert.equal(body.length, 2);
});

test('removeHeader leaves a transcript with no header untouched', () => {
  const words = [
    { word: 'Hallo', start: 0, end: 0.3 },
    { word: 'Welt.', start: 0.3, end: 0.6 },
  ];
  assert.deepEqual(removeHeader(words), words);
});

test('chunkByPunctuation splits on ,.?! - not just ,.', () => {
  const words = ['Lust?', 'Bei', 'Netflix', 'gibt', 'es', 'schon,'].map((w, i) => ({
    word: w,
    start: i,
    end: i + 0.5,
  }));
  const chunks = chunkByPunctuation(words);
  assert.deepEqual(
    chunks.map((c) => c.text),
    ['Lust?', 'Bei Netflix gibt es schon,']
  );
});

test("removeFillerChunk doesn't drop the real first word just because it follows the header's silence", () => {
  // "Puh," comma-terminates its own punctuation chunk and runs straight
  // into the next one with zero gap - exactly the false-positive case
  // this guards against. Zero gapAfter means the guard leaves both
  // chunks untouched (merging them together is mergeShortChunks' job).
  const chunks = [
    { start: 9.08, end: 9.4, text: 'Puh,' },
    { start: 9.4, end: 13.86, text: 'das war ein langer Tag. Endlich Feierabend.' },
  ];
  assert.deepEqual(removeFillerChunk(chunks), chunks);
});

test('removeFillerChunk drops a genuine filler phrase (real gap before AND after it)', () => {
  const chunks = [
    { start: 5.0, end: 5.6, text: 'So,' },
    { start: 6.1, end: 9.0, text: 'jetzt geht es los.' },
  ];
  assert.deepEqual(removeFillerChunk(chunks), [{ start: 5.0, end: 9.0, text: 'jetzt geht es los.' }]);
});

test('mergeShortChunks merges below the threshold but never past the hard cap', () => {
  const chunks = [
    { start: 0, end: 1, text: 'Ja.' }, // 1s
    { start: 1, end: 2, text: 'Okay.' }, // 1s
    { start: 2, end: 8, text: 'Ein sehr langer Satz hier.' }, // 6s
  ];
  const merged = mergeShortChunks(chunks, { mergeBelow: 3, hardCap: 6 });
  // "Ja." (1s) + "Okay." would be 2s, still < 3, but merging the long 6s
  // chunk in too would be 8s > hardCap, so it stops there instead.
  assert.deepEqual(
    merged.map((c) => c.text),
    ['Ja. Okay.', 'Ein sehr langer Satz hier.']
  );
});
