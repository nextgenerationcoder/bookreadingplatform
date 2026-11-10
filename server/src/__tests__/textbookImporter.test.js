import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { promises as fs } from 'node:fs';
import { PDFDocument, rgb } from 'pdf-lib';

// db.js opens DB_PATH as soon as it's imported, so this must be set before
// ANY module that (transitively) imports it is loaded - including
// textbookImporter.js. Static imports are hoisted above this in an ES
// module, so every such import below is a dynamic import() instead.
const TEST_DB_DIR = await fs.mkdtemp(path.join(os.tmpdir(), 'tb-importer-test-'));
process.env.DB_PATH = path.join(TEST_DB_DIR, 'test.db');

const {
  parseTranscriptLines,
  parseAudioTrackNumber,
  transcriptSectionMatchesExercise,
  upsertBook,
  upsertLesson,
  upsertSection,
  upsertExercise,
  cropImageRegion,
  runTextbookImport,
  createImportJob,
  getImportJob,
  TB_MEDIA_DIR,
} = await import('../textbookImporter.js');
const { db } = await import('../db.js');

test.after(async () => {
  db.close();
  await fs.rm(TEST_DB_DIR, { recursive: true, force: true });
  await fs.rm(TB_MEDIA_DIR, { recursive: true, force: true }).catch(() => {});
});

// ---------------------------------------------------------------------------
// Deterministic: transcript parsing (real excerpt from the actual
// "Starten wir! B1, Transkriptionen Kursbuch" Lesson 2 PDF text layer)
// ---------------------------------------------------------------------------

const REAL_TRANSCRIPT_EXCERPT = `
Transkriptionen Kursbuch
Lektion 2
Starten wir! Aufgabe 2
Florian: Du, Lisa. Was ist los? Warum bist du nicht im Bett?
Lisa: Ich konnte einfach nicht schlafen und
da …
Florian: Sag mal, was siehst du denn da? Ist das nicht …?

Aufgabe 3, 4 und 6
Florian: Puh, das war ein langer Tag, endlich Feierabend.
Lisa: Ja, wieso nicht? Einverstanden!
`;

test('parseTranscriptLines keys sections by their "Aufgabe" heading, preserving speaker labels', () => {
  const sections = parseTranscriptLines(REAL_TRANSCRIPT_EXCERPT.split('\n'));

  assert.equal(sections.length, 2);
  assert.equal(sections[0].exerciseLabel, 'Aufgabe 2');
  assert.equal(sections[0].lessonNumber, 2);
  assert.deepEqual(sections[0].segments[0], { speaker: 'Florian', text: 'Du, Lisa. Was ist los? Warum bist du nicht im Bett?' });

  assert.equal(sections[1].exerciseLabel, 'Aufgabe 3, 4 und 6');
});

test('parseTranscriptLines joins a wrapped continuation line onto the same speaker, not a new one', () => {
  const sections = parseTranscriptLines(REAL_TRANSCRIPT_EXCERPT.split('\n'));
  const lisaLine = sections[0].segments.find((s) => s.speaker === 'Lisa');
  assert.equal(lisaLine.text, 'Ich konnte einfach nicht schlafen und da …');
});

test('parseTranscriptLines never invents a section before the first Aufgabe heading', () => {
  const sections = parseTranscriptLines(['Transkriptionen Kursbuch', 'Starten wir! B1, ISBN ...', 'Lektion 2']);
  assert.deepEqual(sections, []);
});

test('transcriptSectionMatchesExercise matches an exact number within a combined label', () => {
  const section = { exerciseLabel: 'Aufgabe 3, 4 und 6', segments: [] };
  assert.equal(transcriptSectionMatchesExercise(section, '4'), true);
  assert.equal(transcriptSectionMatchesExercise(section, 6), true);
  assert.equal(transcriptSectionMatchesExercise(section, '5'), false);
});

// ---------------------------------------------------------------------------
// Deterministic: audio filename -> track number
// ---------------------------------------------------------------------------

