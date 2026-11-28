// "Show my own HTML worksheet" - upload a self-contained HTML page and get
// it back exactly as uploaded, nothing parsed or extracted. Private per
// account: one learner's worksheets are never visible to another.

import { Router } from 'express';
import multer from 'multer';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import {
  saveWorksheet,
  listWorksheets,
  getWorksheet,
  deleteWorksheet,
  WORKSHEETS_DIR,
  listWorksheetNotes,
  createWorksheetNote,
  updateWorksheetNoteText,
  deleteWorksheetNote,
} from '../worksheets.js';
import { db } from '../db.js';
import { decrypt } from '../crypto.js';
import { answerQuestion } from '../llm.js';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

function titleFromHtml(html, fallback) {
  const h1 = html.match(/<h1[^>]*>([^<]*)<\/h1>/i);
  if (h1?.[1]?.trim()) return h1[1].trim();
  const title = html.match(/<title[^>]*>([^<]*)<\/title>/i);
  if (title?.[1]?.trim()) return title[1].trim();
  return fallback;
}

// POST /api/worksheets (multipart "file", an .html file; optional "title")
router.post('/', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'file is required' });
  const html = req.file.buffer.toString('utf-8');
  const title = (req.body?.title || '').trim() || titleFromHtml(html, req.file.originalname.replace(/\.html?$/i, ''));

  const id = await saveWorksheet({ userId: req.userId, title, html });
  res.status(201).json({ id, title });
});

// GET /api/worksheets - this account's own worksheets, most recent first.
router.get('/', (req, res) => {
  res.json({ worksheets: listWorksheets(req.userId) });
});

// GET /api/worksheets/:id/view - the raw HTML, shown in an <iframe> by the
// client so the worksheet's own styling/script (answer-saving, print
// button) runs exactly as built, isolated from the app's own page.
router.get('/:id/view', async (req, res) => {
  const worksheet = getWorksheet(req.userId, req.params.id);
  if (!worksheet) return res.status(404).send('Not found');
  try {
    const html = await fs.readFile(path.join(WORKSHEETS_DIR, worksheet.filePath), 'utf-8');
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  } catch {
    res.status(404).send('Worksheet file missing on disk');
  }
});

// POST /api/worksheets/ask-ai { question } - backs the "/ai ... ---" command
// a learner can type into a worksheet note (see the toggleScript appended in
// add-notes.js / the worksheet's own in-page JS). Uses the account's own
// Translation API key (same one Settings/the rest of the app already uses) -
// never a shared server key. Registered before /:id so it can never be
// shadowed by that param route (not that it would collide: different path
// shapes), kept here for readability next to the other worksheet-id routes.
router.post('/ask-ai', async (req, res) => {
  const question = (req.body?.question || '').trim();
  if (!question) return res.status(400).json({ error: 'question is required' });

  const row = db.prepare('SELECT llm_provider, llm_api_key_enc FROM users WHERE id = ?').get(req.userId);
  if (!row?.llm_provider || !row?.llm_api_key_enc) {
    return res.status(400).json({ error: 'no Translation API key configured — add one in Settings first' });
  }

  let apiKey;
  try {
    apiKey = await decrypt(row.llm_api_key_enc);
  } catch (err) {
    console.error('worksheets/ask-ai: failed to decrypt Translation API key:', err);
    return res.status(500).json({ error: 'Failed to read your Translation API key — try re-saving it in Settings.' });
  }

  try {
    const answer = await answerQuestion({ provider: row.llm_provider, apiKey, question });
    res.json({ answer });
  } catch (err) {
    console.error('worksheets/ask-ai: AI call failed:', err);
    res.status(502).json({ error: err.message });
  }
});

router.delete('/:id', async (req, res) => {
  const ok = await deleteWorksheet(req.userId, req.params.id);
  if (!ok) return res.status(404).json({ error: 'not found' });
  res.json({ ok: true });
});

// --- Freely-placed notes (right-click -> "Notiz" anywhere in a worksheet) -
// See worksheets.js's table comment for what blockIndex/charOffset mean -
// both computed client-side from the pristine worksheet HTML, this is just
// storage.

router.get('/:id/notes', (req, res) => {
  if (!getWorksheet(req.userId, req.params.id)) return res.status(404).json({ error: 'not found' });
  res.json({ notes: listWorksheetNotes(req.userId, req.params.id) });
});

router.post('/:id/notes', (req, res) => {
  if (!getWorksheet(req.userId, req.params.id)) return res.status(404).json({ error: 'not found' });
  const { blockIndex, charOffset, text } = req.body || {};
  if (!Number.isInteger(blockIndex) || blockIndex < 0) return res.status(400).json({ error: 'blockIndex must be a non-negative integer' });
  if (!Number.isInteger(charOffset) || charOffset < 0) return res.status(400).json({ error: 'charOffset must be a non-negative integer' });
  const id = createWorksheetNote({ userId: req.userId, worksheetId: req.params.id, blockIndex, charOffset, text: text || '' });
  res.status(201).json({ id });
});

router.put('/:id/notes/:noteId', (req, res) => {
  const { text } = req.body || {};
  if (typeof text !== 'string') return res.status(400).json({ error: 'text is required' });
  const ok = updateWorksheetNoteText(req.userId, req.params.id, req.params.noteId, text);
  if (!ok) return res.status(404).json({ error: 'not found' });
  res.json({ ok: true });
});

router.delete('/:id/notes/:noteId', (req, res) => {
  const ok = deleteWorksheetNote(req.userId, req.params.id, req.params.noteId);
  if (!ok) return res.status(404).json({ error: 'not found' });
  res.json({ ok: true });
});

export default router;
