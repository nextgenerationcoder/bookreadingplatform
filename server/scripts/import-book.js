#!/usr/bin/env node
// Converts a plain-text ingestion file into the book JSON the API serves.
//
// Ingestion format (see server/content/*.txt for a real example):
//
//   BOOK: <book-id>
//   TITLE: <display title>
//   LANG: de -> fa
//
//   PAGE 7
//   CHAPTER: Kapitel 1
//   1: <German sentence>
//   <Persian translation>
//   2: <German sentence>
//   <Persian translation>
//
//   PAGE 8
//   CHAPTER: Kapitel 1
//   ...
//
// Run with: node scripts/import-book.js content/<file>.txt
// (or `npm run import-book -- content/<file>.txt` from server/)

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeJson, readJson } from '../src/store.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function parse(text) {
  const lines = text.split(/\r?\n/);
  let bookId = null;
  let title = null;
  let lang = { source: 'de', target: 'fa' };

  const pages = [];
  let currentPage = null;
  let currentChapter = null;
  let pendingDe = null;
  let pendingNum = null;

  const finishSentence = (faLine) => {
    if (pendingDe === null) return;
    if (!currentPage) {
      throw new Error(`Sentence "${pendingDe}" appears before any PAGE marker`);
    }
    currentPage.sentences.push({
      num: currentPage.sentences.length + 1,
      de: pendingDe,
      fa: faLine ? faLine.trim() : '',
      chapter: currentChapter,
    });
    pendingDe = null;
    pendingNum = null;
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    const bookMatch = line.match(/^BOOK:\s*(.+)$/i);
    if (bookMatch) {
      bookId = bookMatch[1].trim();
      continue;
    }
    const titleMatch = line.match(/^TITLE:\s*(.+)$/i);
    if (titleMatch) {
      title = titleMatch[1].trim();
      continue;
    }
    const langMatch = line.match(/^LANG:\s*(\w+)\s*->\s*(\w+)$/i);
    if (langMatch) {
      lang = { source: langMatch[1], target: langMatch[2] };
      continue;
    }
    const pageMatch = line.match(/^PAGE\s+(\d+)$/i);
    if (pageMatch) {
      finishSentence(null);
      currentPage = { page: Number(pageMatch[1]), chapter: currentChapter, sentences: [] };
      pages.push(currentPage);
      continue;
    }
    const chapterMatch = line.match(/^CHAPTER:\s*(.+)$/i);
    if (chapterMatch) {
      currentChapter = chapterMatch[1].trim();
      // First chapter seen on a page names the page header; later mid-page
      // chapter switches are still recorded per-sentence for a divider.
      if (currentPage && !currentPage.chapter) currentPage.chapter = currentChapter;
      continue;
    }
    const sentenceMatch = line.match(/^(\d+):\s*(.+)$/);
    if (sentenceMatch) {
      finishSentence(null);
      pendingNum = Number(sentenceMatch[1]);
      pendingDe = sentenceMatch[2].trim();
      continue;
    }
    if (pendingDe !== null) {
      finishSentence(line);
      continue;
    }
    throw new Error(`Unrecognized line: "${rawLine}"`);
  }
  finishSentence(null);

  if (!bookId) throw new Error('Ingestion file is missing a BOOK: id');
  return {
    id: bookId,
    title: title || bookId,
    language: lang,
    pages,
  };
}

async function main() {
  const inputArg = process.argv[2];
  if (!inputArg) {
    console.error('Usage: node scripts/import-book.js <path-to-ingestion-file.txt>');
    process.exit(1);
  }
  const inputPath = path.resolve(process.cwd(), inputArg);
  const text = await fs.readFile(inputPath, 'utf-8');
  const book = parse(text);

  await writeJson(`books/${book.id}.json`, book);

  const index = await readJson('books/index.json', []);
  const meta = {
    id: book.id,
    title: book.title,
    language: book.language,
    pageCount: book.pages.length,
    firstPage: book.pages[0]?.page ?? null,
    lastPage: book.pages[book.pages.length - 1]?.page ?? null,
  };
  const nextIndex = [...index.filter((b) => b.id !== book.id), meta].sort((a, b) =>
    a.id.localeCompare(b.id)
  );
  await writeJson('books/index.json', nextIndex);

  console.log(
    `Imported "${book.title}" (${book.id}): ${book.pages.length} pages, ` +
      `${book.pages.reduce((n, p) => n + p.sentences.length, 0)} sentences.`
  );
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
