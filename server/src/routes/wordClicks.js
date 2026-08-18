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

// POST /api/word-clicks { userId, bookId, page, word }
// Fired automatically whenever the reader taps a word — this is the signal
// the platform uses later to know what the user is actively learning.
router.post('/', async (req, res) => {
  const userId = requireUserId(req, res);
  if (!userId) return;
  const { bookId, page, word } = req.body || {};
  if (!bookId || !word || typeof word !== 'string') {
    return res.status(400).json({ error: 'bookId and word are required' });
  }
  const now = new Date().toISOString();
  const updated = await updateJson('wordClicks.json', {}, (all) => {
    all[userId] = all[userId] || {};
    const entry = all[userId][word] || {
      word,
      count: 0,
      firstClickedAt: now,
      lastClickedAt: now,
      books: {},
    };
    entry.count += 1;
    entry.lastClickedAt = now;
    const bookEntry = entry.books[bookId] || { count: 0, pages: {} };
    bookEntry.count += 1;
    if (Number.isFinite(page)) {
      bookEntry.pages[page] = (bookEntry.pages[page] || 0) + 1;
    }
    entry.books[bookId] = bookEntry;
    all[userId][word] = entry;
    return all;
  });
  res.json(updated[userId][word]);
});

// GET /api/word-clicks?userId=... — full click map for the user (used later
// by review/spaced-repetition features to know what to surface).
router.get('/', async (req, res) => {
  const userId = requireUserId(req, res);
  if (!userId) return;
  const all = await readJson('wordClicks.json', {});
  res.json(all[userId] || {});
});

export default router;
