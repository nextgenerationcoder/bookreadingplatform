import { Router } from 'express';
import {
  parseInterviewLessonText,
  saveImportedInterviewLesson,
  listInterviewLessons,
  getInterviewLesson,
  deleteInterviewLesson,
} from '../interviewLessonImporter.js';

const router = Router();

// GET /api/interview-lessons — cards for the Interview list page.
router.get('/', (_req, res) => {
  res.json(listInterviewLessons());
});

// POST /api/interview-lessons/import { text } — parses the plain-text
// format (see interviewLessonImporter.js) and creates/updates a lesson.
router.post('/import', (req, res) => {
  const { text } = req.body || {};
  if (!text || typeof text !== 'string') {
    return res.status(400).json({ error: 'text is required' });
  }
  let lesson;
  try {
    lesson = parseInterviewLessonText(text);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
  const meta = saveImportedInterviewLesson(lesson);
  res.status(201).json(meta);
});

// GET /api/interview-lessons/:courseId — full lesson content, in the same
// shape LessonPlayer.js already renders for the static lesson files.
router.get('/:courseId', (req, res) => {
  const lesson = getInterviewLesson(req.params.courseId);
  if (!lesson) return res.status(404).json({ error: 'lesson not found' });
  res.json(lesson);
});

router.delete('/:courseId', (req, res) => {
  try {
    deleteInterviewLesson(req.params.courseId);
    res.json({ ok: true });
  } catch (err) {
    res.status(404).json({ error: err.message });
  }
});

export default router;
