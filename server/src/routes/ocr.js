import { Router } from 'express';
import multer from 'multer';
import { db } from '../db.js';
import { decrypt } from '../crypto.js';
import { formatPageFromImage } from '../llm.js';
import { buildPageBlock } from '../bookImporter.js';

const router = Router();
const MAX_PHOTOS = 10;
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: MAX_PHOTOS },
});

// POST /api/ocr/batch (multipart: up to 10 "images", + startPage, chapter)
// — reads each photo directly with the caller's own vision API key (see
// /api/settings/vision) and returns one page block per photo, already in
// the PAGE/CHAPTER/"N: sentence" import format, concatenated for review
// before saving. Requires a configured vision key; there's no local-OCR
// fallback here on purpose - a vision model reading the photo directly
// gives far better transcription + translation quality than OCR-then-
// translate did.
router.post('/batch', upload.array('images', MAX_PHOTOS), async (req, res) => {
  const files = req.files || [];
  if (!files.length) return res.status(400).json({ error: 'at least one photo is required' });
  if (files.length > MAX_PHOTOS) {
    return res.status(400).json({ error: `at most ${MAX_PHOTOS} photos per batch` });
  }
  const startPage = Number(req.body?.startPage);
  if (!Number.isFinite(startPage)) return res.status(400).json({ error: 'startPage must be a number' });
  const chapter = (req.body?.chapter || '').trim();

  const row = db.prepare('SELECT vision_provider, vision_api_key_enc FROM users WHERE id = ?').get(req.userId);
  if (!row?.vision_provider || !row?.vision_api_key_enc) {
    return res.status(400).json({ error: 'no vision API key configured — add one in Settings first' });
  }

  const apiKey = await decrypt(row.vision_api_key_enc);
  const results = [];
  const errors = [];

  // Sequential on purpose: keeps this within the account's own rate limits
  // and means one bad photo's error doesn't take the rest of the batch down.
  for (let i = 0; i < files.length; i++) {
    const pageNumber = startPage + i;
    try {
      const { sentences } = await formatPageFromImage({
        provider: row.vision_provider,
        apiKey,
        imageBase64: files[i].buffer.toString('base64'),
        mimeType: files[i].mimetype,
        chapter,
      });
      if (!sentences.length) {
        errors.push({ index: i, pageNumber, error: 'No readable text found in this photo' });
        continue;
      }
      results.push(buildPageBlock(pageNumber, chapter, sentences));
    } catch (err) {
      console.error(`AI page analysis failed for photo ${i + 1}:`, err);
      errors.push({ index: i, pageNumber, error: err.message });
    }
  }

  if (!results.length) {
    return res.status(502).json({ error: 'None of the photos could be read.', errors });
  }

  res.json({ text: results.join('\n\n'), pagesFound: results.length, errors });
});

export default router;
