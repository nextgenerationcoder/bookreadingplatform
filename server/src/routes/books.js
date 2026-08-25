import { Router } from 'express';
import multer from 'multer';
import crypto from 'node:crypto';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import {
  parseBookText,
  saveImportedBook,
  appendToBook,
  renameBook,
  deletePage,
  listBooks,
  getBook,
} from '../bookImporter.js';
import { db, DB_PATH } from '../db.js';
import { decrypt } from '../crypto.js';
import { importPdfAsBook } from '../pdfImport.js';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 40 * 1024 * 1024 } });

// Live job state for jobs actively running in *this* process (fast status
// polling, and the flag a running loop checks to cancel itself). The
// pdf_import_jobs DB table is the durable copy - progress is written there
// on every page - so a job survives a server restart: resumePendingPdfJobs()
// (called once at server boot, from index.js) picks up any row still marked
// "running" and continues it from the last saved page, using the PDF file
// that was written to disk when the import started.
const pdfJobs = new Map();

const PDF_STORE_DIR = path.join(path.dirname(DB_PATH), 'pdf-imports');
await fs.mkdir(PDF_STORE_DIR, { recursive: true });

function jobFromRow(row) {
  return {
    userId: row.user_id,
    status: row.status,
    bookId: row.book_id,
    currentPage: row.current_page,
    totalPages: row.total_pages,
    pagesFound: row.pages_found,
    errors: JSON.parse(row.errors_json),
    error: row.error || undefined,
    cancelled: !!row.cancelled,
  };
}

function persistJob(jobId, job) {
  db.prepare(`
    UPDATE pdf_import_jobs
    SET status = ?, current_page = ?, total_pages = ?, pages_found = ?, errors_json = ?, error = ?, cancelled = ?
    WHERE id = ?
  `).run(job.status, job.currentPage, job.totalPages, job.pagesFound, JSON.stringify(job.errors), job.error || null, job.cancelled ? 1 : 0, jobId);
}

// Runs (or resumes) one PDF import job to completion, keeping the in-memory
// and DB copies of its state in sync throughout, then cleans up.
async function runPdfImportJob(jobId, job, { pdfPath, text, bookId, title, startPage, chapter, resumeFromIndex, initialPagesFound, initialErrors }) {
  pdfJobs.set(jobId, job);
  try {
    const pdfBuffer = await fs.readFile(pdfPath);
    const result = await importPdfAsBook({
      pdfBuffer,
      text,
      bookId,
      title,
      startPage,
      chapter,
      resumeFromIndex,
      initialPagesFound,
      initialErrors,
      onProgress: (p) => {
        if (job.cancelled) throw new Error('CANCELLED');
        job.currentPage = p.currentPage;
        job.totalPages = p.totalPages;
        job.pagesFound = p.pagesFound;
        job.errors = p.errors;
        persistJob(jobId, job);
      },
    });
    job.status = 'done';
    job.pagesFound = result.pagesFound;
    job.totalPages = result.totalPages;
    job.errors = result.errors;
  } catch (err) {
    if (err.message === 'CANCELLED') {
      job.status = 'cancelled';
    } else {
      console.error('PDF import failed:', err);
      job.status = 'error';
      job.error = err.message;
    }
  }
  persistJob(jobId, job);
  await fs.rm(pdfPath, { force: true });
  // Keep finished job state around briefly for the client to pick up on its
  // next poll, then free it up - no need to keep it forever.
  setTimeout(() => {
    pdfJobs.delete(jobId);
    db.prepare('DELETE FROM pdf_import_jobs WHERE id = ?').run(jobId);
  }, 10 * 60 * 1000);
}