test('parseAudioTrackNumber reads the track number, not the CD/unit prefix', () => {
  assert.equal(parseAudioTrackNumber('1_04_Starten_wir_B1_L2_SW_2.mp3'), '4');
  assert.equal(parseAudioTrackNumber('1_05_Starten_wir_B1_L2_B_3_4_6.mp3'), '5');
  assert.equal(parseAudioTrackNumber('1_11_anything.mp3'), '11');
});

test('parseAudioTrackNumber returns null for a filename with no recognizable track number', () => {
  assert.equal(parseAudioTrackNumber('cover-photo.jpg'), null);
});

// ---------------------------------------------------------------------------
// Idempotent upserts
// ---------------------------------------------------------------------------

test('upsertExercise on the same natural key updates the row instead of duplicating it', () => {
  const bookId = 'book-' + crypto.randomUUID();
  upsertBook({ id: bookId, title: 'Starten wir! B1' });
  const lessonId = upsertLesson({ bookId, lessonNumber: 2, title: 'Paare, Serien & mehr' });
  const sectionId = upsertSection({ lessonId, sectionLetter: 'A', title: 'Fremdschauen' });

  const firstId = upsertExercise({
    bookId, lessonId, sectionId, exerciseNumber: '2', subNumber: '', printedPage: 22,
    exerciseType: 'reading', instructions: 'Zu zweit.', content: { passage: 'first pass' },
  });
  const secondId = upsertExercise({
    bookId, lessonId, sectionId, exerciseNumber: '2', subNumber: '', printedPage: 22,
    exerciseType: 'reading', instructions: 'Zu zweit. Lesen Sie 1 noch einmal.', content: { passage: 'corrected pass' },
  });

  assert.equal(firstId, secondId);
  const rows = db.prepare('SELECT * FROM tb_exercises WHERE book_id = ?').all(bookId);
  assert.equal(rows.length, 1);
  assert.equal(JSON.parse(rows[0].content_json).passage, 'corrected pass');
});

test('upsertExercise keeps sub_number distinct rows separate', () => {
  const bookId = 'book-' + crypto.randomUUID();
  upsertBook({ id: bookId, title: 'Starten wir! B1' });
  const lessonId = upsertLesson({ bookId, lessonNumber: 2, title: 'Paare, Serien & mehr' });
  const sectionId = upsertSection({ lessonId, sectionLetter: 'A', title: 'Fremdschauen' });

  upsertExercise({ bookId, lessonId, sectionId, exerciseNumber: '4', subNumber: '1', exerciseType: 'true_false', content: {} });
  upsertExercise({ bookId, lessonId, sectionId, exerciseNumber: '4', subNumber: '2', exerciseType: 'true_false', content: {} });

  const rows = db.prepare('SELECT * FROM tb_exercises WHERE book_id = ? AND exercise_number = ?').all(bookId, '4');
  assert.equal(rows.length, 2);
});

// ---------------------------------------------------------------------------
// Deterministic: image region cropping
// ---------------------------------------------------------------------------

test('cropImageRegion crops the requested fraction of the page to the expected pixel size', async () => {
  const { createCanvas } = await import('@napi-rs/canvas');
  const canvas = createCanvas(200, 100);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = 'red';
  ctx.fillRect(0, 0, 200, 100);
  const pageBuffer = canvas.toBuffer('image/png');

  const cropped = await cropImageRegion(pageBuffer, { x0: 0.5, y0: 0, x1: 1, y1: 1, caption: '' });
  const { loadImage } = await import('@napi-rs/canvas');
  const croppedImg = await loadImage(cropped);
  assert.equal(croppedImg.width, 100);
  assert.equal(croppedImg.height, 100);
});

// ---------------------------------------------------------------------------
// Full pipeline, against a small real PDF built on the fly, with a stub
// vision extractor (no paid API call) - and a second run proving idempotency.
// ---------------------------------------------------------------------------

async function makeTwoPagePdf() {
  const pdf = await PDFDocument.create();
  const page1 = pdf.addPage([600, 800]);
  page1.drawRectangle({ x: 50, y: 600, width: 200, height: 150, color: rgb(0.8, 0.2, 0.2) });
  pdf.addPage([600, 800]);
  const bytes = await pdf.save();
  return Buffer.from(bytes);
}

