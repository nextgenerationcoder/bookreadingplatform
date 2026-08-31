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
  deleteBook,
  deletePage,
  listBooks,
  getBook,
} from '../bookImporter.js';
import { db, DB_PATH } from '../db.js';
import { decrypt } from '../crypto.js';
import { importPdfAsBook } from '../pdfImport.js';
import { CHUNK_SIZE, splitPdfIntoChunks } from '../pdfSplit.js';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 40 * 1024 * 1024 } });

// Live job state for jobs actively running in *this* process (fast status
// polling, and the flag a running loop checks to cancel itself). The
// pdf_import_jobs DB table is the durable copy - progress is written there
// on every page - so a job survives a server restart: resumePendingPdfJobs()
// (called once at server boot, from index.js) picks up any row still marked
// "running" and continues it from the last saved page.
//
// The book itself is worked through in 10-page chunk files rather than one
// big PDF for the whole thing (see pdfSplit.js) - easier on memory for a
// long scanned book, and a resume only needs to reload the small chunk it
// was on instead of the whole book.
const pdfJobs = new Map();

const PDF_STORE_DIR = path.join(path.dirname(DB_PATH), 'pdf-imports');
await fs.mkdir(PDF_STORE_DIR, { recursive: true });

function jobFromRow(row) {
  const totalChunks = row.total_pages ? Math.ceil(row.total_pages / CHUNK_SIZE) : null;
  return {
    userId: row.user_id,
    status: row.status,
    bookId: row.book_id,
    currentPage: row.current_page,
    totalPages: row.total_pages,
    currentChunk: row.total_pages ? Math.min(totalChunks, Math.max(1, Math.ceil(row.current_page / CHUNK_SIZE))) : null,
    totalChunks,
    pagesFound: row.pages_found,
    errors: JSON.parse(row.errors_json),
    error: row.error || undefined,
    cancelled: !!row.cancelled,
  };
}

function persistJob(jobId, job) {
  const finishedAt = job.status === 'running' ? null : job.finishedAt || new Date().toISOString();
  job.finishedAt = finishedAt;
  db.prepare(`
    UPDATE pdf_import_jobs
    SET status = ?, current_page = ?, total_pages = ?, pages_found = ?, errors_json = ?, error = ?, cancelled = ?, finished_at = ?
    WHERE id = ?
  `).run(job.status, job.currentPage, job.totalPages, job.pagesFound, JSON.stringify(job.errors), job.error || null, job.cancelled ? 1 : 0, finishedAt, jobId);
}

// Keeps a per-account import history from growing without bound - only the
// most recent `keep` finished jobs are kept; a job still "running" is never
// pruned regardless of age.
function pruneOldJobs(userId, keep = 50) {
  const rows = db
    .prepare("SELECT id FROM pdf_import_jobs WHERE user_id = ? AND status != 'running' ORDER BY COALESCE(finished_at, created_at) DESC")
    .all(userId);
  if (rows.length <= keep) return;
  const staleIds = rows.slice(keep).map((r) => r.id);
  const placeholders = staleIds.map(() => '?').join(',');
  db.prepare(`DELETE FROM pdf_import_jobs WHERE id IN (${placeholders})`).run(...staleIds);
}

