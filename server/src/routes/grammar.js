import { Router } from 'express';
import { db } from '../db.js';
import { decrypt } from '../crypto.js';
import { explainMistake } from '../llm.js';
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
    importanceRank: row.importance_rank,
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

function allLessons() {
  return db.prepare('SELECT * FROM grammar_lessons').all().map(parseLesson);
}

// GET /api/grammar/by-tag/:tag — looks up the grammar lesson(s) covering a
// given error_tag (see db.js's grammar_lessons comment).
router.get('/by-tag/:tag', (req, res) => {
  const matches = allLessons().filter((lesson) => lesson.errorTags.includes(req.params.tag));
  res.json(matches);
});

// POST /api/grammar/explain-mistake { promptText, expectedAnswer, userAnswer, promptLang }
// — used by LessonPlayer.js (both Courses' active-recall lessons and
// Interview lessons share this component) when a learner submits a wrong
// answer. Uses the account's own Translation API key (same one used for
// book/course imports) to get a short explanation of what's wrong -
// without revealing the correct answer, see llm.js's explainMistake - and,
// if it's a grammar mistake, resolves the AI's chosen error_tags to real
// grammar_lessons so the client can show clickable "read the lesson" links.
router.post('/explain-mistake', async (req, res) => {
  const { promptText, expectedAnswer, userAnswer, promptLang } = req.body || {};
  if (!promptText || !expectedAnswer || !userAnswer) {
    return res.status(400).json({ error: 'promptText, expectedAnswer, and userAnswer are required' });
  }

  const row = db.prepare('SELECT llm_provider, llm_api_key_enc FROM users WHERE id = ?').get(req.userId);
  if (!row?.llm_provider || !row?.llm_api_key_enc) {
    return res.status(400).json({ error: 'no Translation API key configured — add one in Settings first' });
  }

  const lessons = allLessons();
  const availableTags = [...new Set(lessons.flatMap((lesson) => lesson.errorTags))];

  let apiKey;
  try {
    apiKey = await decrypt(row.llm_api_key_enc);
  } catch (err) {
    console.error('explain-mistake: failed to decrypt Translation API key:', err);
    return res.status(500).json({ error: 'Failed to read your Translation API key — try re-saving it in Settings.' });
  }

  try {
    const result = await explainMistake({
      provider: row.llm_provider,
      apiKey,
      promptText,
      expectedAnswer,
      userAnswer,
      promptLang: promptLang === 'en' ? 'en' : 'fa',
      availableTags,
    });
    const matchedLessons = lessons
      .filter((lesson) => result.errorTags.some((tag) => lesson.errorTags.includes(tag)))
      .map((lesson) => ({ id: lesson.id, level: lesson.level, topic: lesson.topic }));
    res.json({ explanation: result.explanation, isGrammarMistake: result.isGrammarMistake, lessons: matchedLessons });
  } catch (err) {
    console.error('explain-mistake: AI call failed:', err);
    res.status(502).json({ error: err.message });
  }
});

export default router;
