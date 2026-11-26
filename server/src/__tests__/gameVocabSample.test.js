import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';

const TEST_DB_DIR = await fs.mkdtemp(path.join(os.tmpdir(), 'game-vocab-sample-test-'));
process.env.DB_PATH = path.join(TEST_DB_DIR, 'test.db');

const { pickLearnedSample, pickTargetWords } = await import('../game/vocab.js');
const { db } = await import('../db.js');

test.after(async () => {
  db.close();
  await fs.rm(TEST_DB_DIR, { recursive: true, force: true });
});

function ensureUser(id) {
  db.prepare("INSERT OR IGNORE INTO users (id, email, password_hash, created_at) VALUES (?, ?, 'x', datetime('now'))").run(id, `${id}@example.com`);
}

function seedWord(userId, german, status) {
  ensureUser(userId);
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO vocab_progress (user_id, german, persian, times_seen, times_correct_total, correct_streak, status, first_seen_at, last_seen_at, learned_at)
     VALUES (?, ?, 'x', 1, 0, 0, ?, ?, ?, ?)`
  ).run(userId, german, status, now, now, status === 'learned' ? now : null);
}

test('pickLearnedSample draws from both "learned" and "passive", never "learning"', () => {
  const userId = 'vocab-sample-user-1';
  seedWord(userId, 'Haus', 'learned');
  seedWord(userId, 'Auto', 'passive');
  seedWord(userId, 'Fenster', 'learning');

  const sample = pickLearnedSample(userId, 10);
  assert.ok(sample.includes('Haus'));
  assert.ok(sample.includes('Auto'));
  assert.ok(!sample.includes('Fenster'), '"learning" words must stay reserved for pickTargetWords, not the general sample');
});

test('pickLearnedSample respects the limit even when more rows qualify', () => {
  const userId = 'vocab-sample-user-2';
  for (let i = 0; i < 20; i++) seedWord(userId, `Wort${i}`, i % 2 === 0 ? 'learned' : 'passive');

  const sample = pickLearnedSample(userId, 5);
  assert.equal(sample.length, 5);
});

test('pickTargetWords only returns "learning" words, oldest last_seen_at first', () => {
  const userId = 'vocab-sample-user-3';
  ensureUser(userId);
  const now = new Date();
  const older = new Date(now.getTime() - 60_000).toISOString();
  const newer = now.toISOString();
  db.prepare(
    `INSERT INTO vocab_progress (user_id, german, persian, times_seen, times_correct_total, correct_streak, status, first_seen_at, last_seen_at, learned_at)
     VALUES (?, 'Alt', 'قدیمی', 1, 0, 0, 'learning', ?, ?, NULL)`
  ).run(userId, older, older);
  db.prepare(
    `INSERT INTO vocab_progress (user_id, german, persian, times_seen, times_correct_total, correct_streak, status, first_seen_at, last_seen_at, learned_at)
     VALUES (?, 'Neu', 'جدید', 1, 0, 0, 'learning', ?, ?, NULL)`
  ).run(userId, newer, newer);
  seedWord(userId, 'Bekannt', 'learned');

  const targets = pickTargetWords(userId, 5);
  assert.deepEqual(targets.map((t) => t.german), ['Alt', 'Neu'], 'least-recently-seen learning word first, no learned/passive words mixed in');
});
