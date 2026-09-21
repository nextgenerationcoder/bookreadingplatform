import { Router } from 'express';
import multer from 'multer';
import { db } from '../db.js';
import { decrypt } from '../crypto.js';
import { transcribeAudio } from '../asr.js';

const router = Router();
// A single spoken sentence is nowhere near this; it just guards against
// something going wrong client-side rather than being a real expected
// ceiling.
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

// POST /api/asr/transcribe (multipart "audio", a WAV file) — returns the
// transcribed text via Groq (see asr.js). Needs the account's own Groq API
// key configured in Settings; there's no keyless default anymore now that
// the self-hosted Whisper container is gone.
router.post('/transcribe', upload.single('audio'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'an audio file is required' });

  // hotwords may arrive as one string or several same-named fields
  // (multer/busboy gives an array for repeated multipart field names).
  const hotwords = Array.isArray(req.body?.hotwords)
    ? req.body.hotwords
    : req.body?.hotwords
      ? [req.body.hotwords]
      : undefined;

  const row = db.prepare('SELECT asr_provider, asr_api_key_enc FROM users WHERE id = ?').get(req.userId);
  const provider = row?.asr_provider || 'groq';
  const apiKey = row?.asr_api_key_enc ? await decrypt(row.asr_api_key_enc) : null;
  if (!apiKey) {
    return res.status(400).json({ error: 'Add a Groq API key in Settings to use the mic button.' });
  }

  try {
    const text = await transcribeAudio({
      provider,
      apiKey,
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
