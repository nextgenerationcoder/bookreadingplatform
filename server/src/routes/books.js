import { Router } from 'express';
import multer from 'multer';
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
// startPage, chapter) — extracts text from the PDF page by page, translates
// and formats each page via the account's own AI key, and saves the result
// as a book (creating it if bookId doesn't exist yet, otherwise appending).
// Pages with no extractable text (scanned images) are skipped and reported,
// not guessed at - use the page-photo batch upload in Add Pages for those.
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
    return res.status(400).json({ error: 'no AI API key configured — add one in Settings first' });
  }

  try {
    const apiKey = await decrypt(row.llm_api_key_enc);
    const result = await importPdfAsBook({
      pdfBuffer: req.file.buffer,
      provider: row.llm_provider,
      apiKey,
      bookId: bookId.trim(),
      title: (title || '').trim(),
      startPage,
      chapter: (chapter || '').trim(),
    });
    if (!result.meta) {
      return res.status(502).json({ error: 'No pages could be translated.', errors: result.errors, totalPages: result.totalPages });
    }
    res.status(201).json(result);
  } catch (err) {
    console.error('PDF import failed:', err);
    res.status(502).json({ error: err.message });
  }
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
