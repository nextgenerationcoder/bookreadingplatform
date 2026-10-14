#!/usr/bin/env node
// (Re)generates server/data/word-frequency.seed.json from a German word-
// frequency list - loaded automatically at server startup by seed.js, the
// same way dictionary.seed.json and wikidict-de-fa.json already are. You
// don't need to run this on every deploy: the generated JSON is committed
// to the repo, so a fresh deployment picks it up with no extra step.
//
// Default source: hermitdave/FrequencyWords on GitHub
// (https://github.com/hermitdave/FrequencyWords), a word-frequency list
// derived from OpenSubtitles - not the Leipzig Corpora Collection
// originally discussed, because *-leipzig.de is blocked from most
// sandboxed dev environments' networks while raw.githubusercontent.com
// isn't. Casing follows the source (mostly lowercase, since it's subtitle
// transcription) - lowercased here to match how this app already keys its
// dictionary (see client/src/state.js's normalizeWord).
//
// Usage: node scripts/import-word-frequency.js [url-or-local-path] [topN]
// topN defaults to 200000 - the source file runs past a million rows deep
// into OCR-noise/misspelling territory, so this keeps only the meaningful
// head of the list.

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_PATH = path.join(__dirname, '..', 'data', 'word-frequency.seed.json');
const DEFAULT_URL = 'https://raw.githubusercontent.com/hermitdave/FrequencyWords/master/content/2018/de/de_full.txt';
const DEFAULT_TOP_N = 200000;

async function loadText(source) {
  if (/^https?:\/\//i.test(source)) {
    const res = await fetch(source);
    if (!res.ok) throw new Error(`Download failed: ${res.status} ${res.statusText}`);
    return res.text();
  }
  return fs.readFile(path.resolve(process.cwd(), source), 'utf-8');
}

// Source format: "<word> <count>" per line, already sorted by frequency
// descending. Lowercased and summed on collision (a handful of words
// appear twice after lowercasing distinct-cased source rows, e.g.
// "Server"/"server"), then re-sorted since collisions can shuffle order.
function parseFrequencyList(text, topN) {
  const byWord = new Map();
  let skipped = 0;
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    const spaceIdx = line.lastIndexOf(' ');
    if (spaceIdx === -1) {
      skipped++;
      continue;
    }
    const word = line.slice(0, spaceIdx).trim().toLowerCase();
    const count = Number(line.slice(spaceIdx + 1).trim());
    if (!word || !Number.isFinite(count)) {
      skipped++;
      continue;
    }
    byWord.set(word, (byWord.get(word) || 0) + count);
  }
  const sorted = [...byWord.entries()].sort((a, b) => b[1] - a[1]).slice(0, topN);
  return { entries: sorted, skipped };
}

async function main() {
  const source = process.argv[2] || DEFAULT_URL;
  const topN = Number(process.argv[3]) || DEFAULT_TOP_N;

  console.log(`Loading ${source} ...`);
  const text = await loadText(source);

  const { entries, skipped } = parseFrequencyList(text, topN);
  if (!entries.length) throw new Error('No word/frequency rows parsed - check the source format.');

  await fs.writeFile(OUTPUT_PATH, JSON.stringify(Object.fromEntries(entries)));

  console.log(`Wrote ${entries.length} words (${skipped} skipped lines) to ${path.relative(process.cwd(), OUTPUT_PATH)}.`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
