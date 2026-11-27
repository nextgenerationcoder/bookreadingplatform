// Groups a flat list of ASR word-timestamps (see asr.js's
// transcribeWithWordTimestamps) into small listen-then-repeat chunks for
// shadowing practice. A chunk breaks either at a natural pause in the
// speech (a real gap between two words' timestamps, not an arbitrary
// fixed duration) or after `maxWords`, whichever comes first - so a chunk
// never cuts a word in half, and a long clause without a pause still gets
// split to a manageable size instead of becoming one giant chunk.
export function groupWordsIntoChunks(words, { maxWords = 3, pauseThreshold = 0.4 } = {}) {
  const chunks = [];
  let current = [];

  for (let i = 0; i < words.length; i++) {
    current.push(words[i]);
    const next = words[i + 1];
    const gap = next ? next.start - words[i].end : Infinity;
    const shouldBreak = current.length >= maxWords || gap >= pauseThreshold || !next;
    if (shouldBreak) {
      chunks.push({
        start: current[0].start,
        end: current[current.length - 1].end,
        text: current.map((w) => w.word).join(' ').trim(),
      });
      current = [];
    }
  }

  return chunks;
}
