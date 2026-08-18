import { Router } from 'express';
import { readJson, updateJson } from '../store.js';

const router = Router();

function requireUserId(req, res) {
  const userId = req.query.userId || req.body?.userId;
  if (!userId || typeof userId !== 'string') {
    res.status(400).json({ error: 'userId is required' });
    return null;
  }
  return userId;
}

// GET /api/progress/:bookId?userId=...
router.get('/:bookId', async (req, res) => {
  const userId = requireUserId(req, res);
  if (!userId) return;
  const all = await readJson('progress.json', {});
  const entry = all[userId]?.[req.params.bookId] || null;
  res.json(entry);
});

// POST /api/progress/:bookId { userId, page }
router.post('/:bookId', async (req, res) => {
  const userId = requireUserId(req, res);
  if (!userId) return;
  const { page } = req.body || {};
  if (!Number.isFinite(page)) {
    return res.status(400).json({ error: 'page must be a number' });
  }
  const bookId = req.params.bookId;
  const updated = await updateJson('progress.json', {}, (all) => {
    all[userId] = all[userId] || {};
    all[userId][bookId] = { page, updatedAt: new Date().toISOString() };
    return all;
  });
  res.json(updated[userId][bookId]);
});

export default router;
