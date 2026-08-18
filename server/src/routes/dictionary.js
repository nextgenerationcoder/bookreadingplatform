import { Router } from 'express';
import { db } from '../db.js';
import { parseDictionaryText, importDictionaryEntries } from '../dictionaryImporter.js';

const router = Router();

router.get('/', (_req, res) => {
  const rows = db.prepare('SELECT word, gloss FROM dictionary').all();
  const dict = Object.fromEntries(rows.map((r) => [r.word, r.gloss]));
  res.json(dict);
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