function stubVisionExtractor(pageIndex) {
  if (pageIndex === 1) {
    return {
      pageHasNoExercises: false,
      exercises: [
        {
          exerciseNumber: '1', subNumber: '', sectionLetter: 'A', sectionTitle: 'Fremdschauen',
          exerciseType: 'reading', instructions: 'Lesen Sie den Text.',
          contentJson: JSON.stringify({ passage: 'Serien - die Liebe und der Streit...' }),
          images: [{ x0: 0.05, y0: 0.1, x1: 0.4, y1: 0.3, caption: '' }],
          audioTrackRef: '', confidence: 0.9,
        },
        {
          exerciseNumber: '2', subNumber: '', sectionLetter: 'A', sectionTitle: 'Fremdschauen',
          exerciseType: 'true_false',
          instructions: 'Hören Sie und vergleichen Sie.',
          contentJson: JSON.stringify({ questions: [{ number: '1', text: 'Viele Leute gucken Serien', options: ['während der Arbeitszeit', 'in ihrer Freizeit'] }] }),
          images: [], audioTrackRef: '4', confidence: 0.85,
        },
      ],
    };
  }
  return { pageHasNoExercises: true, exercises: [] };
}

test('runTextbookImport persists exercises/images/audio/transcript links and is idempotent on retry', async () => {
  const pdfBytes = await makeTwoPagePdf();
  const tmpPdfPath = path.join(TEST_DB_DIR, 'lesson.pdf');
  await fs.writeFile(tmpPdfPath, pdfBytes);

  const bookId = 'book-' + crypto.randomUUID();
  const transcriptSections = parseTranscriptLines(REAL_TRANSCRIPT_EXCERPT.split('\n'));
  const audioFiles = [{ originalFilename: '1_04_Starten_wir_B1_L2_SW_2.mp3', buffer: Buffer.from('fake mp3 bytes') }];

  async function runOnce() {
    const jobId = createImportJob({ userId: 'user-1', bookId, lessonNumber: 2, sourceFiles: {} });
    const result = await runTextbookImport(jobId, {
      userId: 'user-1', bookId, bookTitle: 'Starten wir! B1', lessonNumber: 2, lessonTitle: 'Paare, Serien & mehr',
      pdfPath: tmpPdfPath, printedPageStart: 21, transcriptSections, audioFiles,
      visionExtractor: ({ pageIndex }) => stubVisionExtractor(pageIndex),
    });
    return { jobId, result };
  }

  const first = await runOnce();
  assert.equal(first.result.exercisesFound, 2);
  assert.deepEqual(first.result.errors, []);

  const job = getImportJob(first.jobId);
  assert.equal(job.status, 'completed');

  const exerciseRows = db.prepare('SELECT * FROM tb_exercises WHERE book_id = ? ORDER BY exercise_number').all(bookId);
  assert.equal(exerciseRows.length, 2);
  assert.equal(exerciseRows[0].exercise_type, 'reading');
  assert.equal(exerciseRows[0].printed_page, 21);

  const imageRows = db.prepare('SELECT * FROM tb_exercise_images WHERE exercise_id = ?').all(exerciseRows[0].id);
  assert.equal(imageRows.length, 1);
  const imageStat = await fs.stat(path.join(TB_MEDIA_DIR, imageRows[0].file_path));
  assert.ok(imageStat.size > 0, 'cropped image file was actually written to disk');

  const audioLinkRows = db.prepare('SELECT * FROM tb_exercise_audio WHERE exercise_id = ?').all(exerciseRows[1].id);
  assert.equal(audioLinkRows.length, 1);

  const transcriptLinkRows = db.prepare('SELECT * FROM tb_exercise_transcripts WHERE exercise_id = ?').all(exerciseRows[1].id);
  assert.equal(transcriptLinkRows.length, 1, 'exercise 2\'s transcript ("Aufgabe 2") was matched');

  // --- retry: must not duplicate anything ---
  await runOnce();
  const exerciseRowsAfterRetry = db.prepare('SELECT * FROM tb_exercises WHERE book_id = ?').all(bookId);
  assert.equal(exerciseRowsAfterRetry.length, 2, 'retrying the import did not duplicate exercises');

  const audioRowsAfterRetry = db.prepare('SELECT * FROM tb_audio_files WHERE book_id = ?').all(bookId);
  assert.equal(audioRowsAfterRetry.length, 1, 'retrying the import did not duplicate the audio file row');

  const transcriptRowsAfterRetry = db.prepare('SELECT * FROM tb_transcripts WHERE book_id = ?').all(bookId);
  assert.equal(transcriptRowsAfterRetry.length, 2, 'retrying the import did not duplicate transcript rows');
});