// Called once at server startup (see index.js). Any job still marked
// "running" in the DB means the process died mid-import (redeploy, crash,
// OOM, etc.) - resume each from its last saved page using the PDF that was
// written to disk when it started. Pages already saved to the book are
// safe to redo (appendToBook replaces by page number), but resuming from
// the last recorded page instead of page 1 avoids redoing an entire book's
// worth of AI calls.
export async function resumePendingPdfJobs() {
  const rows = db.prepare("SELECT * FROM pdf_import_jobs WHERE status = 'running'").all();
  for (const row of rows) {
    const pdfExists = await fs.access(row.pdf_path).then(() => true).catch(() => false);
    if (!pdfExists) {
      db.prepare('UPDATE pdf_import_jobs SET status = ?, error = ? WHERE id = ?')
        .run('error', 'Import was interrupted and the uploaded PDF is no longer available - please re-upload.', row.id);
      continue;
    }
    const userRow = db.prepare('SELECT llm_provider, llm_api_key_enc FROM users WHERE id = ?').get(row.user_id);
    if (!userRow?.llm_provider || !userRow?.llm_api_key_enc) {
      db.prepare('UPDATE pdf_import_jobs SET status = ?, error = ? WHERE id = ?')
        .run('error', 'Import was interrupted and the Translation API key is no longer configured.', row.id);
      continue;
    }
    console.log(`Resuming PDF import job ${row.id} for book "${row.book_id}" from page ${row.current_page}`);
    const job = jobFromRow(row);
    job.status = 'running';
    const textApiKey = await decrypt(userRow.llm_api_key_enc);
    runPdfImportJob(row.id, job, {
      pdfPath: row.pdf_path,
      text: { provider: userRow.llm_provider, apiKey: textApiKey },
      bookId: row.book_id,
      title: row.title || '',
      startPage: row.start_page,
      chapter: row.chapter || '',
      resumeFromIndex: Math.max(1, row.current_page),
      initialPagesFound: row.pages_found,
      initialErrors: JSON.parse(row.errors_json),
    }).catch((err) => console.error(`Failed to resume PDF import job ${row.id}:`, err));
  }
}

router.post('/import-pdf/:jobId/cancel', (req, res) => {
  const job = pdfJobs.get(req.params.jobId);
  if (job) {
    if (job.userId !== req.userId) return res.status(404).json({ error: 'job not found' });
    job.cancelled = true;
    persistJob(req.params.jobId, job);
    return res.json({ ok: true });
  }
  // Not running in this process right now (e.g. briefly during a resume) -
  // flag it in the DB so the resume path checks and stops.
  const row = db.prepare('SELECT user_id FROM pdf_import_jobs WHERE id = ?').get(req.params.jobId);
  if (!row || row.user_id !== req.userId) return res.status(404).json({ error: 'job not found' });
  db.prepare('UPDATE pdf_import_jobs SET cancelled = 1 WHERE id = ?').run(req.params.jobId);
  res.json({ ok: true });
});

router.get('/import-pdf/:jobId/status', (req, res) => {
  const job = pdfJobs.get(req.params.jobId);
  if (job) {
    if (job.userId !== req.userId) return res.status(404).json({ error: 'job not found' });
    const { userId: _userId, cancelled: _cancelled, ...publicState } = job;
    return res.json(publicState);
  }
  const row = db.prepare('SELECT * FROM pdf_import_jobs WHERE id = ?').get(req.params.jobId);
  if (!row || row.user_id !== req.userId) return res.status(404).json({ error: 'job not found' });
  const { userId: _userId, cancelled: _cancelled, ...publicState } = jobFromRow(row);
  res.json(publicState);
});

router.get('/', (_req, res) => {
  res.json(listBooks());
});

