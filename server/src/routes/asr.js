import { Router } from 'express';
import multer from 'multer';
import { db } from '../db.js';
import { decrypt } from '../crypto.js';
import { transcribeAudio } from '../asr.js';

const router = Router();
// Z.AI's limit is 25MB/30s per the API spec; a single spoken sentence is
// nowhere near that, so this cap just guards against something going wrong
// client-side rather than being a real expected ceiling.
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

// POST /api/asr/transcribe (multipart "audio", a WAV file) — returns the
// transcribed text. No fallback/local ASR exists in this app; this always
// calls the account's own configured Z.AI key.
router.post('/transcribe', upload.single('audio'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'an audio file is required' });

  const row = db.prepare('SELECT asr_provider, asr_api_key_enc FROM users WHERE id = ?').get(req.userId);
  if (!row?.asr_provider || !row?.asr_api_key_enc) {
    return res.status(400).json({ error: 'no speech-to-text API key configured — add one in Settings first' });
  }

  // hotwords may arrive as one string or several same-named fields
  // (multer/busboy gives an array for repeated multipart field names).
  const hotwords = Array.isArray(req.body?.hotwords)
    ? req.body.hotwords
    : req.body?.hotwords
      ? [req.body.hotwords]
      : undefined;

  try {
    const apiKey = await decrypt(row.asr_api_key_enc);
    const text = await transcribeAudio({
      provider: row.asr_provider,
      apiKey,
      audioBuffer: req.file.buffer,
      mimeType: req.file.mimetype || 'audio/wav',
      filename: req.file.originalname || 'audio.wav',
      prompt: typeof req.body?.prompt === 'string' ? req.body.prompt : undefined,
      hotwords,
    });
    res.json({ text });
  } catch (err) {
    console.error('ASR transcription failed:', err);
    res.status(502).json({ error: err.message });
  }
});

export default router;
