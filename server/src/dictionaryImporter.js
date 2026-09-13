// Parses bulk vocabulary text (the "word = meaning" notes format already
// produced by the book-translation prompt) into dictionary rows, so words
// can be added to the shared dictionary the same way book pages are added -
// by pasting text, not by hand-editing JSON.
//
// Recognized line shapes:
//   Ich = من
//   ging → gehen = رفت                (conjugated form + infinitive hint)
//   der Tisch, die Tische = میز        (noun citation form; article stripped)

import { db } from './db.js';

const ARTICLES = new Set(['der', 'die', 'das', 'den', 'dem', 'des', 'ein', 'eine', 'einen', 'einem', 'einer', 'eines']);

function normalizeKey(word) {
  return word.trim().toLowerCase();
}

function keyFromLeftPart(leftPart) {
  const firstSegment = leftPart.split(',')[0].trim();
  const words = firstSegment.split(/\s+/);
  if (words.length > 1 && ARTICLES.has(words[0].toLowerCase())) {
    return normalizeKey(words.slice(1).join(' '));
  }
  return normalizeKey(firstSegment);
}

export function parseDictionaryText(text) {
  const entries = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || !line.includes('=')) continue;

    const eqIndex = line.indexOf('=');
    const leftPart = line.slice(0, eqIndex).trim();
    const gloss = line.slice(eqIndex + 1).trim();
    if (!leftPart || !gloss) continue;

    let word, storedGloss;
    if (leftPart.includes('→')) {
      const [surfacePart, hintPart] = leftPart.split('→').map((s) => s.trim());
      word = keyFromLeftPart(surfacePart);
      storedGloss = hintPart ? `${gloss} • ${hintPart}` : gloss;
    } else {
      word = keyFromLeftPart(leftPart);
      storedGloss = gloss;
    }

    if (word) entries.push({ word, gloss: storedGloss });
  }
  return entries;
}

export function importDictionaryEntries(entries) {
  const upsert = db.prepare(
    `INSERT INTO dictionary (word, gloss) VALUES (?, ?)
     ON CONFLICT(word) DO UPDATE SET gloss = excluded.gloss`
  );
  const tx = db.transaction(() => {
    for (const { word, gloss } of entries) upsert.run(word, gloss);
  });
  tx();
}

// separableVerbs: [{conjugatedForm, infinitive, gloss}] - as reported by
// the translation AI alongside a page's sentences (see llm.js's
// SEPARABLE_VERB_INSTRUCTION). Adds/refreshes the infinitive's own
// dictionary entry plus a " • infinitive" hint on the conjugated form
// (client/src/separableVerbs.js's resolveCompound() reads that hint to
// recognize the split verb, e.g. "trägst ... bei" -> beitragen), so newly
// translated content builds up the same dictionary coverage a hand-curated
// book already has, automatically, page by page.
export function upsertSeparableVerbs(separableVerbs) {
  if (!separableVerbs?.length) return;
  const entries = separableVerbs.flatMap(({ conjugatedForm, infinitive, gloss }) => [
    { word: normalizeKey(infinitive), gloss },
    { word: normalizeKey(conjugatedForm), gloss: `${gloss} • ${infinitive}` },
  ]);
  importDictionaryEntries(entries);
}
