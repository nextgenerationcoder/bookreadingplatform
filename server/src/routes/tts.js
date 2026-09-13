import { Router } from 'express';
import { db } from '../db.js';
import { synthesize, VOICES, DEFAULT_VOICE, DEFAULT_RATE, MIN_RATE, MAX_RATE } from '../tts.js';

const router = Router();

router.get('/voices', (_req, res) => {
  const voices = Object.entries(VOICES).map(([id, v]) => ({ id, label: v.label }));
  res.json({ voices, defaultVoice: DEFAULT_VOICE, minRate: MIN_RATE, maxRate: MAX_RATE, defaultRate: DEFAULT_RATE });
});

// POST /api/tts/synthesize { text } — reads the account's saved voice/speed
// (Settings > Voice) and returns { audio: <base64 WAV>, words, timings,
// durationSeconds }. First call for a given voice can take a while (lazy
// model download); later calls are fast.
router.post('/synthesize', async (req, res) => {
  const { text } = req.body || {};
  if (!text || typeof text !== 'string' || !text.trim()) {
    return res.status(400).json({ error: 'text is required' });
  }

  const row = db.prepare('SELECT voice_id, speech_rate FROM users WHERE id = ?').get(req.userId);

  try {
    const result = await synthesize(text, {
      voiceId: row?.voice_id,
      speechRate: row?.speech_rate,
    });
    res.json({
      audio: result.audio.toString('base64'),
      words: result.words,
      timings: result.timings,
      durationSeconds: result.durationSeconds,
    });
  } catch (err) {
    console.error('TTS synthesis failed:', err);
    res.status(502).json({ error: err.message });
  }
});

export default router;
