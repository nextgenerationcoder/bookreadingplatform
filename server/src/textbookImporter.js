// Private interactive-textbook import pipeline (Step 1): turns a textbook
// PDF + its transcript PDF + its MP3s into structured tb_exercises rows with
// real extracted images, matched audio and matched transcript text.
//
// Three deterministic stages need no AI at all and are fully unit-tested:
//   - rendering a PDF page to a PNG and cropping an image region out of it
//     (renderPdfPageToPng / cropImageRegion)
//   - parsing the transcript PDF's own text layer into per-"Aufgabe" speaker
//     segments (parseTranscriptText)
//   - reading a track number out of an audio filename (parseAudioTrackNumber)
// One stage genuinely needs judgment a deterministic parser can't provide -
// reading a page's layout into exercises/questions/options/grammar tables -
// and goes through the account's own vision API key (extractExercisesFromImage
// in llm.js). runTextbookImport takes that stage as an injected function
// (visionExtractor) specifically so tests - and a one-off demo/seed run - can
// supply a stub instead of a real paid API call, exactly like this project's
// existing AI-backed importers are tested elsewhere.
//
// Idempotency: every write goes through an upsert keyed by a natural key
// (book id, lesson id, exercise number/sub-number for exercises; book id +
// filename for audio) - see the UNIQUE constraints in db.js. Re-running an
// import after a failure updates the same rows; it never duplicates them.

import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import path from 'node:path';
import crypto from 'node:crypto';
import { promises as fs } from 'node:fs';
import { db, DB_PATH } from './db.js';
import { extractExercisesFromImage } from './llm.js';
import { decrypt } from './crypto.js';

export const RENDER_SCALE = 2.0;

// This textbook restarts exercise numbering inside each lettered section
// (A/B/C/D) - a handful of warm-up exercises on the lesson's opening page are
// printed before any letter appears at all, so they get this synthetic
// section rather than a null section_id (see db.js's tb_exercises comment).
export const UNNUMBERED_SECTION_LETTER = '_intro';

// Never under client/dist or any express.static root - the only way to read
// a file here is GET /api/textbooks/media/:id, which requires a session
// (see routes/textbooks.js) and looks the path up in the DB first.
export const TB_MEDIA_DIR = path.join(path.dirname(DB_PATH), 'textbook-media');
await fs.mkdir(TB_MEDIA_DIR, { recursive: true });

// ---------------------------------------------------------------------------
// Deterministic: PDF page rendering + image region cropping
// ---------------------------------------------------------------------------

export async function loadPdf(filePathOrBuffer) {
  const data = Buffer.isBuffer(filePathOrBuffer) ? filePathOrBuffer : await fs.readFile(filePathOrBuffer);
  return getDocument({ data: new Uint8Array(data) }).promise;
}

export async function renderPdfPageToPng(doc, pageIndex) {
  const page = await doc.getPage(pageIndex);
  const viewport = page.getViewport({ scale: RENDER_SCALE });
  const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
  const ctx = canvas.getContext('2d');
  await page.render({ canvasContext: ctx, viewport }).promise;
  return canvas.toBuffer('image/png');
}

export async function extractPageText(doc, pageIndex) {
  const page = await doc.getPage(pageIndex);
  const content = await page.getTextContent();
  return content.items.map((item) => item.str).join(' ').replace(/\s+/g, ' ').trim();
}

// box is {x0,y0,x1,y1} as fractions of the page (0..1) - see
// llm.js:EXERCISE_TOOL_SCHEMA's "images" field for why fractions, not pixels.
export async function cropImageRegion(pagePngBuffer, box) {
  const img = await loadImage(pagePngBuffer);
  const x0 = Math.max(0, Math.min(1, box.x0));
  const y0 = Math.max(0, Math.min(1, box.y0));
  const x1 = Math.max(x0, Math.min(1, box.x1));
  const y1 = Math.max(y0, Math.min(1, box.y1));
  const sx = Math.round(x0 * img.width);
  const sy = Math.round(y0 * img.height);
  const sw = Math.max(1, Math.round((x1 - x0) * img.width));
  const sh = Math.max(1, Math.round((y1 - y0) * img.height));
  const canvas = createCanvas(sw, sh);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
  return canvas.toBuffer('image/png');
}

