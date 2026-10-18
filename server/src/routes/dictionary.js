import { Router } from 'express';
import { db } from '../db.js';
import { parseDictionaryText, importDictionaryEntries } from '../dictionaryImporter.js';
import { translateWord } from '../translate.js';
import { decrypt } from '../crypto.js';
import { extractPhrasePattern } from '../llm.js';

const router = Router();

// The bulk snapshot deliberately excludes the wikidict-sourced backfill
// (~226k rows, mostly Wikipedia article-title equivalents) so this stays a
// small payload every page load. Those words are still fully in the
// database and resolve instantly through GET /lookup/:word below (an
// indexed lookup, not a network translation call) the first time a reader
// taps one that isn't in this snapshot.
router.get('/', (_req, res) => {
  const rows = db.prepare("SELECT word, gloss FROM dictionary WHERE source != 'wikidict'").all();
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

// POST /api/dictionary/extract-pattern { text, sentence, persian } — the
// reader's "Extract pattern (AI)" menu item, for a multi-word selection
// that's really a fixed construction (verb + preposition + case, an idiom)
// rather than a one-off fragment. Uses the account's own Translation API
// key (same one used for book/course imports and explain-mistake) to
// generalize the selection and translate the generalized pattern - see
// llm.js's extractPhrasePattern. Returns the result for the client to show
// in an editable confirm step; doesn't save anything itself (the client
// saves it via the usual /import endpoint above once the learner confirms,
// same as a manual "Change translation").
router.post('/extract-pattern', async (req, res) => {
  const { text, sentence, persian } = req.body || {};
  if (!text || typeof text !== 'string') {
    return res.status(400).json({ error: 'text is required' });
  }

  const row = db.prepare('SELECT llm_provider, llm_api_key_enc FROM users WHERE id = ?').get(req.userId);
  if (!row?.llm_provider || !row?.llm_api_key_enc) {
    return res.status(400).json({ error: 'no Translation API key configured — add one in Settings first' });
  }

  let apiKey;
  try {
    apiKey = await decrypt(row.llm_api_key_enc);
  } catch (err) {
    console.error('extract-pattern: failed to decrypt Translation API key:', err);
    return res.status(500).json({ error: 'Failed to read your Translation API key — try re-saving it in Settings.' });
  }

  try {
    const result = await extractPhrasePattern({
      provider: row.llm_provider,
      apiKey,
      phrase: text,
      sentence: sentence || text,
      sentenceTranslation: persian || '',
    });
    res.json(result);
  } catch (err) {
    console.error('extract-pattern: AI call failed:', err);
    res.status(502).json({ error: err.message });
  }
});

export default router;
