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
  getCoursePageAudio,
  setCoursePageAudio,
  getCoursePageShadowingChunks,
  setCoursePageShadowingChunks,
  listCoursePageNotes,
  createCoursePageNote,
  updateCoursePageNoteText,
  deleteCoursePageNote,
} from '../courseImporter.js';
import { db } from '../db.js';
import { decrypt } from '../crypto.js';
import { transcribeWithWordTimestamps } from '../asr.js';
import { groupWordsIntoChunks } from '../shadowingChunker.js';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });
// A narration MP3 runs well past the 10MB cap above once a lesson is more
// than a few minutes long - its own, larger limit.
const audioUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

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

// POST /api/courses/:courseId/pages/:pageNumber/audio (multipart "file", an
// .mp3) — attaches/replaces one page's narration track. Independent of the
// page's own text/HTML content (see courseImporter.js's replaceHtmlPage/
// replacePage, which both now preserve this column across a content
// replace instead of silently wiping it).
router.post('/:courseId/pages/:pageNumber/audio', audioUpload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'file is required' });
  const pageNumber = Number(req.params.pageNumber);
  try {
    setCoursePageAudio(req.params.courseId, pageNumber, req.file.buffer);
    res.json({ ok: true });
  } catch (err) {
    res.status(404).json({ error: err.message });
  }
});

// GET /api/courses/:courseId/pages/:pageNumber/audio — the narration track,
// with HTTP Range support so the player (an <audio> element) can seek
// without re-downloading everything before that point.
router.get('/:courseId/pages/:pageNumber/audio', (req, res) => {
  const pageNumber = Number(req.params.pageNumber);
  const buffer = getCoursePageAudio(req.params.courseId, pageNumber);
  if (!buffer) return res.status(404).send('Not found');

  res.setHeader('Content-Type', 'audio/mpeg');
  res.setHeader('Accept-Ranges', 'bytes');

  const range = req.headers.range;
  const match = range && range.match(/^bytes=(\d*)-(\d*)$/);
  if (match && (match[1] || match[2])) {
    const start = match[1] ? Number(match[1]) : buffer.length - Number(match[2]);
    const end = match[2] && match[1] ? Math.min(Number(match[2]), buffer.length - 1) : buffer.length - 1;
    if (start >= buffer.length || start > end) {
      res.status(416).setHeader('Content-Range', `bytes */${buffer.length}`).end();
      return;
    }
    res.status(206);
    res.setHeader('Content-Range', `bytes ${start}-${end}/${buffer.length}`);
    res.setHeader('Content-Length', end - start + 1);
    res.end(buffer.subarray(start, end + 1));
    return;
  }

  res.setHeader('Content-Length', buffer.length);
  res.end(buffer);
});

// GET /api/courses/:courseId/pages/:pageNumber/shadowing-chunks - small
// listen-then-repeat chunks for shadowing practice (see
// shadowingChunker.js), computed from the page's own narration track.
// Cached in course_pages.shadowing_chunks once computed (shared across
// every learner, not per-account) - this route only ever transcribes on a
// cache miss, using whichever account happens to request it first their
// own Groq key (the same one the mic button already uses), same BYO-key
// convention as the rest of the app's AI features.
router.get('/:courseId/pages/:pageNumber/shadowing-chunks', async (req, res) => {
  const pageNumber = Number(req.params.pageNumber);
  const cached = getCoursePageShadowingChunks(req.params.courseId, pageNumber);
  if (cached) return res.json({ chunks: cached });

  const buffer = getCoursePageAudio(req.params.courseId, pageNumber);
  if (!buffer) return res.status(404).json({ error: 'this page has no narration track' });

  const row = db.prepare('SELECT asr_provider, asr_api_key_enc FROM users WHERE id = ?').get(req.userId);
  const provider = row?.asr_provider || 'groq';
  if (!row?.asr_api_key_enc) {
    return res.status(400).json({ error: 'Add a Groq API key in Settings to use shadowing mode.' });
  }

  let apiKey;
  try {
    apiKey = await decrypt(row.asr_api_key_enc);
  } catch (err) {
    console.error('shadowing-chunks: failed to decrypt Groq API key:', err);
    return res.status(500).json({ error: 'Failed to read your Groq API key — try re-saving it in Settings.' });
  }

  try {
    const words = await transcribeWithWordTimestamps({ provider, apiKey, audioBuffer: buffer, mimeType: 'audio/mpeg' });
    const chunks = groupWordsIntoChunks(words);
    setCoursePageShadowingChunks(req.params.courseId, pageNumber, chunks);
    res.json({ chunks });
  } catch (err) {
    console.error('shadowing-chunks: transcription failed:', err);
    res.status(502).json({ error: err.message });
  }
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
