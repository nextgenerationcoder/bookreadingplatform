// Mirrors bookImporter.js's ingestion format, plus a required LEVEL header
// (CEFR level - A1 through C2). Courses are a separate content type from
// books (own tables), but read the same way in the reader UI.
//
//   COURSE: <course-id>
//   TITLE: <display title>
//   LEVEL: A1
//   LANG: de -> fa
//
//   PAGE 1
//   CHAPTER: Kapitel 1
//   1: <German sentence>
//   <Persian translation>
//   ...

import crypto from 'node:crypto';
import { db } from './db.js';

export const CEFR_LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];

export function parseCourseText(text) {
  const lines = text.split(/\r?\n/);
  let courseId = null;
  let title = null;
  let level = null;
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

    const courseMatch = line.match(/^COURSE:\s*(.+)$/i);
    if (courseMatch) {
      courseId = courseMatch[1].trim();
      continue;
    }
    const titleMatch = line.match(/^TITLE:\s*(.+)$/i);
    if (titleMatch) {
      title = titleMatch[1].trim();
      continue;
    }
    const levelMatch = line.match(/^LEVEL:\s*(\w+)$/i);
    if (levelMatch) {
      level = levelMatch[1].toUpperCase();
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

  if (!courseId) throw new Error('Ingestion text is missing a COURSE: id');
  if (!level) throw new Error('Ingestion text is missing a LEVEL: (A1-C2)');
  if (!CEFR_LEVELS.includes(level)) {
    throw new Error(`LEVEL must be one of: ${CEFR_LEVELS.join(', ')}`);
  }
  if (!pages.length) throw new Error('Ingestion text has no PAGE sections');

  return {
    id: courseId,
    title: title || courseId,
    level,
    language: lang,
    pages,
  };
}

function courseMeta(courseId) {
  const course = db.prepare('SELECT id, level, title, source_lang, target_lang FROM courses WHERE id = ?').get(courseId);
  if (!course) return null;
  const range = db
    .prepare('SELECT COUNT(*) AS count, MIN(page_number) AS first, MAX(page_number) AS last FROM course_pages WHERE course_id = ?')
    .get(courseId);
  return {
    id: course.id,
    level: course.level,
    title: course.title,
    language: { source: course.source_lang, target: course.target_lang },
    pageCount: range.count,
    firstPage: range.first,
    lastPage: range.last,
  };
}

function replacePage(courseId, page) {
  const existing = db
    .prepare('SELECT audio FROM course_pages WHERE course_id = ? AND page_number = ?')
    .get(courseId, page.page);
  db.prepare('DELETE FROM course_pages WHERE course_id = ? AND page_number = ?').run(courseId, page.page);
  const insertPage = db.prepare(
    'INSERT INTO course_pages (course_id, page_number, chapter, audio) VALUES (?, ?, ?, ?)'
  );
  const { lastInsertRowid: pageId } = insertPage.run(courseId, page.page, page.chapter || null, existing?.audio || null);

  const insertSentence = db.prepare(
    'INSERT INTO course_sentences (page_id, num, de, fa, chapter) VALUES (?, ?, ?, ?, ?)'
  );
  for (const sentence of page.sentences) {
    insertSentence.run(pageId, sentence.num, sentence.de, sentence.fa, sentence.chapter || null);
  }
}

// An HTML course page (see db.js's course_pages.html comment) replaces
// whatever was at that page number before, same as replacePage() above -
// no sentences get inserted for it.
function replaceHtmlPage(courseId, pageNumber, chapter, html) {
  // DELETE+INSERT (not UPDATE) so a page number that didn't exist yet gets
  // created too - but that means a column neither parameter here touches,
  // like audio, would silently come back NULL unless carried over by hand:
  // read whatever this page number already had before replacing it.
  const existing = db
    .prepare('SELECT audio FROM course_pages WHERE course_id = ? AND page_number = ?')
    .get(courseId, pageNumber);
  db.prepare('DELETE FROM course_pages WHERE course_id = ? AND page_number = ?').run(courseId, pageNumber);
  db.prepare(
    'INSERT INTO course_pages (course_id, page_number, chapter, html, audio) VALUES (?, ?, ?, ?, ?)'
  ).run(courseId, pageNumber, chapter || null, html, existing?.audio || null);
}

// Creates (or replaces, if courseId already exists) a course whose first
// page is an uploaded HTML page rather than bilingual sentence pairs - the
// HTML-upload counterpart to saveImportedCourse() above. `lang` defaults to
// de -> fa, matching parseCourseText's own default.
export function createCourseFromHtml({ courseId, title, level, lang, pageNumber, chapter, html }) {
  if (!CEFR_LEVELS.includes(level)) {
    throw new Error(`LEVEL must be one of: ${CEFR_LEVELS.join(', ')}`);
  }
  const { source, target } = lang || { source: 'de', target: 'fa' };
  const tx = db.transaction(() => {
    db.prepare(
      `INSERT INTO courses (id, level, title, source_lang, target_lang) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET level = excluded.level, title = excluded.title, source_lang = excluded.source_lang, target_lang = excluded.target_lang`
    ).run(courseId, level, title, source, target);
    replaceHtmlPage(courseId, pageNumber, chapter, html);
  });
  tx();
  return courseMeta(courseId);
}

// Adds (or replaces) one HTML page on an already-existing course.
export function addHtmlPageToCourse(courseId, { pageNumber, chapter, html }) {
  const existing = courseMeta(courseId);
  if (!existing) throw new Error(`Course "${courseId}" not found`);
  replaceHtmlPage(courseId, pageNumber, chapter, html);
  return courseMeta(courseId);
}

// --- Freely-placed notes (right-click -> "Notiz" on an HTML course page) -
// See db.js's course_page_notes comment for what blockIndex/charOffset mean.

function parseCourseNoteRow(row) {
  return { id: row.id, blockIndex: row.block_index, charOffset: row.char_offset, text: row.text, createdAt: row.created_at };
}

export function listCoursePageNotes(userId, courseId, pageNumber) {
  return db
    .prepare('SELECT * FROM course_page_notes WHERE user_id = ? AND course_id = ? AND page_number = ? ORDER BY created_at ASC')
    .all(userId, courseId, pageNumber)
    .map(parseCourseNoteRow);
}

export function createCoursePageNote({ userId, courseId, pageNumber, blockIndex, charOffset, text }) {
  const id = crypto.randomUUID();
  db.prepare(
    'INSERT INTO course_page_notes (id, user_id, course_id, page_number, block_index, char_offset, text, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(id, userId, courseId, pageNumber, blockIndex, charOffset, text || '', new Date().toISOString());
  return id;
}

export function updateCoursePageNoteText(userId, courseId, pageNumber, noteId, text) {
  const result = db
    .prepare('UPDATE course_page_notes SET text = ? WHERE id = ? AND user_id = ? AND course_id = ? AND page_number = ?')
    .run(text, noteId, userId, courseId, pageNumber);
  return result.changes > 0;
}

export function deleteCoursePageNote(userId, courseId, pageNumber, noteId) {
  const result = db
    .prepare('DELETE FROM course_page_notes WHERE id = ? AND user_id = ? AND course_id = ? AND page_number = ?')
    .run(noteId, userId, courseId, pageNumber);
  return result.changes > 0;
}

export function saveImportedCourse(course) {
  const tx = db.transaction(() => {
    db.prepare(
      `INSERT INTO courses (id, level, title, source_lang, target_lang) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET level = excluded.level, title = excluded.title, source_lang = excluded.source_lang, target_lang = excluded.target_lang`
    ).run(course.id, course.level, course.title, course.language.source, course.language.target);

    for (const page of course.pages) replacePage(course.id, page);
  });
  tx();
  return courseMeta(course.id);
}

// Parses `text` as extra PAGE/CHAPTER/sentence blocks (no COURSE:/TITLE:/
// LEVEL:/LANG: header needed - those are inherited from the existing
// course) and merges the resulting pages into it: a page number that
// already exists gets replaced, a new page number gets added.
export function appendToCourse(courseId, text) {
  const existing = courseMeta(courseId);
  if (!existing) throw new Error(`Course "${courseId}" not found`);

  const header = `COURSE: ${courseId}\nTITLE: ${existing.title}\nLEVEL: ${existing.level}\nLANG: ${existing.language.source} -> ${existing.language.target}\n\n`;
  const parsed = parseCourseText(header + text);

  const tx = db.transaction(() => {
    for (const page of parsed.pages) replacePage(courseId, page);
  });
  tx();
  return courseMeta(courseId);
}

export function deleteCoursePage(courseId, pageNumber) {
  const existing = courseMeta(courseId);
  if (!existing) throw new Error(`Course "${courseId}" not found`);
  const result = db.prepare('DELETE FROM course_pages WHERE course_id = ? AND page_number = ?').run(courseId, pageNumber);
  if (result.changes === 0) throw new Error(`Page ${pageNumber} not found in "${courseId}"`);
  return courseMeta(courseId);
}

// The raw HTML for one page, for GET /api/courses/:courseId/pages/:pageNumber/view
// to serve back exactly as uploaded (same idea as worksheets' /:id/view).
export function getCoursePageHtml(courseId, pageNumber) {
  const row = db
    .prepare('SELECT html FROM course_pages WHERE course_id = ? AND page_number = ?')
    .get(courseId, pageNumber);
  return row?.html || null;
}

// The raw audio bytes for one page's narration track, for GET
// /api/courses/:courseId/pages/:pageNumber/audio to serve with Range
// support (see routes/courses.js) - returns null if this page has none.
export function getCoursePageAudio(courseId, pageNumber) {
  const row = db
    .prepare('SELECT audio FROM course_pages WHERE course_id = ? AND page_number = ?')
    .get(courseId, pageNumber);
  return row?.audio || null;
}

// Attaches (or replaces) a page's narration track. Independent of
// replaceHtmlPage/replacePage above - doesn't touch html/sentences, so it
// can be called on an already-imported page without re-uploading its text.
export function setCoursePageAudio(courseId, pageNumber, buffer) {
  const result = db
    .prepare('UPDATE course_pages SET audio = ? WHERE course_id = ? AND page_number = ?')
    .run(buffer, courseId, pageNumber);
  if (result.changes === 0) throw new Error(`Page ${pageNumber} not found in "${courseId}"`);
}

export function renameCourse(courseId, title) {
  const result = db.prepare('UPDATE courses SET title = ? WHERE id = ?').run(title, courseId);
  if (result.changes === 0) throw new Error(`Course "${courseId}" not found`);
  return courseMeta(courseId);
}

export function listCourses(level) {
  const ids = level
    ? db.prepare('SELECT id FROM courses WHERE level = ? ORDER BY id').all(level)
    : db.prepare('SELECT id FROM courses ORDER BY level, id').all();
  return ids.map((row) => courseMeta(row.id));
}

export function getCourse(courseId) {
  const meta = courseMeta(courseId);
  if (!meta) return null;

  // "audio IS NOT NULL" rather than selecting audio itself - this response
  // lists every page's metadata, and a page's narration track can be
  // several MB; nothing here needs the bytes, just whether one exists (the
  // player fetches them separately via GET .../pages/:n/audio).
  const pages = db
    .prepare(
      'SELECT id, page_number, chapter, html, (audio IS NOT NULL) AS has_audio FROM course_pages WHERE course_id = ? ORDER BY page_number'
    )
    .all(courseId);
  const sentenceStmt = db.prepare(
    'SELECT num, de, fa, chapter FROM course_sentences WHERE page_id = ? ORDER BY num'
  );

  return {
    id: meta.id,
    level: meta.level,
    title: meta.title,
    language: meta.language,
    pages: pages.map((p) => ({
      page: p.page_number,
      chapter: p.chapter,
      html: p.html || null,
      hasAudio: Boolean(p.has_audio),
      sentences: p.html ? [] : sentenceStmt.all(p.id),
    })),
  };
}
