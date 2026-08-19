import { Router } from 'express';
import { db } from '../db.js';
import { parseDictionaryText, importDictionaryEntries } from '../dictionaryImporter.js';
import { translateWord } from '../translate.js';

const router = Router();

router.get('/', (_req, res) => {
  const rows = db.prepare('SELECT word, gloss FROM dictionary').all();
  const dict = Object.fromEntries(rows.map((r) => [r.word, r.gloss]));
  res.json(dict);
});

// GET /api/dictionary/lookup/:word — used when the reader taps a word that
// isn't in the dictionary yet. Falls back to a live translation API and
// caches the result (source: 'auto') so it's an instant DB hit for every
// user after the first lookup, without needing anyone to add it by hand.
router.get('/lookup/:word', async (req, res) => {
  const word = req.params.word.trim().toLowerCase();
  if (!word) return res.status(400).json({ error: 'word is required' });

  const existing = db.prepare('SELECT word, gloss, source FROM dictionary WHERE word = ?').get(word);
  if (existing) return res.json(existing);

  const gloss = await translateWord(word);
  if (!gloss) return res.status(404).json({ error: 'no translation found' });

  db.prepare(
    `INSERT INTO dictionary (word, gloss, source) VALUES (?, ?, 'auto')
     ON CONFLICT(word) DO NOTHING`
  ).run(word, gloss);

  res.json({ word, gloss, source: 'auto' });
});

// POST /api/dictionary/import { text } — parses "word = gloss" /
// "word → infinitive = gloss" / "der X, die Xe = gloss" vocabulary lines and
// upserts them into the dictionary (existing words get their gloss replaced,
// so re-importing to fix/extend an entry is safe).
router.post('/import', (req, res) => {
  const { text } = req.body || {};
  if (!text || typeof text !== 'string') {
    return res.status(400).json({ error: 'text is required' });
  }
  const entries = parseDictionaryText(text);
  if (!entries.length) {
    return res.status(400).json({ error: 'No "word = meaning" lines found in that text' });
  }
  importDictionaryEntries(entries);
  res.status(201).json({ imported: entries.length });
});

export default router;
