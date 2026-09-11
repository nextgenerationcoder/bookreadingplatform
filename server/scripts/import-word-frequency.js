#!/usr/bin/env node
// Imports a German word-frequency list from a Leipzig Corpora Collection
// corpus archive (https://wortschatz-leipzig.de) into the word_frequency
// table - see db.js. Only the corpus's "*-words.txt" member is used (a
// plain <rank>\t<word>\t<frequency> list); the far larger sentences/
// co-occurrence files in the same archive are ignored.
//
// This needs real internet access to *-leipzig.de, which most sandboxed dev
// environments block - run it on the actual server instead:
//   docker compose exec app node server/scripts/import-word-frequency.js
// (or `npm run import-word-frequency --workspace server` outside Docker)
//
// Usage:
//   node scripts/import-word-frequency.js [url-or-local-tar.gz-path]
// Defaults to the German news 2025 1M-sentence corpus if no argument is given.

import { execFileSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { db } from '../src/db.js';

const DEFAULT_URL = 'https://downloads.wortschatz-leipzig.de/corpora/deu_news_2025_1M.tar.gz';

async function downloadToTemp(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed: ${res.status} ${res.statusText}`);
  const buffer = Buffer.from(await res.arrayBuffer());
  const tmpFile = path.join(os.tmpdir(), `word-freq-${Date.now()}.tar.gz`);
  await fs.writeFile(tmpFile, buffer);
  return tmpFile;
}

function findWordsMember(tarPath) {
  const listing = execFileSync('tar', ['-tzf', tarPath], { encoding: 'utf-8' });
  const member = listing.split('\n').find((line) => line.trim().endsWith('-words.txt'));
  if (!member) throw new Error(`No "*-words.txt" file found inside the archive. Contents:\n${listing}`);
  return member.trim();
}

function extractMember(tarPath, member) {
  return execFileSync('tar', ['-xzf', tarPath, '-O', member], { encoding: 'utf-8', maxBuffer: 1024 * 1024 * 200 });
}

// Leipzig's "-words.txt" format: <rank>\t<word>\t<frequency>, one per line,
// sorted by rank (most frequent word first). Same skip-and-log approach as
// other bulk ingestion in this project - a handful of malformed lines
// shouldn't abort the whole import.
function parseWordsFile(text) {
  const rows = [];
  let skipped = 0;
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    const parts = line.split('\t');
    if (parts.length !== 3) {
      skipped++;
      continue;
    }
    const [rankStr, word, freqStr] = parts;
    const rank = Number(rankStr);
    const frequency = Number(freqStr);
    if (!word.trim() || !Number.isFinite(rank) || !Number.isFinite(frequency)) {
      skipped++;
      continue;
    }
    rows.push({ word: word.trim(), rank, frequency });
  }
  return { rows, skipped };
}

async function main() {
  const arg = process.argv[2] || DEFAULT_URL;
  const isUrl = /^https?:\/\//i.test(arg);

  console.log(isUrl ? `Downloading ${arg} ...` : `Reading local file ${arg} ...`);
  const tarPath = isUrl ? await downloadToTemp(arg) : path.resolve(process.cwd(), arg);

  try {
    const member = findWordsMember(tarPath);
    console.log(`Extracting ${member} ...`);
    const text = extractMember(tarPath, member);

    const { rows, skipped } = parseWordsFile(text);
    if (!rows.length) throw new Error('No word/frequency rows parsed - check the archive format.');

    console.log(`Parsed ${rows.length} words (${skipped} skipped lines). Writing to database ...`);
    const insert = db.prepare(
      `INSERT INTO word_frequency (word, rank, frequency) VALUES (?, ?, ?)
       ON CONFLICT(word) DO UPDATE SET rank = excluded.rank, frequency = excluded.frequency`
    );
    const tx = db.transaction((items) => {
      for (const { word, rank, frequency } of items) insert.run(word, rank, frequency);
    });
    tx(rows);

    console.log(`Done: ${rows.length} words in word_frequency.`);
  } finally {
    if (isUrl) await fs.unlink(tarPath).catch(() => {});
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