// ---------------------------------------------------------------------------
// Deterministic: transcript PDF text -> per-"Aufgabe" speaker segments
// ---------------------------------------------------------------------------

// The transcript PDF's text layer reads as a flat run of "Speaker: line"
// pairs under headings like "Aufgabe 2" / "Aufgabe 3, 4 und 6" / "Lektion 2" -
// this walks it line by line (the PDF's own text-content items, which already
// come out one per printed line) rather than guessing at whitespace layout.
const AUFGABE_HEADING_RE = /^(?:Starten wir!?,?\s*)?Aufgabe\s+([\d,\sund]+)$/i;
const LEKTION_HEADING_RE = /^Lektion\s+(\d+)$/i;
// "Florian:" / "Frau Kratz / Herr Biberger:" - a run of name-like words then a
// colon, at the start of the line; everything after the colon is that
// speaker's line (continuation lines with no "Name:" prefix belong to the
// same speaker, handled by the caller joining them in).
const SPEAKER_LINE_RE = /^([A-ZÄÖÜ][\wÄÖÜäöüß.\-\/\s]{0,40}):\s*(.*)$/;

export function parseTranscriptLines(lines) {
  const sections = []; // { lessonNumber, exerciseLabel, segments: [{speaker, text}] }
  let currentLesson = null;
  let current = null;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    const lektionMatch = line.match(LEKTION_HEADING_RE);
    if (lektionMatch) {
      currentLesson = Number(lektionMatch[1]);
      current = null;
      continue;
    }

    const aufgabeMatch = line.match(AUFGABE_HEADING_RE);
    if (aufgabeMatch) {
      current = { lessonNumber: currentLesson, exerciseLabel: `Aufgabe ${aufgabeMatch[1].trim()}`, segments: [] };
      sections.push(current);
      continue;
    }

    if (!current) continue; // front matter / copyright line before the first Aufgabe heading

    const speakerMatch = line.match(SPEAKER_LINE_RE);
    if (speakerMatch) {
      current.segments.push({ speaker: speakerMatch[1].trim(), text: speakerMatch[2].trim() });
    } else if (current.segments.length) {
      // Continuation of the previous speaker's line (the PDF wraps long
      // turns across several text-layer lines with no repeated "Name:").
      const last = current.segments[current.segments.length - 1];
      last.text = `${last.text} ${line}`.trim();
    }
  }

  return sections.filter((s) => s.segments.length > 0);
}

export function parseTranscriptText(fullText) {
  // pdfjs text-content items don't carry line breaks; the caller must pass
  // already-line-split text (e.g. from extracting each page separately and
  // joining with '\n') - see importTranscriptPdf below for the real path.
  return parseTranscriptLines(fullText.split('\n'));
}

// Matches a parsed section to one printed exercise label (e.g. exercise
// "6" against exerciseLabel "Aufgabe 3, 4 und 6") - true if that exact
// number appears in the label's number list.
export function transcriptSectionMatchesExercise(section, exerciseNumber) {
  const numbers = section.exerciseLabel.match(/\d+/g) || [];
  return numbers.includes(String(exerciseNumber));
}

// ---------------------------------------------------------------------------
// Deterministic: audio filename -> track number
// ---------------------------------------------------------------------------

// "1_04_Starten_wir_B1_L2_SW_2.mp3" -> "4" (the textbook's own audio-icon
// track numbers, e.g. the small "4" next to a speaker icon on page 21,
// printed as "1_04" in the CD/track filename convention this publisher
// uses - the leading "1_" is the CD/unit number, not the track).
export function parseAudioTrackNumber(filename) {
  const match = filename.match(/^\d+_(\d+)_/);
  return match ? String(Number(match[1])) : null;
}

