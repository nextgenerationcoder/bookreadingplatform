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

import { db } from './db.js';

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

// Inverse of parseBookText's PAGE block: builds one deterministically from
// already-structured {de, fa} sentence data (e.g. the AI's structured-output
// response - see llm.js), rather than parsing free text the model wrote
// itself. Used by both the PDF import pipeline and the photo/OCR batch
// upload so a page is never rejected for the model getting the layout of
// its own reply slightly wrong.
export function buildPageBlock(pageNumber, chapter, sentences) {
  const lines = [`PAGE ${pageNumber}`];
  if (chapter) lines.push(`CHAPTER: ${chapter}`);
  for (let i = 0; i < sentences.length; i++) {
    lines.push(`${i + 1}: ${sentences[i].de}`);
    lines.push(sentences[i].fa);
  }
  return lines.join('\n');
}

function bookMeta(bookId) {
  const book = db.prepare('SELECT id, title, source_lang, target_lang FROM books WHERE id = ?').get(bookId);
  if (!book) return null;
  const range = db
    .prepare('SELECT COUNT(*) AS count, MIN(page_number) AS first, MAX(page_number) AS last FROM pages WHERE book_id = ?')
    .get(bookId);
  return {
    id: book.id,
    title: book.title,
    language: { source: book.source_lang, target: book.target_lang },
    pageCount: range.count,
    firstPage: range.first,
    lastPage: range.last,
  };
}

function replacePage(bookId, page) {
  db.prepare('DELETE FROM pages WHERE book_id = ? AND page_number = ?').run(bookId, page.page);
  const insertPage = db.prepare(
    'INSERT INTO pages (book_id, page_number, chapter) VALUES (?, ?, ?)'
  );
  const { lastInsertRowid: pageId } = insertPage.run(bookId, page.page, page.chapter || null);

  const insertSentence = db.prepare(
    'INSERT INTO sentences (page_id, num, de, fa, chapter) VALUES (?, ?, ?, ?, ?)'
  );
  for (const sentence of page.sentences) {
    insertSentence.run(pageId, sentence.num, sentence.de, sentence.fa, sentence.chapter || null);
  }
}

export function saveImportedBook(book) {
  const tx = db.transaction(() => {
    db.prepare(
      `INSERT INTO books (id, title, source_lang, target_lang) VALUES (?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET title = excluded.title, source_lang = excluded.source_lang, target_lang = excluded.target_lang`
    ).run(book.id, book.title, book.language.source, book.language.target);

    for (const page of book.pages) replacePage(book.id, page);
  });
  tx();
  return bookMeta(book.id);
}

// Parses `text` as extra PAGE/CHAPTER/sentence blocks (no BOOK:/TITLE:/LANG:
// header needed - those are inherited from the existing book) and merges the
// resulting pages into it: a page number that already exists gets replaced
// (lets you fix a page), a new page number gets added.
export function appendToBook(bookId, text) {
  const existing = bookMeta(bookId);
  if (!existing) throw new Error(`Book "${bookId}" not found`);

  const header = `BOOK: ${bookId}\nTITLE: ${existing.title}\nLANG: ${existing.language.source} -> ${existing.language.target}\n\n`;
  const parsed = parseBookText(header + text);

  const tx = db.transaction(() => {
    for (const page of parsed.pages) replacePage(bookId, page);
  });
  tx();
  return bookMeta(bookId);
}

// Deletes a single page (its sentences cascade via the pages->sentences FK).
// To edit a page's content instead of removing it, re-append text for that
// same page number through appendToBook() above - a matching page number
// replaces rather than duplicates.
export function deletePage(bookId, pageNumber) {
  const existing = bookMeta(bookId);
  if (!existing) throw new Error(`Book "${bookId}" not found`);
  const result = db.prepare('DELETE FROM pages WHERE book_id = ? AND page_number = ?').run(bookId, pageNumber);
  if (result.changes === 0) throw new Error(`Page ${pageNumber} not found in "${bookId}"`);
  return bookMeta(bookId);
}

export function renameBook(bookId, title) {
  const result = db.prepare('UPDATE books SET title = ? WHERE id = ?').run(title, bookId);
  if (result.changes === 0) throw new Error(`Book "${bookId}" not found`);
  return bookMeta(bookId);
}

export function listBooks() {
  const ids = db.prepare('SELECT id FROM books ORDER BY id').all();
  return ids.map((row) => bookMeta(row.id));
}

export function getBook(bookId) {
  const meta = bookMeta(bookId);
  if (!meta) return null;

  const pages = db
    .prepare('SELECT id, page_number, chapter FROM pages WHERE book_id = ? ORDER BY page_number')
    .all(bookId);
  const sentenceStmt = db.prepare(
    'SELECT num, de, fa, chapter FROM sentences WHERE page_id = ? ORDER BY num'
  );

  return {
    id: meta.id,
    title: meta.title,
    language: meta.language,
    pages: pages.map((p) => ({
      page: p.page_number,
      chapter: p.chapter,
      sentences: sentenceStmt.all(p.id),
    })),
  };
}
