import { Router } from 'express';
import { db } from '../db.js';
import { decrypt } from '../crypto.js';
import { generatePracticeCourseForUser, listPracticeCoursesForUser, getPracticeCourseForUser } from '../practiceCourseGenerator.js';

const router = Router();

router.get('/courses', (req, res) => {
  res.json(listPracticeCoursesForUser(req.userId));
});

router.get('/courses/:courseId', (req, res) => {
  const course = getPracticeCourseForUser(req.userId, req.params.courseId);
  if (!course) return res.status(404).json({ error: 'practice course not found' });
  res.json(course);
});

// POST /api/practice/generate { title? } — generates a new personalized
// course from the account's own vocab_progress + grammar_lessons data,
// using their own Translation API key (same one used everywhere else in
// the app - see routes/settings.js's /llm). Can take a while (the AI call
// itself has a 3-minute timeout, see llm.js) since it's producing a whole
// multi-lesson course in one response.
router.post('/generate', async (req, res) => {
  const row = db.prepare('SELECT llm_provider, llm_api_key_enc FROM users WHERE id = ?').get(req.userId);
  if (!row?.llm_provider || !row?.llm_api_key_enc) {
    return res.status(400).json({ error: 'no Translation API key configured — add one in Settings first' });
  }

  let apiKey;
  try {
    apiKey = await decrypt(row.llm_api_key_enc);
  } catch (err) {
    console.error('practice/generate: failed to decrypt Translation API key:', err);
    return res.status(500).json({ error: 'Failed to read your Translation API key — try re-saving it in Settings.' });
  }

  const { title } = req.body || {};
  try {
    const course = await generatePracticeCourseForUser({ userId: req.userId, provider: row.llm_provider, apiKey, title });
    res.status(201).json(course);
  } catch (err) {
    console.error('practice/generate: course generation failed:', err);
    res.status(502).json({ error: err.message });
  }
});

export default router;