// ---------------------------------------------------------------------------
// Idempotent upserts (one row per natural key; safe to call again)
// ---------------------------------------------------------------------------

export function upsertBook({ id, title, level = null, publisher = null, isbn = null }) {
  db.prepare(
    `INSERT INTO tb_books (id, title, level, publisher, isbn, created_at) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET title = excluded.title, level = excluded.level, publisher = excluded.publisher, isbn = excluded.isbn`
  ).run(id, title, level, publisher, isbn, new Date().toISOString());
  return id;
}

export function upsertLesson({ bookId, lessonNumber, title, startPage = null, endPage = null }) {
  const existing = db.prepare('SELECT id FROM tb_lessons WHERE book_id = ? AND lesson_number = ?').get(bookId, lessonNumber);
  const id = existing?.id || crypto.randomUUID();
  db.prepare(
    `INSERT INTO tb_lessons (id, book_id, lesson_number, title, start_page, end_page) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(book_id, lesson_number) DO UPDATE SET title = excluded.title, start_page = excluded.start_page, end_page = excluded.end_page`
  ).run(id, bookId, lessonNumber, title, startPage, endPage);
  return id;
}

export function upsertSection({ lessonId, sectionLetter, title = null, orderIndex = 0 }) {
  const existing = db.prepare('SELECT id FROM tb_sections WHERE lesson_id = ? AND section_letter = ?').get(lessonId, sectionLetter);
  const id = existing?.id || crypto.randomUUID();
  db.prepare(
    `INSERT INTO tb_sections (id, lesson_id, section_letter, title, order_index) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(lesson_id, section_letter) DO UPDATE SET title = excluded.title, order_index = excluded.order_index`
  ).run(id, lessonId, sectionLetter, title, orderIndex);
  return id;
}

