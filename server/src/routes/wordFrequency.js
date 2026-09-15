import { Router } from 'express';
import { db } from '../db.js';

const router = Router();

// POST /api/word-frequency/lookup { words: [...] } — ranks for exactly the
// words asked for (case-insensitive), not the whole 200k-row table (see
// db.js's word_frequency and scripts/import-word-frequency.js). POST (not
// GET) because a word list can grow past a URL's practical length. Used by
// My Words to sort vocab/word-click lists by how common a word is. A word
// missing from the response just isn't in the table (rare enough to fall
// outside the top 200k, or not real German at all) - the client treats
// that as "no frequency data" rather than an error.
router.post('/lookup', (req, res) => {
  const { words: raw } = req.body || {};
  if (!Array.isArray(raw)) return res.status(400).json({ error: 'words (array) is required' });
  const words = [...new Set(raw.map((w) => String(w).trim().toLowerCase()).filter(Boolean))];
  if (!words.length) return res.json({});

  const placeholders = words.map(() => '?').join(',');
  const rows = db.prepare(`SELECT word, rank FROM word_frequency WHERE word IN (${placeholders})`).all(...words);
  const result = {};
  for (const row of rows) result[row.word] = row.rank;
  res.json(result);
});

export default router;
