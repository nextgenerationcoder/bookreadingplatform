import { Router } from 'express';
import { db } from '../db.js';
import { encrypt } from '../crypto.js';
import { LLM_PROVIDERS, VISION_CAPABLE_PROVIDERS } from '../llm.js';
import { ASR_PROVIDERS_LIST } from '../asr.js';
import { VOICES, DEFAULT_VOICE, DEFAULT_RATE, MIN_RATE, MAX_RATE } from '../tts.js';

const router = Router();

// GET /api/settings/llm — never returns the key itself, only whether one is
// set and which provider, so the settings page can show state without ever
// re-displaying a secret once it's saved.
router.get('/llm', (req, res) => {
  const row = db.prepare('SELECT llm_provider FROM users WHERE id = ?').get(req.userId);
  res.json({ provider: row?.llm_provider || null, configured: Boolean(row?.llm_provider) });
});

// POST /api/settings/llm { provider, apiKey } — stored encrypted (see
// crypto.js) and scoped to req.userId, so it's only ever decrypted for that
// same account's own requests - nobody else's requests can reach it.
router.post('/llm', async (req, res) => {
  const { provider, apiKey } = req.body || {};
  if (!LLM_PROVIDERS.includes(provider)) {
    return res.status(400).json({ error: `provider must be one of: ${LLM_PROVIDERS.join(', ')}` });
  }
  if (!apiKey || typeof apiKey !== 'string' || apiKey.trim().length < 8) {
    return res.status(400).json({ error: 'a valid API key is required' });
  }
  const enc = await encrypt(apiKey.trim());
  db.prepare('UPDATE users SET llm_provider = ?, llm_api_key_enc = ? WHERE id = ?').run(provider, enc, req.userId);
  res.json({ provider, configured: true });
});

router.delete('/llm', (req, res) => {
  db.prepare('UPDATE users SET llm_provider = NULL, llm_api_key_enc = NULL WHERE id = ?').run(req.userId);
  res.json({ configured: false });
});

// GET/POST/DELETE /api/settings/vision — a second, independent API key used
// only for reading photos/scanned pages directly (photo batch upload, OCR
// for PDF pages with no text layer). Kept separate from /llm (the text/
// translation key) since a vision-capable key is often a different, pricier
// provider than the cheapest good text model.
router.get('/vision', (req, res) => {
  const row = db.prepare('SELECT vision_provider FROM users WHERE id = ?').get(req.userId);
  res.json({ provider: row?.vision_provider || null, configured: Boolean(row?.vision_provider) });
});

router.post('/vision', async (req, res) => {
  const { provider, apiKey } = req.body || {};
  if (!VISION_CAPABLE_PROVIDERS.includes(provider)) {
    return res.status(400).json({ error: `provider must be one of: ${VISION_CAPABLE_PROVIDERS.join(', ')}` });
  }
  if (!apiKey || typeof apiKey !== 'string' || apiKey.trim().length < 8) {
    return res.status(400).json({ error: 'a valid API key is required' });
  }
  const enc = await encrypt(apiKey.trim());
  db.prepare('UPDATE users SET vision_provider = ?, vision_api_key_enc = ? WHERE id = ?').run(provider, enc, req.userId);
  res.json({ provider, configured: true });
});

router.delete('/vision', (req, res) => {
  db.prepare('UPDATE users SET vision_provider = NULL, vision_api_key_enc = NULL WHERE id = ?').run(req.userId);
  res.json({ configured: false });
});

// GET/POST/DELETE /api/settings/asr — speech-to-text provider config, used
// by the LessonPlayer's spoken-answer input. 'self-hosted' (our own German
// Whisper container) needs no key; 'zai' does. Independent of llm/vision
// for the same reason those are independent of each other.
router.get('/asr', (req, res) => {
  const row = db.prepare('SELECT asr_provider FROM users WHERE id = ?').get(req.userId);
  res.json({ provider: row?.asr_provider || null, configured: Boolean(row?.asr_provider) });
});

router.post('/asr', async (req, res) => {
  const { provider, apiKey } = req.body || {};
  if (!ASR_PROVIDERS_LIST.includes(provider)) {
    return res.status(400).json({ error: `provider must be one of: ${ASR_PROVIDERS_LIST.join(', ')}` });
  }
  // 'self-hosted' is our own container - no per-account key to collect.
  let enc = null;
  if (provider !== 'self-hosted') {
    if (!apiKey || typeof apiKey !== 'string' || apiKey.trim().length < 8) {
      return res.status(400).json({ error: 'a valid API key is required' });
    }
    enc = await encrypt(apiKey.trim());
  }
  db.prepare('UPDATE users SET asr_provider = ?, asr_api_key_enc = ? WHERE id = ?').run(provider, enc, req.userId);
  res.json({ provider, configured: true });
});

router.delete('/asr', (req, res) => {
  db.prepare('UPDATE users SET asr_provider = NULL, asr_api_key_enc = NULL WHERE id = ?').run(req.userId);
  res.json({ configured: false });
});

// GET /api/settings/voice — the account's read-aloud voice/speed, falling
// back to defaults if never set.
router.get('/voice', (req, res) => {
  const row = db.prepare('SELECT voice_id, speech_rate FROM users WHERE id = ?').get(req.userId);
  res.json({
    voiceId: row?.voice_id && VOICES[row.voice_id] ? row.voice_id : DEFAULT_VOICE,
    speechRate: row?.speech_rate ?? DEFAULT_RATE,
  });
});

router.post('/voice', (req, res) => {
  const { voiceId, speechRate } = req.body || {};
  if (!VOICES[voiceId]) {
    return res.status(400).json({ error: `voiceId must be one of: ${Object.keys(VOICES).join(', ')}` });
  }
  const rate = Number(speechRate);
  if (!Number.isFinite(rate) || rate < MIN_RATE || rate > MAX_RATE) {
    return res.status(400).json({ error: `speechRate must be between ${MIN_RATE} and ${MAX_RATE}` });
  }
  db.prepare('UPDATE users SET voice_id = ?, speech_rate = ? WHERE id = ?').run(voiceId, rate, req.userId);
  res.json({ voiceId, speechRate: rate });
});

export default router;
