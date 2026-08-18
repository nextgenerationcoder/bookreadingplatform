import { Router } from 'express';
import { db } from '../db.js';

const router = Router();

function requireUserId(req, res) {
  const userId = req.query.userId || req.body?.userId;
  if (!userId || typeof userId !== 'string') {
    res.status(400).json({ error: 'userId is required' });
    return null;
  }
  return userId;
}

function loadWordEntry(userId, word) {
  const main = db
    .prepare('SELECT count, first_clicked_at, last_clicked_at FROM word_clicks WHERE user_id = ? AND word = ?')
    .get(userId, word);
  if (!main) return null;

  const bookRows = db
    .prepare('SELECT book_id, count FROM word_click_books WHERE user_id = ? AND word = ?')
    .all(userId, word);
  const pageRows = db
    .prepare('SELECT book_id, page, count FROM word_click_pages WHERE user_id = ? AND word = ?')
    .all(userId, word);

  const books = {};
  for (const row of bookRows) {
    books[row.book_id] = { count: row.count, pages: {} };
  }
  for (const row of pageRows) {
    if (books[row.book_id]) books[row.book_id].pages[row.page] = row.count;
  }

  return {
    word,
    count: main.count,
    firstClickedAt: main.first_clicked_at,
    lastClickedAt: main.last_clicked_at,
    books,
  };
}

// POST /api/word-clicks { userId, bookId, page, word }
// Fired automatically whenever the reader taps a word — this is the signal
// the platform uses later to know what the user is actively learning.
router.post('/', (req, res) => {
  const userId = requireUserId(req, res);
  if (!userId) return;
  const { bookId, page, word } = req.body || {};
  if (!bookId || !word || typeof word !== 'string') {
    return res.status(400).json({ error: 'bookId and word are required' });
  }
  const now = new Date().toISOString();
  const hasPage = Number.isFinite(page);

  const tx = db.transaction(() => {
    db.prepare(
      `INSERT INTO word_clicks (user_id, word, count, first_clicked_at, last_clicked_at)
       VALUES (?, ?, 1, ?, ?)
       ON CONFLICT(user_id, word) DO UPDATE SET count = count + 1, last_clicked_at = excluded.last_clicked_at`
    ).run(userId, word, now, now);

    db.prepare(
      `INSERT INTO word_click_books (user_id, word, book_id, count) VALUES (?, ?, ?, 1)
       ON CONFLICT(user_id, word, book_id) DO UPDATE SET count = count + 1`
    ).run(userId, word, bookId);

    if (hasPage) {
      db.prepare(
        `INSERT INTO word_click_pages (user_id, word, book_id, page, count) VALUES (?, ?, ?, ?, 1)
         ON CONFLICT(user_id, word, book_id, page) DO UPDATE SET count = count + 1`
      ).run(userId, word, bookId, page);
    }
  });
  tx();

  res.json(loadWordEntry(userId, word));
});

// GET /api/word-clicks?userId=... — full click map for the user (used later
// by review/spaced-repetition features to know what to surface).
router.get('/', (req, res) => {
  const userId = requireUserId(req, res);
  if (!userId) return;
  const words = db.prepare('SELECT word FROM word_clicks WHERE user_id = ?').all(userId);
  const result = {};
  for (const { word } of words) {
    result[word] = loadWordEntry(userId, word);
  }
  res.json(result);
});

export default router;
