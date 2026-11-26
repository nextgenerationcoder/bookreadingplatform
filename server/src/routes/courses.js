import { Router } from 'express';
import multer from 'multer';
import {
  CEFR_LEVELS,
  parseCourseText,
  saveImportedCourse,
  appendToCourse,
  renameCourse,
  deleteCoursePage,
  listCourses,
  getCourse,
  createCourseFromHtml,
  addHtmlPageToCourse,
  getCoursePageHtml,
  listCoursePageNotes,
  createCoursePageNote,
  updateCoursePageNoteText,
  deleteCoursePageNote,
} from '../courseImporter.js';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

function parseLang(raw) {
  const match = typeof raw === 'string' && raw.match(/^(\w+)\s*->\s*(\w+)$/);
  return match ? { source: match[1], target: match[2] } : { source: 'de', target: 'fa' };
}

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

// POST /api/courses/html (multipart "file", an .html page, plus courseId/
// title/level/pageNumber/chapter fields) — creates a brand-new course (or
// replaces an existing one's page, if courseId already exists) whose page
// is a self-contained HTML document instead of bilingual sentence pairs.
// Reuses the same "upload your own HTML" idea as /api/worksheets, so this
// page gets the same clickable-word/"Notiz"/"Extract pattern" interactivity
// once rendered — see client/src/views/worksheets.js's
// applyClickableTextInsideFrame, reused by the reader for this.
router.post('/html', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'file is required' });
  const { courseId, title, level, chapter } = req.body || {};
  const pageNumber = Number(req.body?.pageNumber);
  if (!courseId || typeof courseId !== 'string' || !courseId.trim()) {
    return res.status(400).json({ error: 'courseId is required' });
  }
  if (!title || typeof title !== 'string' || !title.trim()) {
    return res.status(400).json({ error: 'title is required' });
  }
  if (!level || !CEFR_LEVELS.includes(level)) {
    return res.status(400).json({ error: `level must be one of: ${CEFR_LEVELS.join(', ')}` });
  }
  if (!Number.isFinite(pageNumber) || pageNumber < 1) {
    return res.status(400).json({ error: 'pageNumber must be a positive integer' });
  }
  const html = req.file.buffer.toString('utf-8');
  const meta = createCourseFromHtml({
    courseId: courseId.trim(),
    title: title.trim(),
    level,
    lang: parseLang(req.body?.lang),
    pageNumber,
    chapter: (chapter || '').trim(),
    html,
  });
  res.status(201).json(meta);
});

// POST /api/courses/:courseId/pages/html (multipart "file", plus pageNumber/
// chapter fields) — adds (or replaces) one HTML page on an existing course.
router.post('/:courseId/pages/html', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'file is required' });
  const pageNumber = Number(req.body?.pageNumber);
  if (!Number.isFinite(pageNumber) || pageNumber < 1) {
    return res.status(400).json({ error: 'pageNumber must be a positive integer' });
  }
  const html = req.file.buffer.toString('utf-8');
  try {
    const meta = addHtmlPageToCourse(req.params.courseId, {
      pageNumber,
      chapter: (req.body?.chapter || '').trim(),
      html,
    });
    res.status(201).json(meta);
  } catch (err) {
    const status = err.message.includes('not found') ? 404 : 400;
    res.status(status).json({ error: err.message });
  }
});

// GET /api/courses/:courseId/pages/:pageNumber/view — the raw HTML of an
// HTML-type page, shown in an <iframe> by the client (see worksheets'
// equivalent /:id/view route for why: the page's own styling/script should
// run exactly as uploaded, isolated from the app's own page).
router.get('/:courseId/pages/:pageNumber/view', (req, res) => {
  const pageNumber = Number(req.params.pageNumber);
  const html = getCoursePageHtml(req.params.courseId, pageNumber);
  if (!html) return res.status(404).send('Not found');
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(html);
});

// --- Freely-placed notes (right-click -> "Notiz" on an HTML course page) -
// scoped per-account even though the course content itself is shared (see
// db.js's course_page_notes comment).

router.get('/:courseId/pages/:pageNumber/notes', (req, res) => {
  const pageNumber = Number(req.params.pageNumber);
  res.json({ notes: listCoursePageNotes(req.userId, req.params.courseId, pageNumber) });
});

router.post('/:courseId/pages/:pageNumber/notes', (req, res) => {
  const pageNumber = Number(req.params.pageNumber);
  const { blockIndex, charOffset, text } = req.body || {};
  if (!Number.isInteger(blockIndex) || blockIndex < 0) return res.status(400).json({ error: 'blockIndex must be a non-negative integer' });
  if (!Number.isInteger(charOffset) || charOffset < 0) return res.status(400).json({ error: 'charOffset must be a non-negative integer' });
  const id = createCoursePageNote({ userId: req.userId, courseId: req.params.courseId, pageNumber, blockIndex, charOffset, text: text || '' });
  res.status(201).json({ id });
});

router.put('/:courseId/pages/:pageNumber/notes/:noteId', (req, res) => {
  const pageNumber = Number(req.params.pageNumber);
  const { text } = req.body || {};
  if (typeof text !== 'string') return res.status(400).json({ error: 'text is required' });
  const ok = updateCoursePageNoteText(req.userId, req.params.courseId, pageNumber, req.params.noteId, text);
  if (!ok) return res.status(404).json({ error: 'not found' });
  res.json({ ok: true });
});

router.delete('/:courseId/pages/:pageNumber/notes/:noteId', (req, res) => {
  const pageNumber = Number(req.params.pageNumber);
  const ok = deleteCoursePageNote(req.userId, req.params.courseId, pageNumber, req.params.noteId);
  if (!ok) return res.status(404).json({ error: 'not found' });
  res.json({ ok: true });
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
