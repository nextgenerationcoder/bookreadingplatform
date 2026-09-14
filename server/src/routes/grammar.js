import { Router } from 'express';
import { db } from '../db.js';
import { CEFR_LEVELS } from '../courseImporter.js';

const router = Router();

function parseLesson(row) {
  return {
    id: row.id,
    level: row.level,
    orderIndex: row.order_index,
    topic: row.topic,
    summary: row.summary,
    explanation: row.explanation,
    rules: JSON.parse(row.rules_json),
    examples: JSON.parse(row.examples_json),
    commonMistakes: JSON.parse(row.common_mistakes_json),
    errorTags: JSON.parse(row.error_tags_json),
    bookReference: row.book_reference,
  };
}

router.get('/levels', (_req, res) => {
  res.json({ levels: CEFR_LEVELS });
});

// GET /api/grammar?level=A1 — omit level to list lessons across all levels.
// Returns summaries only (no rules/examples/mistakes) for the level list view.
router.get('/', (req, res) => {
  const { level } = req.query;
  if (level && !CEFR_LEVELS.includes(level)) {
    return res.status(400).json({ error: `level must be one of: ${CEFR_LEVELS.join(', ')}` });
  }
  const rows = level
    ? db.prepare('SELECT id, level, order_index, topic, summary FROM grammar_lessons WHERE level = ? ORDER BY order_index').all(level)
    : db.prepare('SELECT id, level, order_index, topic, summary FROM grammar_lessons ORDER BY level, order_index').all();
  res.json(rows.map((r) => ({ id: r.id, level: r.level, orderIndex: r.order_index, topic: r.topic, summary: r.summary })));
});

router.get('/lesson/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM grammar_lessons WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'grammar lesson not found' });
  res.json(parseLesson(row));
});

// GET /api/grammar/by-tag/:tag — looks up the grammar lesson(s) covering a
// given error_tag (see db.js's grammar_lessons comment). Not called from
// anywhere yet - this is the lookup Practice will use once it tags wrong
// answers with the same error_tag vocabulary, to recommend "re-read this
// lesson" (see the file comment above grammar_lessons in db.js).
router.get('/by-tag/:tag', (req, res) => {
  const rows = db.prepare('SELECT * FROM grammar_lessons').all();
  const matches = rows
    .map(parseLesson)
    .filter((lesson) => lesson.errorTags.includes(req.params.tag));
  res.json(matches);
});

export default router;
