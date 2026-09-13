#!/usr/bin/env node
// Converts a plain-text ingestion file into the book JSON the API serves.
// See server/src/bookImporter.js for the file format.
//
// Run with: node scripts/import-book.js content/<file>.txt
// (or `npm run import-book -- content/<file>.txt` from server/)

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { parseBookText, saveImportedBook } from '../src/bookImporter.js';

async function main() {
  const inputArg = process.argv[2];
  if (!inputArg) {
    console.error('Usage: node scripts/import-book.js <path-to-ingestion-file.txt>');
    process.exit(1);
  }
  const inputPath = path.resolve(process.cwd(), inputArg);
  const text = await fs.readFile(inputPath, 'utf-8');
  const book = parseBookText(text);
  await saveImportedBook(book);

  console.log(
    `Imported "${book.title}" (${book.id}): ${book.pages.length} pages, ` +
      `${book.pages.reduce((n, p) => n + p.sentences.length, 0)} sentences.`
  );
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
