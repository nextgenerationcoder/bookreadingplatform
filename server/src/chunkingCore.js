// Shared "split on punctuation, then merge short chunks together" pipeline
// used by both shadowingChunker.js (tiny phrase-sized chunks for a
// listen-then-repeat drill) and hoerenChunker.js (clause-sized chunks for
// listening-along navigation) - same algorithm, ported from the user's own
// shadowing_pipeline.py, just a different punctuation regex and different
// merge thresholds for each caller.

// Splits `words` into segments at any word matching `punctuationRegex` -
// the natural "complete clause" boundary a listener's ear actually wants,
// rather than an arbitrary word count or duration.
export function chunkByPunctuation(words, punctuationRegex = /[,.]/) {
  if (!words.length) return [];
  const chunks = [];
  let segStart = words[0].start;
  let segWords = [];

  for (const w of words) {
    segWords.push(w);
    if (punctuationRegex.test(w.word)) {
      chunks.push({ start: segStart, end: w.end, text: segWords.map((x) => x.word).join(' ') });
      segStart = w.end;
      segWords = [];
    }
  }
  if (segWords.length) {
    chunks.push({ start: segStart, end: segWords[segWords.length - 1].end, text: segWords.map((x) => x.word).join(' ') });
  }
  return chunks;
}

// Merges any chunk shorter than `mergeBelow` into its neighbor, repeating
// until every chunk is either long enough or merging further would cross
// `hardCap` - punctuation gives natural phrase boundaries, but a lot of
// short interjections ("Ja." "Okay." "Hallo.") would otherwise flash by (or,
// for shadowing, be over before a learner can even start repeating) too
// fast to be useful on their own. A chunk that can't be merged without
// busting the cap is kept exactly as it is, never dropped.
export function mergeShortChunks(chunks, { mergeBelow = 3.5, hardCap = 5.0 } = {}) {
  const merged = [];
  let i = 0;
  while (i < chunks.length) {
    let cur = { ...chunks[i] };
    let curDur = cur.end - cur.start;

    while (curDur < mergeBelow && i + 1 < chunks.length) {
      const candidateDur = chunks[i + 1].end - cur.start;
      if (candidateDur > hardCap) break;
      cur = { start: cur.start, end: chunks[i + 1].end, text: `${cur.text} ${chunks[i + 1].text}` };
      curDur = candidateDur;
      i += 1;
    }
    merged.push(cur);
    i += 1;
  }
  return merged;
}