// Runs (or resumes) one PDF import job to completion, keeping the in-memory
// and DB copies of its state in sync throughout, then cleans up.
async function runPdfImportJob(jobId, job, { chunkDir, totalPages, text, bookId, title, startPage, chapter, resumeFromIndex, initialPagesFound, initialErrors }) {
  pdfJobs.set(jobId, job);
  try {
    const result = await importPdfAsBook({
      chunkDir,
      totalPages,
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
        job.currentChunk = p.currentChunk;
        job.totalChunks = p.totalChunks;
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
  await fs.rm(chunkDir, { recursive: true, force: true });
  // Free the live in-memory tracking, but keep the DB row - it's this
  // account's import history now (see GET /import-pdf/history), pruned to
  // the most recent 50 finished jobs rather than deleted outright.
  pdfJobs.delete(jobId);
  pruneOldJobs(job.userId);
}

// Called once at server startup (see index.js). Any job still marked
// "running" in the DB means the process died mid-import (redeploy, crash,
// OOM, etc.) - resume each from its last saved page using the chunk files
// that were written to disk when it started. Pages already saved to the
// book are safe to redo (appendToBook replaces by page number), but
// resuming from the last recorded page instead of page 1 avoids redoing an
// entire book's worth of AI calls.
export async function resumePendingPdfJobs() {
  const rows = db.prepare("SELECT * FROM pdf_import_jobs WHERE status = 'running'").all();
  for (const row of rows) {
    const chunkDirExists = await fs.access(row.pdf_path).then(() => true).catch(() => false);
    if (!chunkDirExists) {
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
      chunkDir: row.pdf_path,
      totalPages: row.total_pages,
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

// GET /api/books/import-pdf/active — lists this account's currently
// running PDF imports (jobId + progress for each). The import itself keeps
// going server-side regardless of what the browser does (navigating away,
// closing the tab, even a server restart - see resumePendingPdfJobs), but
// there was previously no way for a fresh page load to discover an already-
// running job and reattach to it, so leaving the Add Book/Add Pages page
// and coming back looked like the import had stopped even though it
// hadn't. The client polls this on load to resume showing progress.
router.get('/import-pdf/active', (req, res) => {
  const rows = db.prepare("SELECT * FROM pdf_import_jobs WHERE user_id = ? AND status = 'running'").all(req.userId);
  res.json(
    rows.map((row) => {
      const { userId: _userId, cancelled: _cancelled, ...publicState } = jobFromRow(row);
      return { jobId: row.id, ...publicState };
    })
  );
});

// GET /api/books/import-pdf/history — this account's PDF import history
// (running and finished), most recent first, capped to the 50 kept by
// pruneOldJobs(). Includes the title/start page/timestamps that /active and
// /:jobId/status don't bother with, since those are only ever polled right
// after the client itself already knows that context.
router.get('/import-pdf/history', (req, res) => {
  const rows = db
    .prepare('SELECT * FROM pdf_import_jobs WHERE user_id = ? ORDER BY COALESCE(finished_at, created_at) DESC LIMIT 50')
    .all(req.userId);
  res.json(
    rows.map((row) => {
      const { userId: _userId, cancelled: _cancelled, ...publicState } = jobFromRow(row);
      return {
        jobId: row.id,
        title: row.title,
        startPage: row.start_page,
        createdAt: row.created_at,
        finishedAt: row.finished_at,
        ...publicState,
      };
    })
  );
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
  const chunkDir = path.join(PDF_STORE_DIR, jobId);
  // Split into 10-page chunk files up front, rather than working with the
  // whole book as one in-memory PDF for the entire import - each chunk is
  // small and self-contained, so a resume only has to re-load the ~10 pages
  // it was on. pdf-lib (used for splitting) is much stricter than pdfjs-dist
  // (used everywhere else in this pipeline for parsing/rendering) and can
  // throw on real-world scanned/malformed PDFs that pdfjs tolerates fine -
  // this MUST be caught and reported, since it happens before any job
  // exists to report progress/errors through, and would otherwise just
  // hang the request with no feedback at all.
  let totalPages;
  try {
    totalPages = await splitPdfIntoChunks(req.file.buffer, chunkDir);
  } catch (err) {
    console.error('PDF import: failed to split the uploaded PDF into chunks:', err);
    await fs.rm(chunkDir, { recursive: true, force: true });
    return res.status(400).json({ error: `Couldn't read this PDF (it may be corrupted, encrypted, or in an unsupported format): ${err.message}` });
  }
  const totalChunks = Math.ceil(totalPages / CHUNK_SIZE);

  const trimmedBookId = bookId.trim();
  const trimmedTitle = (title || '').trim();
  const trimmedChapter = (chapter || '').trim();

  db.prepare(`
    INSERT INTO pdf_import_jobs (id, user_id, book_id, title, chapter, start_page, pdf_path, total_pages, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'running', ?)
  `).run(jobId, req.userId, trimmedBookId, trimmedTitle, trimmedChapter, startPage, chunkDir, totalPages, new Date().toISOString());

  const job = {
    userId: req.userId,
    status: 'running',
    bookId: trimmedBookId,
    currentPage: 0,
    totalPages,
    currentChunk: 1,
    totalChunks,
    pagesFound: 0,
    errors: [],
    cancelled: false,
  };

  // Decrypt before responding, not after: if this throws once the response
  // has already gone out, the job would just sit at "running" forever with
  // no error anywhere for the client to see.
  let textApiKey;
  try {
    textApiKey = await decrypt(row.llm_api_key_enc);
  } catch (err) {
    console.error('PDF import: failed to decrypt the Translation API key:', err);
    db.prepare('DELETE FROM pdf_import_jobs WHERE id = ?').run(jobId);
    await fs.rm(chunkDir, { recursive: true, force: true });
    return res.status(500).json({ error: `Couldn't read your saved Translation API key: ${err.message}. Try re-saving it in Settings.` });
  }

  res.status(202).json({ jobId, bookId: job.bookId, totalPages, totalChunks });

  // Runs in the background - saved to disk and to the DB above, so it
  // survives this request ending, the client disconnecting or logging out,
  // and even a server restart (resumePendingPdfJobs() picks it back up).
  runPdfImportJob(jobId, job, {
    chunkDir,
    totalPages,
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

// DELETE /api/books/:bookId — removes the whole book (pages/sentences,
// reading progress, and word-click stats for it). Cancels any PDF import
// still running for it first, so that job's background loop stops instead
// of trying to save pages into a book that no longer exists.
router.delete('/:bookId', (req, res) => {
  const bookId = req.params.bookId;
  const runningJobs = db.prepare("SELECT id FROM pdf_import_jobs WHERE book_id = ? AND status = 'running'").all(bookId);
  for (const { id: jobId } of runningJobs) {
    const liveJob = pdfJobs.get(jobId);
    if (liveJob) liveJob.cancelled = true;
    db.prepare('UPDATE pdf_import_jobs SET cancelled = 1 WHERE id = ?').run(jobId);
  }
  try {
    deleteBook(bookId);
    res.json({ ok: true });
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