// POST /api/books/import { text } — parses the plain-text ingestion format
// (see server/src/bookImporter.js) and creates/updates a book from it.
router.post('/import', (req, res) => {
  const { text } = req.body || {};
  if (!text || typeof text !== 'string') {
    return res.status(400).json({ error: 'text is required' });
  }
  let book;
  try {
    book = parseBookText(text);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
  const meta = saveImportedBook(book);
  res.status(201).json(meta);
});

// POST /api/books/import-pdf (multipart: "pdf" file, + bookId, title,
// startPage, chapter) — kicks off background processing and returns
// immediately with a jobId; poll GET .../import-pdf/:jobId/status for
// progress. Pages with a real text layer are translated+formatted via the
// account's Translation key. Pages with no extractable text (scanned
// images) are OCR'd for free with local Tesseract, then translated the
// same way. Each page is saved to the book as soon as it's done, so the
// book can already be opened and read while later pages are still
// processing.
router.post('/import-pdf', upload.single('pdf'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'a PDF file is required' });
  const { bookId, title, chapter } = req.body || {};
  if (!bookId || typeof bookId !== 'string' || !bookId.trim()) {
    return res.status(400).json({ error: 'bookId is required' });
  }
  const startPage = Number(req.body?.startPage);
  if (!Number.isFinite(startPage)) return res.status(400).json({ error: 'startPage must be a number' });

  const row = db.prepare('SELECT llm_provider, llm_api_key_enc FROM users WHERE id = ?').get(req.userId);
  if (!row?.llm_provider || !row?.llm_api_key_enc) {
    return res.status(400).json({ error: 'no Translation API key configured — add one in Settings first' });
  }

  const jobId = crypto.randomUUID();
  const pdfPath = path.join(PDF_STORE_DIR, `${jobId}.pdf`);
  await fs.writeFile(pdfPath, req.file.buffer);

  const trimmedBookId = bookId.trim();
  const trimmedTitle = (title || '').trim();
  const trimmedChapter = (chapter || '').trim();

  db.prepare(`
    INSERT INTO pdf_import_jobs (id, user_id, book_id, title, chapter, start_page, pdf_path, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'running', ?)
  `).run(jobId, req.userId, trimmedBookId, trimmedTitle, trimmedChapter, startPage, pdfPath, new Date().toISOString());

  const job = {
    userId: req.userId,
    status: 'running',
    bookId: trimmedBookId,
    currentPage: 0,
    totalPages: null,
    pagesFound: 0,
    errors: [],
    cancelled: false,
  };
  res.status(202).json({ jobId, bookId: job.bookId });

  const textApiKey = await decrypt(row.llm_api_key_enc);
  // Runs in the background - saved to disk and to the DB above, so it
  // survives this request ending, the client disconnecting or logging out,
  // and even a server restart (resumePendingPdfJobs() picks it back up).
  runPdfImportJob(jobId, job, {
    pdfPath,
    text: { provider: row.llm_provider, apiKey: textApiKey },
    bookId: job.bookId,
    title: trimmedTitle,
    startPage,
    chapter: trimmedChapter,
    resumeFromIndex: 1,
    initialPagesFound: 0,
    initialErrors: [],
  });
});

router.get('/:bookId', (req, res) => {
  const book = getBook(req.params.bookId);
  if (!book) return res.status(404).json({ error: 'book not found' });
  res.json(book);
});

// POST /api/books/:bookId/append { text } — parses `text` as extra
// PAGE/CHAPTER/sentence blocks (BOOK:/TITLE:/LANG: inherited from the
// existing book) and merges the resulting pages into it.
router.post('/:bookId/append', (req, res) => {
  const { text } = req.body || {};
  if (!text || typeof text !== 'string') {
    return res.status(400).json({ error: 'text is required' });
  }
  try {
    const meta = appendToBook(req.params.bookId, text);
    res.json(meta);
  } catch (err) {
    const status = err.message.includes('not found') ? 404 : 400;
    res.status(status).json({ error: err.message });
  }
});

// PATCH /api/books/:bookId { title } — rename a book.
router.patch('/:bookId', (req, res) => {
  const { title } = req.body || {};
  if (!title || typeof title !== 'string' || !title.trim()) {
    return res.status(400).json({ error: 'title is required' });
  }
  try {
    const meta = renameBook(req.params.bookId, title.trim());
    res.json(meta);
  } catch (err) {
    const status = err.message.includes('not found') ? 404 : 400;
    res.status(status).json({ error: err.message });
  }
});

// DELETE /api/books/:bookId/pages/:pageNumber — removes one page (and its
// sentences). To edit a page instead, re-submit it through the append
// endpoint above with the same page number - that replaces it in place.
router.delete('/:bookId/pages/:pageNumber', (req, res) => {
  const pageNumber = Number(req.params.pageNumber);
  if (!Number.isFinite(pageNumber)) {
    return res.status(400).json({ error: 'invalid page number' });
  }
  try {
    const meta = deletePage(req.params.bookId, pageNumber);
    res.json(meta);
  } catch (err) {
    const status = err.message.includes('not found') ? 404 : 400;
    res.status(status).json({ error: err.message });
  }
});

export default router;
