import { Router } from 'express';
import multer from 'multer';
import { ocrImage } from '../ocr.js';
import { translateWord } from '../translate.js';

const router = Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

// POST /api/ocr/scan (multipart, field "image") — extracts raw German text
// from a photo of a book page. Returns text only; nothing is saved here, so
// the caller can review/fix OCR mistakes before importing it as a page.
router.post('/scan', upload.single('image'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'image is required' });
  try {
    const text = await ocrImage(req.file.buffer);
    res.json({ text });
  } catch (err) {
    console.error('OCR failed:', err);
    res.status(500).json({ error: 'OCR failed: ' + err.message });
  }
});

// POST /api/ocr/translate { lines: string[] } — best-effort Persian
// translation per line (reuses the same free translation API as the
// dictionary's auto-translate fallback), so a scanned page doesn't need
// hand-translating from scratch. Capped since this is meant for one page's
// worth of sentences, not bulk text.
router.post('/translate', async (req, res) => {
  const { lines } = req.body || {};
  if (!Array.isArray(lines) || !lines.length) {
    return res.status(400).json({ error: 'lines is required' });
  }
  const capped = lines.slice(0, 80);
  const translations = await Promise.all(
    capped.map(async (line) => (await translateWord(String(line))) || '')
  );
  res.json({ translations });
});

export default router;
