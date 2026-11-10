// Private textbook import module (Step 1): upload a lesson's textbook PDF +
// transcript PDF + MP3s, run the import, review/correct uncertain exercises.
// Mounted with requireAuth in index.js, same as every other content route -
// nothing here is reachable without a session, and extracted media is only
// ever served through GET /media/:id below (never a static/public path).

import { Router } from 'express';
import multer from 'multer';
import path from 'node:path';
import crypto from 'node:crypto';
import { promises as fs } from 'node:fs';
import { db } from '../db.js';
import {
  TB_MEDIA_DIR,
  createImportJob,
  getImportJob,
  runTextbookImport,
  parseTranscriptLines,
} from '../textbookImporter.js';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 60 * 1024 * 1024, files: 10 } });

const jobRunners = new Map(); // in-memory promise per active job, same pattern as routes/books.js's pdfJobs

async function extractPdfTextLines(buffer) {
  const doc = await getDocument({ data: new Uint8Array(buffer) }).promise;
  const lines = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    // pdfjs text items don't carry line breaks; a new line in the printed
    // page is where its vertical (transform[5]) position drops from the
    // previous item's - good enough for this transcript PDF's simple layout
    // (one printed line per paragraph line, no multi-column text).
    let lastY = null;
    let current = '';
    for (const item of content.items) {
      const y = item.transform[5];
      if (lastY !== null && Math.abs(y - lastY) > 1) {
        lines.push(current);
        current = '';
      }
      current += item.str;
      lastY = y;
    }
    if (current) lines.push(current);
  }
  return lines;
}

// POST /api/textbooks/import (multipart: textbookPdf, transcriptPdf?, audio[] (0-8 files),
// bookId, bookTitle, lessonNumber, lessonTitle, printedPageStart)
router.post(
  '/import',
  upload.fields([
    { name: 'textbookPdf', maxCount: 1 },
    { name: 'transcriptPdf', maxCount: 1 },
    { name: 'audio', maxCount: 8 },
  ]),
  async (req, res) => {
    const textbookPdf = req.files?.textbookPdf?.[0];
    if (!textbookPdf) return res.status(400).json({ error: 'textbookPdf is required' });

    const bookId = (req.body?.bookId || '').trim();
    const bookTitle = (req.body?.bookTitle || '').trim();
    const lessonNumber = Number(req.body?.lessonNumber);
    const lessonTitle = (req.body?.lessonTitle || '').trim();
    const printedPageStart = req.body?.printedPageStart ? Number(req.body.printedPageStart) : null;
    if (!bookId || !bookTitle || !Number.isFinite(lessonNumber) || !lessonTitle) {
      return res.status(400).json({ error: 'bookId, bookTitle, lessonNumber and lessonTitle are required' });
    }

    let transcriptSections = [];
    if (req.files?.transcriptPdf?.[0]) {
      try {
        const lines = await extractPdfTextLines(req.files.transcriptPdf[0].buffer);
        transcriptSections = parseTranscriptLines(lines);
      } catch (err) {
        return res.status(400).json({ error: `Could not read transcript PDF: ${err.message}` });
      }
    }

    const audioFiles = (req.files?.audio || []).map((f) => ({ originalFilename: f.originalname, buffer: f.buffer }));

    const sourceDir = path.join(TB_MEDIA_DIR, 'source-uploads', crypto.randomUUID());
    await fs.mkdir(sourceDir, { recursive: true });
    const pdfPath = path.join(sourceDir, 'textbook.pdf');
    await fs.writeFile(pdfPath, textbookPdf.buffer);

    const jobId = createImportJob({
      userId: req.userId, bookId, lessonNumber,
      sourceFiles: { pdfPath, audioCount: audioFiles.length, hasTranscript: transcriptSections.length > 0 },
    });

    const runPromise = runTextbookImport(jobId, {
      userId: req.userId, bookId, bookTitle, lessonNumber, lessonTitle,
      pdfPath, printedPageStart, transcriptSections, audioFiles,
    })
      .catch((err) => console.error(`Textbook import job ${jobId} failed:`, err))
      .finally(async () => {
        jobRunners.delete(jobId);
        await fs.rm(sourceDir, { recursive: true, force: true }).catch(() => {});
      });
    jobRunners.set(jobId, runPromise);

    res.json({ jobId });
  }
);

router.get('/import/:jobId', (req, res) => {
  const job = getImportJob(req.params.jobId);
  if (!job || job.userId !== req.userId) return res.status(404).json({ error: 'not found' });
  res.json(job);
});

