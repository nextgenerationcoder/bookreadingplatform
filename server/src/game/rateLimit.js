// Per-user rate limit on the game's AI-calling routes (POST /start,
// /choose, /skill-check-answer, /ask-ai - see routes/game.js) - each
// account's own AI key still pays for its own calls, but a runaway client
// (a buggy retry loop, or someone scripting the game) could otherwise burn
// through that key's quota/budget fast. A plain sliding window, backed by
// game_ai_calls (db.js) rather than an in-memory counter, so it survives a
// redeploy instead of silently resetting everyone's quota.
//
// Configurable via GAME_AI_RATE_LIMIT_PER_HOUR (default 60) - set low for
// a quick manual test, or raise/lower in production without a code change.
import { db } from '../db.js';

const WINDOW_MS = 60 * 60 * 1000;
const DEFAULT_LIMIT_PER_HOUR = 60;

function getLimit() {
  const raw = Number(process.env.GAME_AI_RATE_LIMIT_PER_HOUR);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_LIMIT_PER_HOUR;
}

export function gameAiRateLimit(req, res, next) {
  const limit = getLimit();
  const now = Date.now();
  const windowStartIso = new Date(now - WINDOW_MS).toISOString();

  // Self-cleaning: drop this user's own calls that fell out of the window
  // before counting, so the table never grows past "recent calls per
  // active user" - no separate cleanup job needed.
  db.prepare('DELETE FROM game_ai_calls WHERE user_id = ? AND called_at < ?').run(req.userId, windowStartIso);

  const { count } = db.prepare('SELECT COUNT(*) AS count FROM game_ai_calls WHERE user_id = ?').get(req.userId);
  if (count >= limit) {
    return res.status(429).json({ error: `Rate limit reached (${limit} AI turns per hour) - please wait a bit and try again.` });
  }

  db.prepare('INSERT INTO game_ai_calls (user_id, called_at) VALUES (?, ?)').run(req.userId, new Date(now).toISOString());
  next();
}
