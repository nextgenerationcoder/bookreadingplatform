import { Router } from 'express';
import {
  parseBookText,
  saveImportedBook,
  appendToBook,
  renameBook,
  listBooks,
  getBook,
} from '../bookImporter.js';

const router = Router();

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

export default router;