test('runTextbookImport never collapses two different sections\' exercise "2" into one row (real Lesson 2 bug)', async () => {
  // This textbook restarts numbering per lettered section - section A has its
  // own exercise "2" and so does a later section; a natural key that doesn't
  // include the section silently overwrites one with the other.
  const pdf = await PDFDocument.create();
  pdf.addPage([600, 800]);
  pdf.addPage([600, 800]);
  const tmpPdfPath = path.join(TEST_DB_DIR, 'two-sections.pdf');
  await fs.writeFile(tmpPdfPath, Buffer.from(await pdf.save()));

  const bookId = 'book-' + crypto.randomUUID();
  const jobId = createImportJob({ userId: 'user-1', bookId, lessonNumber: 2, sourceFiles: {} });

  await runTextbookImport(jobId, {
    userId: 'user-1', bookId, bookTitle: 'Starten wir! B1', lessonNumber: 2, lessonTitle: 'Paare, Serien & mehr',
    pdfPath: tmpPdfPath, printedPageStart: 21, transcriptSections: [],
    audioFiles: [{ originalFilename: '1_04_track.mp3', buffer: Buffer.from('fake mp3') }],
    visionExtractor: ({ pageIndex }) => ({
      pageHasNoExercises: false,
      exercises: [
        {
          exerciseNumber: '2', subNumber: '', sectionLetter: pageIndex === 1 ? 'A' : 'B',
          sectionTitle: pageIndex === 1 ? 'Fremdschauen' : 'Streiten und gemeinsam planen',
          exerciseType: pageIndex === 1 ? 'listening' : 'matching',
          instructions: `exercise 2 on page ${pageIndex}`,
          contentJson: JSON.stringify({ page: pageIndex }),
          images: [], audioTrackRef: pageIndex === 1 ? '4' : '', confidence: 1,
        },
      ],
    }),
  });

  const rows = db.prepare('SELECT * FROM tb_exercises WHERE book_id = ? AND exercise_number = ?').all(bookId, '2');
  assert.equal(rows.length, 2, 'both sections\' exercise 2 must exist as separate rows');
  const types = rows.map((r) => r.exercise_type).sort();
  assert.deepEqual(types, ['listening', 'matching']);

  const audioLinkRows = db.prepare('SELECT * FROM tb_exercise_audio WHERE exercise_id = ?').all(
    rows.find((r) => r.exercise_type === 'listening').id
  );
  assert.equal(audioLinkRows.length, 1, 'section A\'s exercise 2 keeps its own audio link, unaffected by section B\'s exercise 2');
});

test('runTextbookImport records a page-level error without aborting the whole import', async () => {
  const pdfBytes = await makeTwoPagePdf();
  const tmpPdfPath = path.join(TEST_DB_DIR, 'lesson-with-error.pdf');
  await fs.writeFile(tmpPdfPath, pdfBytes);

  const bookId = 'book-' + crypto.randomUUID();
  const jobId = createImportJob({ userId: 'user-1', bookId, lessonNumber: 2, sourceFiles: {} });

  const result = await runTextbookImport(jobId, {
    userId: 'user-1', bookId, bookTitle: 'Starten wir! B1', lessonNumber: 2, lessonTitle: 'Paare, Serien & mehr',
    pdfPath: tmpPdfPath, printedPageStart: 21, transcriptSections: [], audioFiles: [],
    visionExtractor: ({ pageIndex }) => {
      if (pageIndex === 1) throw new Error('vision API rate limited');
      return stubVisionExtractor(pageIndex);
    },
  });

  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0].error, /rate limited/);
  const job = getImportJob(jobId);
  assert.equal(job.status, 'completed'); // the job as a whole still finishes
});
