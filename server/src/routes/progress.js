import { Router } from 'express';
import { db } from '../db.js';

const router = Router();

// GET /api/progress/:bookId — userId comes from the session (req.userId, set
// by the requireAuth middleware mounted in index.js), not the client.
router.get('/:bookId', (req, res) => {
  const row = db
    .prepare('SELECT page, updated_at FROM progress WHERE user_id = ? AND book_id = ?')
    .get(req.userId, req.params.bookId);
  res.json(row ? { page: row.page, updatedAt: row.updated_at } : null);
});

// POST /api/progress/:bookId { page }
router.post('/:bookId', (req, res) => {
  const { page } = req.body || {};
  if (!Number.isFinite(page)) {
    return res.status(400).json({ error: 'page must be a number' });
  }
  const updatedAt = new Date().toISOString();
  db.prepare(
    `INSERT INTO progress (user_id, book_id, page, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(user_id, book_id) DO UPDATE SET page = excluded.page, updated_at = excluded.updated_at`
  ).run(req.userId, req.params.bookId, page, updatedAt);
  res.json({ page, updatedAt });
});

export default router;
