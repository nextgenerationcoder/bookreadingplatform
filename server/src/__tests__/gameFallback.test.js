import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';

const TEST_DB_DIR = await fs.mkdtemp(path.join(os.tmpdir(), 'game-fallback-test-'));
process.env.DB_PATH = path.join(TEST_DB_DIR, 'test.db');
process.env.ENCRYPTION_KEY = 'b'.repeat(64);

const { runGameTurnOrFallback } = await import('../game/ai.js');
const { db } = await import('../db.js');

test.after(async () => {
  db.close();
  await fs.rm(TEST_DB_DIR, { recursive: true, force: true });
});

function ensureUser(id) {
  db.prepare("INSERT OR IGNORE INTO users (id, email, password_hash, created_at) VALUES (?, ?, 'x', datetime('now'))").run(id, `${id}@example.com`);
}

// A user with NO llm_provider/llm_api_key_enc configured makes
// game/ai.js's getAccountKey() throw immediately, before any network call -
// a real, deterministic way to force runGameTurn() to fail without mocking
// fetch at all.
function ensureUserWithoutApiKey(id) {
  ensureUser(id);
}

function insertSession(id, userId) {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO game_sessions (id, user_id, state_json, pending_json, turn, status, created_at, updated_at)
     VALUES (?, ?, '{}', '{}', 1, 'active', ?, ?)`
  ).run(id, userId, now, now);
}

function getFailureCount(sessionId) {
  return db.prepare('SELECT ai_failure_count AS c FROM game_sessions WHERE id = ?').get(sessionId).c;
}

const params = { summary: 'Test.', lastChoiceText: 'Test choice', effectsDescription: 'Nothing special.', fired: false };

test('runGameTurnOrFallback: a lone failure still throws, and bumps the session failure count to 1', async () => {
  const userId = 'fb-user-1';
  const sessionId = 'fb-session-1';
  ensureUserWithoutApiKey(userId);
  insertSession(sessionId, userId);

  await assert.rejects(() => runGameTurnOrFallback(userId, params, { sessionId }));
  assert.equal(getFailureCount(sessionId), 1);
});

test('runGameTurnOrFallback: a SECOND consecutive failure returns a fallback scene instead of throwing, and resets the count', async () => {
  const userId = 'fb-user-2';
  const sessionId = 'fb-session-2';
  ensureUserWithoutApiKey(userId);
  insertSession(sessionId, userId);

  await assert.rejects(() => runGameTurnOrFallback(userId, params, { sessionId })); // 1st failure
  const { result, usedFallback } = await runGameTurnOrFallback(userId, params, { sessionId }); // 2nd failure

  assert.equal(usedFallback, true);
  assert.ok(result.scene && result.scene.length > 0);
  assert.equal(result.choices.length, 2);
  assert.equal(result.summary, null, 'a non-fired fallback should signal "keep the previous summary"');
  assert.deepEqual(result.wordsUsed, []);
  for (const choice of result.choices) {
    assert.equal(choice.tags.check, null, 'a fallback choice must never offer a skill check (that needs its own AI call)');
  }
  assert.equal(getFailureCount(sessionId), 0, 'the counter resets once a (fallback) turn resolves');
});

test('runGameTurnOrFallback: when fired=true, the fallback scene has zero choices (a firing scene, not a normal one)', async () => {
  const userId = 'fb-user-3';
  const sessionId = 'fb-session-3';
  ensureUserWithoutApiKey(userId);
  insertSession(sessionId, userId);

  await assert.rejects(() => runGameTurnOrFallback(userId, { ...params, fired: true }, { sessionId, fired: true }));
  const { result, usedFallback } = await runGameTurnOrFallback(userId, { ...params, fired: true }, { sessionId, fired: true });

  assert.equal(usedFallback, true);
  assert.equal(result.choices.length, 0, 'a fired fallback must offer no choices, like a real firing turn would');
});

test('runGameTurnOrFallback: with no sessionId (POST /start), two failures within the SAME call return a fallback opening scene', async () => {
  const userId = 'fb-user-4';
  ensureUserWithoutApiKey(userId);

  const { result, usedFallback } = await runGameTurnOrFallback(userId, { summary: null, lastChoiceText: null });

  assert.equal(usedFallback, true);
  assert.equal(result.outcome, '', 'an opening scene has no previous choice to resolve');
  assert.equal(result.choices.length, 2);
  assert.ok(typeof result.summary === 'string' && result.summary.length > 0, 'unlike the mid-game fallback, the opening one supplies a real starting summary');
});

test('runGameTurnOrFallback: a successful call resets a previously-bumped failure count to 0', async () => {
  const userId = 'fb-user-5';
  const sessionId = 'fb-session-5';
  ensureUserWithoutApiKey(userId);
  insertSession(sessionId, userId);

  await assert.rejects(() => runGameTurnOrFallback(userId, params, { sessionId })); // bump to 1
  assert.equal(getFailureCount(sessionId), 1);

  // Give the user a (fake but present) API key so getAccountKey succeeds
  // this time, and mock the actual AI call to succeed - a REAL success,
  // not a fallback, must reset the counter too.
  const { encrypt } = await import('../crypto.js');
  db.prepare('UPDATE users SET llm_provider = ?, llm_api_key_enc = ? WHERE id = ?').run('anthropic', await encrypt('sk-fake'), userId);

  const realFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        content: [
          {
            type: 'tool_use',
            name: 'record_turn',
            input: {
              outcome: 'Alles lief gut.',
              scene: 'Ein ruhiger Moment im Büro.',
              choices: [
                { text: 'A', tags: { frech: 0, chef_sieht: false, betrifft: null, flirt: false, check: null } },
                { text: 'B', tags: { frech: 1, chef_sieht: false, betrifft: null, flirt: false, check: null } },
              ],
              summary: 'Kurzer Rückblick.',
              words_used: [],
            },
          },
        ],
      }),
      { status: 200 }
    );
  try {
    const { usedFallback } = await runGameTurnOrFallback(userId, params, { sessionId });
    assert.equal(usedFallback, false);
  } finally {
    globalThis.fetch = realFetch;
  }
  assert.equal(getFailureCount(sessionId), 0, 'a real success must reset the counter too, not just a fallback one');
});
