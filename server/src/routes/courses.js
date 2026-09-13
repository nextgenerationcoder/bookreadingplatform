import { Router } from 'express';
import {
  CEFR_LEVELS,
  parseCourseText,
  saveImportedCourse,
  appendToCourse,
  renameCourse,
  deleteCoursePage,
  listCourses,
  getCourse,
} from '../courseImporter.js';

const router = Router();

router.get('/levels', (_req, res) => {
  res.json({ levels: CEFR_LEVELS });
});

// GET /api/courses?level=A1 — omit level to list all courses across levels.
router.get('/', (req, res) => {
  const { level } = req.query;
  if (level && !CEFR_LEVELS.includes(level)) {
    return res.status(400).json({ error: `level must be one of: ${CEFR_LEVELS.join(', ')}` });
  }
  res.json(listCourses(level));
});

// POST /api/courses/import { text } — parses the plain-text ingestion format
// (see server/src/courseImporter.js) and creates/updates a course from it.
router.post('/import', (req, res) => {
  const { text } = req.body || {};
  if (!text || typeof text !== 'string') {
    return res.status(400).json({ error: 'text is required' });
  }
  let course;
  try {
    course = parseCourseText(text);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
  const meta = saveImportedCourse(course);
  res.status(201).json(meta);
});

router.get('/:courseId', (req, res) => {
  const course = getCourse(req.params.courseId);
  if (!course) return res.status(404).json({ error: 'course not found' });
  res.json(course);
});

// POST /api/courses/:courseId/append { text } — parses `text` as extra
// PAGE/CHAPTER/sentence blocks (COURSE:/TITLE:/LEVEL:/LANG: inherited from
// the existing course) and merges the resulting pages into it.
router.post('/:courseId/append', (req, res) => {
  const { text } = req.body || {};
  if (!text || typeof text !== 'string') {
    return res.status(400).json({ error: 'text is required' });
  }
  try {
    const meta = appendToCourse(req.params.courseId, text);
    res.json(meta);
  } catch (err) {
    const status = err.message.includes('not found') ? 404 : 400;
    res.status(status).json({ error: err.message });
  }
});

// PATCH /api/courses/:courseId { title } — rename a course.
router.patch('/:courseId', (req, res) => {
  const { title } = req.body || {};
  if (!title || typeof title !== 'string' || !title.trim()) {
    return res.status(400).json({ error: 'title is required' });
  }
  try {
    const meta = renameCourse(req.params.courseId, title.trim());
    res.json(meta);
  } catch (err) {
    const status = err.message.includes('not found') ? 404 : 400;
    res.status(status).json({ error: err.message });
  }
});

// DELETE /api/courses/:courseId/pages/:pageNumber — removes one page (and
// its sentences). To edit a page instead, re-submit it through the append
// endpoint above with the same page number - that replaces it in place.
router.delete('/:courseId/pages/:pageNumber', (req, res) => {
  const pageNumber = Number(req.params.pageNumber);
  if (!Number.isFinite(pageNumber)) {
    return res.status(400).json({ error: 'invalid page number' });
  }
  try {
    const meta = deleteCoursePage(req.params.courseId, pageNumber);
    res.json(meta);
  } catch (err) {
    const status = err.message.includes('not found') ? 404 : 400;
    res.status(status).json({ error: err.message });
  }
});

export default router;