// GET /api/textbooks/:bookId/lessons/:lessonNumber/exercises?needsReview=1
router.get('/:bookId/lessons/:lessonNumber/exercises', (req, res) => {
  const lesson = db
    .prepare('SELECT id FROM tb_lessons WHERE book_id = ? AND lesson_number = ?')
    .get(req.params.bookId, Number(req.params.lessonNumber));
  if (!lesson) return res.json({ exercises: [] });

  const onlyNeedsReview = req.query.needsReview === '1';
  const rows = db
    .prepare(
      `SELECT * FROM tb_exercises WHERE lesson_id = ? ${onlyNeedsReview ? 'AND needs_review = 1' : ''} ORDER BY order_index`
    )
    .all(lesson.id);

  const exercises = rows.map((row) => ({
    id: row.id,
    exerciseNumber: row.exercise_number,
    subNumber: row.sub_number,
    printedPage: row.printed_page,
    exerciseType: row.exercise_type,
    instructions: row.instructions,
    content: JSON.parse(row.content_json),
    answerKey: row.answer_key_json ? JSON.parse(row.answer_key_json) : null,
    answerKeyVerified: !!row.answer_key_verified,
    extractionConfidence: row.extraction_confidence,
    extractionSource: row.extraction_source,
    needsReview: !!row.needs_review,
    images: db
      .prepare('SELECT id, caption, order_index FROM tb_exercise_images WHERE exercise_id = ? ORDER BY order_index')
      .all(row.id),
    audio: db
      .prepare(
        `SELECT a.id, a.original_filename FROM tb_audio_files a
         JOIN tb_exercise_audio ea ON ea.audio_id = a.id WHERE ea.exercise_id = ?`
      )
      .all(row.id),
    transcripts: db
      .prepare(
        `SELECT t.id, t.exercise_label, t.speaker_segments_json FROM tb_transcripts t
         JOIN tb_exercise_transcripts et ON et.transcript_id = t.id WHERE et.exercise_id = ?`
      )
      .all(row.id)
      .map((t) => ({ id: t.id, exerciseLabel: t.exercise_label, segments: JSON.parse(t.speaker_segments_json) })),
  }));

  res.json({ exercises });
});

// PATCH /api/textbooks/exercises/:id - employee review/correction. Only the
// fields a reviewer is meant to touch; never recomputes extraction_confidence
// or extraction_source (those describe how the data got here, not what it
// should say - editing content doesn't retroactively make the AI more sure).
router.patch('/exercises/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM tb_exercises WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'not found' });

  const fields = { instructions: existing.instructions, content_json: existing.content_json, answer_key_json: existing.answer_key_json, answer_key_verified: existing.answer_key_verified, needs_review: existing.needs_review };
  if (typeof req.body?.instructions === 'string') fields.instructions = req.body.instructions;
  if (req.body?.content !== undefined) fields.content_json = JSON.stringify(req.body.content);
  if (req.body?.answerKey !== undefined) fields.answer_key_json = req.body.answerKey === null ? null : JSON.stringify(req.body.answerKey);
  if (typeof req.body?.answerKeyVerified === 'boolean') fields.answer_key_verified = req.body.answerKeyVerified ? 1 : 0;
  if (typeof req.body?.needsReview === 'boolean') fields.needs_review = req.body.needsReview ? 1 : 0;

  db.prepare(
    'UPDATE tb_exercises SET instructions = ?, content_json = ?, answer_key_json = ?, answer_key_verified = ?, needs_review = ?, extraction_source = ?, updated_at = ? WHERE id = ?'
  ).run(
    fields.instructions, fields.content_json, fields.answer_key_json, fields.answer_key_verified, fields.needs_review,
    'manual', new Date().toISOString(), req.params.id
  );
  res.json({ ok: true });
});

// GET /api/textbooks/media/:id - streams a private image or audio file. The
// id is an tb_exercise_images.id or tb_audio_files.id, never a raw filesystem
// path, so a caller can't traverse outside TB_MEDIA_DIR even in principle.
router.get('/media/:id', async (req, res) => {
  const image = db.prepare('SELECT file_path FROM tb_exercise_images WHERE id = ?').get(req.params.id);
  const audio = image ? null : db.prepare('SELECT file_path, original_filename FROM tb_audio_files WHERE id = ?').get(req.params.id);
  const row = image || audio;
  if (!row) return res.status(404).json({ error: 'not found' });

  const absolutePath = path.join(TB_MEDIA_DIR, row.file_path);
  try {
    const data = await fs.readFile(absolutePath);
    res.setHeader('Content-Type', image ? 'image/png' : 'audio/mpeg');
    res.send(data);
  } catch {
    res.status(404).json({ error: 'media file missing on disk' });
  }
});

export default router;