// sectionId is required (never null) - see db.js's tb_exercises comment for
// why: this textbook restarts exercise numbering per lettered section, so
// section_id has to be part of the identity that makes an exercise unique.
export function upsertExercise({
  bookId, lessonId, sectionId, exerciseNumber, subNumber = '', printedPage = null, pdfPageIndex = null,
  exerciseType, instructions = null, content, answerKey = null, answerKeyVerified = false,
  extractionConfidence = null, extractionSource = 'ai', orderIndex = 0,
}) {
  if (!sectionId) throw new Error('upsertExercise requires sectionId');
  const existing = db
    .prepare('SELECT id FROM tb_exercises WHERE book_id = ? AND lesson_id = ? AND section_id = ? AND exercise_number = ? AND sub_number = ?')
    .get(bookId, lessonId, sectionId, exerciseNumber, subNumber);
  const id = existing?.id || crypto.randomUUID();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO tb_exercises (
       id, book_id, lesson_id, section_id, exercise_number, sub_number, printed_page, pdf_page_index,
       exercise_type, instructions, content_json, answer_key_json, answer_key_verified,
       extraction_confidence, extraction_source, needs_review, order_index, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)
     ON CONFLICT(book_id, lesson_id, section_id, exercise_number, sub_number) DO UPDATE SET
       printed_page = excluded.printed_page, pdf_page_index = excluded.pdf_page_index,
       exercise_type = excluded.exercise_type, instructions = excluded.instructions, content_json = excluded.content_json,
       answer_key_json = excluded.answer_key_json, answer_key_verified = excluded.answer_key_verified,
       extraction_confidence = excluded.extraction_confidence, extraction_source = excluded.extraction_source,
       order_index = excluded.order_index, updated_at = excluded.updated_at`
  ).run(
    id, bookId, lessonId, sectionId, String(exerciseNumber), subNumber, printedPage, pdfPageIndex,
    exerciseType, instructions, JSON.stringify(content ?? {}), answerKey ? JSON.stringify(answerKey) : null,
    answerKeyVerified ? 1 : 0, extractionConfidence, extractionSource, orderIndex, now, now
  );
  return id;
}

export function clearExerciseImages(exerciseId) {
  db.prepare('DELETE FROM tb_exercise_images WHERE exercise_id = ?').run(exerciseId);
}

export function addExerciseImage({ exerciseId, filePath, caption = null, orderIndex = 0 }) {
  const id = crypto.randomUUID();
  db.prepare('INSERT INTO tb_exercise_images (id, exercise_id, file_path, caption, order_index) VALUES (?, ?, ?, ?, ?)').run(
    id, exerciseId, filePath, caption, orderIndex
  );
  return id;
}

export function upsertAudioFile({ bookId, lessonId = null, originalFilename, filePath, trackLabel = null }) {
  const existing = db.prepare('SELECT id FROM tb_audio_files WHERE book_id = ? AND original_filename = ?').get(bookId, originalFilename);
  if (existing) {
    db.prepare('UPDATE tb_audio_files SET lesson_id = ?, file_path = ?, track_label = ? WHERE id = ?').run(lessonId, filePath, trackLabel, existing.id);
    return existing.id;
  }
  const id = crypto.randomUUID();
  db.prepare(
    'INSERT INTO tb_audio_files (id, book_id, lesson_id, original_filename, file_path, track_label, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(id, bookId, lessonId, originalFilename, filePath, trackLabel, new Date().toISOString());
  return id;
}

export function linkExerciseAudio(exerciseId, audioId) {
  db.prepare('INSERT OR IGNORE INTO tb_exercise_audio (exercise_id, audio_id) VALUES (?, ?)').run(exerciseId, audioId);
}

export function upsertTranscript({ bookId, lessonId = null, audioId = null, exerciseLabel, segments, sourcePdf = null }) {
  const existing = db.prepare('SELECT id FROM tb_transcripts WHERE book_id = ? AND exercise_label = ?').get(bookId, exerciseLabel);
  const id = existing?.id || crypto.randomUUID();
  if (existing) {
    db.prepare('UPDATE tb_transcripts SET lesson_id = ?, audio_id = ?, speaker_segments_json = ?, source_pdf = ? WHERE id = ?').run(
      lessonId, audioId, JSON.stringify(segments), sourcePdf, id
    );
  } else {
    db.prepare(
      'INSERT INTO tb_transcripts (id, book_id, lesson_id, audio_id, exercise_label, speaker_segments_json, source_pdf, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(id, bookId, lessonId, audioId, exerciseLabel, JSON.stringify(segments), sourcePdf, new Date().toISOString());
  }
  return id;
}

export function linkExerciseTranscript(exerciseId, transcriptId) {
  db.prepare('INSERT OR IGNORE INTO tb_exercise_transcripts (exercise_id, transcript_id) VALUES (?, ?)').run(exerciseId, transcriptId);
}

// ---------------------------------------------------------------------------
// Job tracking (mirrors pdf_import_jobs's pattern in routes/books.js)
// ---------------------------------------------------------------------------

export function createImportJob({ userId, bookId, lessonNumber, sourceFiles }) {
  const id = crypto.randomUUID();
  db.prepare(
    `INSERT INTO tb_import_jobs (id, user_id, book_id, lesson_number, status, stage, source_files_json, created_at)
     VALUES (?, ?, ?, ?, 'running', 'starting', ?, ?)`
  ).run(id, userId, bookId, lessonNumber, JSON.stringify(sourceFiles || {}), new Date().toISOString());
  return id;
}

export function getImportJob(jobId) {
  const row = db.prepare('SELECT * FROM tb_import_jobs WHERE id = ?').get(jobId);
  if (!row) return null;
  return {
    id: row.id, userId: row.user_id, bookId: row.book_id, lessonNumber: row.lesson_number,
    status: row.status, stage: row.stage, currentPage: row.current_page, totalPages: row.total_pages,
    exercisesFound: row.exercises_found, errors: JSON.parse(row.errors_json), error: row.error || undefined,
    cancelled: !!row.cancelled,
  };
}

function updateImportJob(jobId, fields) {
  const current = db.prepare('SELECT * FROM tb_import_jobs WHERE id = ?').get(jobId);
  if (!current) return;
  const next = {
    status: fields.status ?? current.status,
    stage: fields.stage ?? current.stage,
    current_page: fields.currentPage ?? current.current_page,
    total_pages: fields.totalPages ?? current.total_pages,
    exercises_found: fields.exercisesFound ?? current.exercises_found,
    errors_json: fields.errors ? JSON.stringify(fields.errors) : current.errors_json,
    error: fields.error ?? current.error,
  };
  const finishedAt = next.status === 'running' ? null : new Date().toISOString();
  db.prepare(
    `UPDATE tb_import_jobs SET status = ?, stage = ?, current_page = ?, total_pages = ?, exercises_found = ?, errors_json = ?, error = ?, finished_at = ?
     WHERE id = ?`
  ).run(next.status, next.stage, next.current_page, next.total_pages, next.exercises_found, next.errors_json, next.error, finishedAt, jobId);
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

async function realVisionExtractor({ userId, pagePngBuffer }) {
  const row = db.prepare('SELECT vision_provider, vision_api_key_enc FROM users WHERE id = ?').get(userId);
  if (!row?.vision_provider || !row?.vision_api_key_enc) {
    throw new Error('no vision API key configured — add one in Settings first');
  }
  const apiKey = await decrypt(row.vision_api_key_enc);
  return extractExercisesFromImage({
    provider: row.vision_provider, apiKey, imageBase64: pagePngBuffer.toString('base64'), mimeType: 'image/png',
  });
}

// pdfPath: the uploaded textbook PDF (this lesson's own page range, already
// trimmed to just this lesson - e.g. pages 21-32 of the full coursebook).
// printedPageStart: the printed page number shown on pdfPath's first page.
// transcriptSections: parsed transcript (see parseTranscriptText), or [].
// audioFiles: [{ originalFilename, buffer }], or [].
// visionExtractor: ({userId, pagePngBuffer}) => Promise<{pageHasNoExercises, exercises}>
//   - defaults to the real per-account vision call; tests/demo pass a stub.
export async function runTextbookImport(jobId, {
  userId, bookId, bookTitle, lessonNumber, lessonTitle, pdfPath, printedPageStart,
  transcriptSections = [], audioFiles = [], visionExtractor = realVisionExtractor,
}) {
  const errors = [];
  let exercisesFound = 0;

  try {
    upsertBook({ id: bookId, title: bookTitle });
    const lessonId = upsertLesson({
      bookId, lessonNumber, title: lessonTitle,
      startPage: printedPageStart, endPage: null,
    });

    // Audio files first (deterministic, no AI) - matched to exercises below
    // once each page's audioTrackRef is known.
    const audioByTrack = new Map();
    for (const audio of audioFiles) {
      const trackLabel = parseAudioTrackNumber(audio.originalFilename);
      const filePath = path.join('audio', `${crypto.randomUUID()}.mp3`);
      await fs.mkdir(path.join(TB_MEDIA_DIR, 'audio'), { recursive: true });
      await fs.writeFile(path.join(TB_MEDIA_DIR, filePath), audio.buffer);
      const audioId = upsertAudioFile({ bookId, lessonId, originalFilename: audio.originalFilename, filePath, trackLabel });
      if (trackLabel) audioByTrack.set(trackLabel, audioId);
    }

    // Transcripts (deterministic, no AI) - matched to exercises below once
    // each page's own exerciseNumber is known.
    const transcriptRows = transcriptSections.map((section) => ({
      section,
      id: upsertTranscript({
        bookId, lessonId, audioId: null, exerciseLabel: section.exerciseLabel,
        segments: section.segments, sourcePdf: 'transcript',
      }),
    }));

    const doc = await loadPdf(pdfPath);
    const totalPages = doc.numPages;
    updateImportJob(jobId, { stage: 'extracting_exercises', totalPages });

    let sectionOrderIndex = 0;
    const sectionIdByLetter = new Map();
    let orderIndex = 0;

    for (let pageIndex = 1; pageIndex <= totalPages; pageIndex++) {
      updateImportJob(jobId, { currentPage: pageIndex });
      const printedPage = printedPageStart != null ? printedPageStart + pageIndex - 1 : null;

      let pagePng;
      try {
        pagePng = await renderPdfPageToPng(doc, pageIndex);
      } catch (err) {
        errors.push({ pageIndex, printedPage, error: `Could not render page: ${err.message}` });
        continue;
      }

      let result;
      try {
        result = await visionExtractor({ userId, pagePngBuffer: pagePng, pageIndex, printedPage });
      } catch (err) {
        errors.push({ pageIndex, printedPage, error: `Exercise extraction failed: ${err.message}` });
        continue;
      }

      for (const exercise of result.exercises || []) {
        // Never left as null - see db.js's tb_exercises comment for why a
        // real (if synthetic) section is always resolved, including for the
        // lesson-opener warm-up exercises printed before the first lettered
        // section (A/B/C/D).
        const sectionLetter = exercise.sectionLetter || UNNUMBERED_SECTION_LETTER;
        if (!sectionIdByLetter.has(sectionLetter)) {
          sectionIdByLetter.set(
            sectionLetter,
            upsertSection({ lessonId, sectionLetter, title: exercise.sectionTitle || null, orderIndex: sectionOrderIndex++ })
          );
        }
        const sectionId = sectionIdByLetter.get(sectionLetter);

        let content;
        try {
          content = JSON.parse(exercise.contentJson || '{}');
        } catch {
          content = { raw: exercise.contentJson };
          errors.push({ pageIndex, printedPage, exerciseNumber: exercise.exerciseNumber, error: 'contentJson was not valid JSON; stored as raw text for manual review' });
        }

        const exerciseId = upsertExercise({
          bookId, lessonId, sectionId,
          exerciseNumber: exercise.exerciseNumber, subNumber: exercise.subNumber || '',
          printedPage, pdfPageIndex: pageIndex - 1,
          exerciseType: exercise.exerciseType, instructions: exercise.instructions,
          content, extractionConfidence: exercise.confidence ?? null,
          extractionSource: exercise.extractionSource || 'ai', orderIndex: orderIndex++,
        });
        exercisesFound += 1;

        clearExerciseImages(exerciseId);
        for (const [imgIndex, box] of (exercise.images || []).entries()) {
          try {
            const cropped = await cropImageRegion(pagePng, box);
            const filePath = path.join('images', `${crypto.randomUUID()}.png`);
            await fs.mkdir(path.join(TB_MEDIA_DIR, 'images'), { recursive: true });
            await fs.writeFile(path.join(TB_MEDIA_DIR, filePath), cropped);
            addExerciseImage({ exerciseId, filePath, caption: box.caption || null, orderIndex: imgIndex });
          } catch (err) {
            errors.push({ pageIndex, printedPage, exerciseNumber: exercise.exerciseNumber, error: `Image crop failed: ${err.message}` });
          }
        }

        if (exercise.audioTrackRef && audioByTrack.has(exercise.audioTrackRef)) {
          linkExerciseAudio(exerciseId, audioByTrack.get(exercise.audioTrackRef));
        }

        for (const { section, id: transcriptId } of transcriptRows) {
          if (transcriptSectionMatchesExercise(section, exercise.exerciseNumber)) {
            linkExerciseTranscript(exerciseId, transcriptId);
          }
        }
      }

      updateImportJob(jobId, { exercisesFound, errors });
    }

    updateImportJob(jobId, { status: 'completed', stage: 'done', exercisesFound, errors });
    return { bookId, lessonId, exercisesFound, errors };
  } catch (err) {
    updateImportJob(jobId, { status: 'failed', error: err.message, errors });
    throw err;
  }
}
