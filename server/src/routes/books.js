import { Router } from 'express';
import { readJson } from '../store.js';
import { parseBookText, saveImportedBook } from '../bookImporter.js';

const router = Router();

router.get('/', async (_req, res) => {
  const index = await readJson('books/index.json', []);
  res.json(index);
});

// POST /api/books/import { text } — parses the plain-text ingestion format
// (see server/src/bookImporter.js) and creates/updates a book from it.
router.post('/import', async (req, res) => {
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
  const meta = await saveImportedBook(book);
  res.status(201).json(meta);
});

router.get('/:bookId', async (req, res) => {
  const book = await readJson(`books/${req.params.bookId}.json`, null);
  if (!book) return res.status(404).json({ error: 'book not found' });
  res.json(book);
});

export default router;
