import { Router } from 'express';
import { db } from '../db.js';
import { encrypt } from '../crypto.js';

const router = Router();

// Providers the settings form accepts today. What actually calls this key is
// intentionally not wired up yet - this route only stores/reports/clears it.
export const LLM_PROVIDERS = ['anthropic', 'openai'];

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

export default router;
