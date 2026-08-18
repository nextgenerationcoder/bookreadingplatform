import { Router } from 'express';
import { readJson } from '../store.js';

const router = Router();

router.get('/', async (_req, res) => {
  const index = await readJson('books/index.json', []);
  res.json(index);
});

router.get('/:bookId', async (req, res) => {
  const book = await readJson(`books/${req.params.bookId}.json`, null);
  if (!book) return res.status(404).json({ error: 'book not found' });
  res.json(book);
});

export default router;
