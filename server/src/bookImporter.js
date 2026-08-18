// Shared by scripts/import-book.js (CLI) and the /api/books import route.
//
// Ingestion format:
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

import { writeJson, readJson } from './store.js';

export function parseBookText(text) {
  const lines = text.split(/\r?\n/);
  let bookId = null;
  let title = null;
  let lang = { source: 'de', target: 'fa' };

  const pages = [];
  let currentPage = null;
  let currentChapter = null;
  let pendingDe = null;

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
      if (currentPage && !currentPage.chapter) currentPage.chapter = currentChapter;
      continue;
    }
    const sentenceMatch = line.match(/^(\d+):\s*(.+)$/);
    if (sentenceMatch) {
      finishSentence(null);
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

  if (!bookId) throw new Error('Ingestion text is missing a BOOK: id');
  if (!pages.length) throw new Error('Ingestion text has no PAGE sections');

  return {
    id: bookId,
    title: title || bookId,
    language: lang,
    pages,
  };
}

function bookMetaFrom(book) {
  return {
    id: book.id,
    title: book.title,
    language: book.language,
    pageCount: book.pages.length,
    firstPage: book.pages[0]?.page ?? null,
    lastPage: book.pages[book.pages.length - 1]?.page ?? null,
  };
}

async function updateIndex(meta) {
  const index = await readJson('books/index.json', []);
  const nextIndex = [...index.filter((b) => b.id !== meta.id), meta].sort((a, b) =>
    a.id.localeCompare(b.id)
  );
  await writeJson('books/index.json', nextIndex);
}

export async function saveImportedBook(book) {
  await writeJson(`books/${book.id}.json`, book);
  const meta = bookMetaFrom(book);
  await updateIndex(meta);
  return meta;
}

// Parses `text` as extra PAGE/CHAPTER/sentence blocks (no BOOK:/TITLE:/LANG:
// header needed - those are inherited from the existing book) and merges the
// resulting pages into it: a page number that already exists gets replaced
// (lets you fix a page), a new page number gets added, then pages are kept
// sorted by page number.
export async function appendToBook(bookId, text) {
  const existing = await readJson(`books/${bookId}.json`, null);
  if (!existing) throw new Error(`Book "${bookId}" not found`);

  const header = `BOOK: ${existing.id}\nTITLE: ${existing.title}\nLANG: ${existing.language.source} -> ${existing.language.target}\n\n`;
  const parsed = parseBookText(header + text);

  const pagesByNumber = new Map(existing.pages.map((p) => [p.page, p]));
  for (const page of parsed.pages) pagesByNumber.set(page.page, page);
  const mergedPages = [...pagesByNumber.values()].sort((a, b) => a.page - b.page);

  const updated = { ...existing, pages: mergedPages };
  await writeJson(`books/${bookId}.json`, updated);
  const meta = bookMetaFrom(updated);
  await updateIndex(meta);
  return meta;
}

export async function renameBook(bookId, title) {
  const existing = await readJson(`books/${bookId}.json`, null);
  if (!existing) throw new Error(`Book "${bookId}" not found`);

  const updated = { ...existing, title };
  await writeJson(`books/${bookId}.json`, updated);
  const meta = bookMetaFrom(updated);
  await updateIndex(meta);
  return meta;
}
