// Chunking pipeline for Hören (listening) course pages - a port of the
// user's own Python prototype (shadowing_pipeline.py), adapted for live
// in-browser navigation instead of pre-rendering a new audio file with
// baked-in silence: we only need the CHUNK BOUNDARIES (for "next/previous
// chunk" seeking), not an actual re-encoded MP3.
//
// Different goal from shadowingChunker.js's groupWordsIntoChunks: that one
// makes tiny 2-3-word chunks for a listen-then-repeat drill. This one
// makes clause/sentence-sized chunks (targeting ~4s, never below the
// punctuation boundaries that make a chunk a complete thought) for
// listening-along navigation on a Hören page.

const HEADER_WORDS = new Set(['b.', 'aufgabe', 'kursbuch', 'lektion', 'übung', 'track', 'und', 'starten', 'wir']);

function isHeaderWord(wordText) {
  const t = wordText.trim().toLowerCase().replace(/[.,!?]+$/, '');
  if (HEADER_WORDS.has(t)) return true;
  if (/^[a-d]$/.test(t)) return true; // a single section letter, e.g. "B."
  if (/^\d{1,2}$/.test(t)) return true; // a bare exercise number
  return false;
}

// Some recordings open with a spoken announcement of the exercise/section
// ("B. Aufgabe 3, 4 und 6.") before the real content starts, followed by a
// real pause - only scanned within the first 15 words so a legitimately
// early header-like word deep in the real dialogue is never mistaken for
// this.
export function removeHeader(words) {
  let headerEnd = 0;
  for (let i = 0; i < Math.min(15, words.length); i++) {
    if (isHeaderWord(words[i].word)) headerEnd = i + 1;
    else break;
  }
  return words.slice(headerEnd);
}

// Splits the word list into segments at any word ending in a comma or
// period - the natural "complete clause" boundaries a listener's ear
// (and a chunk-by-chunk navigation UI) actually wants, rather than an
// arbitrary word count or duration.
export function chunkByPunctuation(words) {
  if (!words.length) return [];
  const chunks = [];
  let segStart = words[0].start;
  let segWords = [];

  for (const w of words) {
    segWords.push(w);
    // ?/! end a clause just as much as ,/. do - a lot of real dialogue
    // ("Lust?", "Du?") would otherwise never split at all, running
    // straight on until the next comma, however much that is.
    if (/[,.?!]/.test(w.word)) {
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

// A short filler ("So," "Gut,") sitting right after a long silence, before
// the real first chunk - common right after a header announcement fades
// out. Folds its own start time into the next chunk (rather than dropping
// the silence entirely) so nothing before the real first chunk is lost if
// there's no next chunk to fold into.
//
// `first.start` alone isn't enough to tell "a filler phrase before the
// real content" apart from "the real content's own first word, which
// just happens to follow the header's own natural silence" - a true
// filler is its own short, separate utterance, with little or no gap
// AFTER it before the real content starts flowing; the real first word
// instead typically runs straight into what follows with ~no gap. Also
// requiring a real (non-zero) gap *after* the first chunk avoids exactly
// that false positive - removeHeader's own case, where "Puh," comma-
// terminated the first punctuation chunk but led straight into "das war
// ein langer Tag" with zero gap, was wrongly swept up as if it were
// filler before this check was added.
export function removeFillerChunk(chunks, { minGapAfter = 0.3 } = {}) {
  if (chunks.length < 2) return chunks;
  const first = chunks[0];
  const gapBefore = first.start; // silence from t=0 to this chunk's own start
  const gapAfter = chunks[1].start - first.end;
  const wordCount = first.text.trim().split(/\s+/).length;
  if (gapBefore > 3 && gapAfter >= minGapAfter && wordCount <= 3) {
    const rest = chunks.slice(1);
    rest[0] = { ...rest[0], start: first.start };
    return rest;
  }
  return chunks;
}

// Merges any chunk shorter than `mergeBelow` into its neighbor, repeating
// until every chunk is either long enough or merging further would cross
// `hardCap` - punctuation gives natural phrase boundaries, but a lot of
// short interjections ("Ja." "Okay." "Hallo.") would otherwise flash by
// too fast to be useful navigation points on their own.
export function mergeShortChunks(chunks, { mergeBelow = 3, hardCap = 6 } = {}) {
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

// The full pipeline: header -> punctuation chunks -> drop a leading filler
// chunk -> merge short chunks. Returns chunk boundaries only ({start, end,
// text}[]) - word-level data for click/highlight is kept separately by the
// caller (these chunks are only for "jump to the next/previous part").
export function buildHoerenChunks(words, options = {}) {
  const body = removeHeader(words);
  const punctuationChunks = chunkByPunctuation(body);
  const withoutFiller = removeFillerChunk(punctuationChunks);
  return { bodyWords: body, chunks: mergeShortChunks(withoutFiller, options) };
}
