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

export async function saveImportedBook(book) {
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
  return meta;
}
