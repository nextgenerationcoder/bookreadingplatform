import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';

const TEST_DB_DIR = await fs.mkdtemp(path.join(os.tmpdir(), 'game-ratelimit-test-'));
process.env.DB_PATH = path.join(TEST_DB_DIR, 'test.db');

const { gameAiRateLimit } = await import('../game/rateLimit.js');
const { db } = await import('../db.js');

// game_ai_calls.user_id has a real FOREIGN KEY on users(id) (db.js runs
// with `PRAGMA foreign_keys = ON`) - unlike some older tables in this app,
// so each user_id the tests use below must be a real row first.
function ensureUser(id) {
  db.prepare("INSERT OR IGNORE INTO users (id, email, password_hash, created_at) VALUES (?, ?, 'x', datetime('now'))").run(id, `${id}@example.com`);
}

test.after(async () => {
  db.close();
  await fs.rm(TEST_DB_DIR, { recursive: true, force: true });
});

function fakeRes() {
  return {
    statusCode: null,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
}

function callLimiter(userId) {
  return new Promise((resolve) => {
    const res = fakeRes();
    gameAiRateLimit({ userId }, res, () => resolve({ allowed: true, res }));
    // next() resolves synchronously above if called; if the middleware
    // instead returned a response without calling next(), resolve with that.
    if (res.statusCode !== null) resolve({ allowed: false, res });
  });
}

test('gameAiRateLimit allows requests up to the configured limit, then blocks with 429', async () => {
  process.env.GAME_AI_RATE_LIMIT_PER_HOUR = '3';
  const userId = 'rl-user-1';
  ensureUser(userId);
  for (let i = 0; i < 3; i++) {
    const { allowed } = await callLimiter(userId);
    assert.equal(allowed, true, `call ${i + 1} should be allowed`);
  }
  const fourth = await callLimiter(userId);
  assert.equal(fourth.allowed, false);
  assert.equal(fourth.res.statusCode, 429);
  assert.match(fourth.res.body.error, /rate limit/i);
});

test('gameAiRateLimit tracks each user independently', async () => {
  process.env.GAME_AI_RATE_LIMIT_PER_HOUR = '1';
  ensureUser('rl-user-a');
  ensureUser('rl-user-b');
  const a = await callLimiter('rl-user-a');
  const b = await callLimiter('rl-user-b');
  assert.equal(a.allowed, true);
  assert.equal(b.allowed, true, "a different user's quota must not be shared");
  const aAgain = await callLimiter('rl-user-a');
  assert.equal(aAgain.allowed, false, 'the first user is now over their own limit');
});

test('gameAiRateLimit ignores calls that fell outside the 1-hour window', async () => {
  process.env.GAME_AI_RATE_LIMIT_PER_HOUR = '1';
  const userId = 'rl-user-old';
  ensureUser(userId);
  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
  db.prepare('INSERT INTO game_ai_calls (user_id, called_at) VALUES (?, ?)').run(userId, twoHoursAgo);

  // The stale row above must not count against the limit (and the
  // limiter's own self-cleaning should delete it).
  const result = await callLimiter(userId);
  assert.equal(result.allowed, true);
  const remaining = db.prepare('SELECT COUNT(*) AS c FROM game_ai_calls WHERE user_id = ? AND called_at = ?').get(userId, twoHoursAgo);
  assert.equal(remaining.c, 0, 'the stale row should have been cleaned up');
});

test('gameAiRateLimit falls back to the default limit for an invalid/unset env value', async () => {
  delete process.env.GAME_AI_RATE_LIMIT_PER_HOUR;
  const userId = 'rl-user-default';
  ensureUser(userId);
  // Default is 60/hour - a handful of calls should all still succeed.
  for (let i = 0; i < 5; i++) {
    const { allowed } = await callLimiter(userId);
    assert.equal(allowed, true);
  }
});
