import { Router } from 'express';
import multer from 'multer';
import crypto from 'node:crypto';
import {
  parseBookText,
  saveImportedBook,
  appendToBook,
  renameBook,
  deletePage,
  listBooks,
  getBook,
} from '../bookImporter.js';
import { db } from '../db.js';
import { decrypt } from '../crypto.js';
import { importPdfAsBook } from '../pdfImport.js';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 40 * 1024 * 1024 } });

// In-memory job tracking for the PDF import pipeline, since it can take a
// long time (one AI call per page, occasionally an OCR pass too) - the
// import route kicks off processing and returns immediately with a job id,
// rather than holding the HTTP request open for a whole book. A restart
// loses in-flight jobs, which is an acceptable trade-off for a single-
// process personal app (pages already saved before the restart are kept -
// only the "job status" bookkeeping is lost, not the book data itself).
const pdfJobs = new Map();

router.post('/import-pdf/:jobId/cancel', (req, res) => {
  const job = pdfJobs.get(req.params.jobId);
  if (!job || job.userId !== req.userId) return res.status(404).json({ error: 'job not found' });
  job.cancelled = true;
  res.json({ ok: true });
});

router.get('/import-pdf/:jobId/status', (req, res) => {
  const job = pdfJobs.get(req.params.jobId);
  if (!job || job.userId !== req.userId) return res.status(404).json({ error: 'job not found' });
  const { userId: _userId, cancelled: _cancelled, ...publicState } = job;
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
  const job = {
    userId: req.userId,
    status: 'running',
    bookId: bookId.trim(),
    currentPage: 0,
    totalPages: null,
    pagesFound: 0,
    errors: [],
    cancelled: false,
  };
  pdfJobs.set(jobId, job);
  res.status(202).json({ jobId, bookId: job.bookId });

  try {
    const textApiKey = await decrypt(row.llm_api_key_enc);
    const result = await importPdfAsBook({
      pdfBuffer: req.file.buffer,
      text: { provider: row.llm_provider, apiKey: textApiKey },
      bookId: job.bookId,
      title: (title || '').trim(),
      startPage,
      chapter: (chapter || '').trim(),
      onProgress: (p) => {
        if (job.cancelled) throw new Error('CANCELLED');
        job.currentPage = p.currentPage;
        job.totalPages = p.totalPages;
        job.pagesFound = p.pagesFound;
        job.errors = p.errors;
      },
    });
    job.status = 'done';
    job.pagesFound = result.pagesFound;
    job.totalPages = result.totalPages;
    job.errors = result.errors;
    job.meta = result.meta;
  } catch (err) {
    if (err.message === 'CANCELLED') {
      job.status = 'cancelled';
    } else {
      console.error('PDF import failed:', err);
      job.status = 'error';
      job.error = err.message;
    }
  }
  // Keep finished job state around briefly for the client to pick up on its
  // next poll, then free the memory - no need to keep it forever.
  setTimeout(() => pdfJobs.delete(jobId), 10 * 60 * 1000);
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
