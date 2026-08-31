import { Router } from 'express';
import multer from 'multer';
import { transcribeAudio } from '../asr.js';

const router = Router();
// A single spoken sentence is nowhere near this; it just guards against
// something going wrong client-side rather than being a real expected
// ceiling.
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

// POST /api/asr/transcribe (multipart "audio", a WAV file) — returns the
// transcribed text via the self-hosted Whisper container. No per-account
// setup needed: it's our own service, not a third-party API key.
router.post('/transcribe', upload.single('audio'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'an audio file is required' });

  // hotwords may arrive as one string or several same-named fields
  // (multer/busboy gives an array for repeated multipart field names).
  const hotwords = Array.isArray(req.body?.hotwords)
    ? req.body.hotwords
    : req.body?.hotwords
      ? [req.body.hotwords]
      : undefined;

  try {
    const text = await transcribeAudio({
      audioBuffer: req.file.buffer,
      mimeType: req.file.mimetype || 'audio/wav',
      filename: req.file.originalname || 'audio.wav',
      hotwords,
    });
    res.json({ text });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

export default router;
