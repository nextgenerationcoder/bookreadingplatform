import { Router } from 'express';
import { db } from '../db.js';

const router = Router();

// A word "graduates" to learned once it's been answered correctly this many
// times in a row (matches Anki's basic idea of "you know it once you've
// gotten it right enough times") - reset to 0 on any wrong answer, so a
// lucky guess buried among misses doesn't count as mastery. Once learned,
// status doesn't get demoted by a later miss (that would just be
// discouraging and noisy) - streak still resets, so genuinely forgetting a
// word shows up as it taking a fresh streak to re-earn, just not as a
// visible status flip-flop.
const LEARNED_STREAK_THRESHOLD = 10;

// GET /api/vocab — every word this account has been taught, across any
// lesson (A1 or Interview - identity is just the German word/phrase, see
// db.js's vocab_progress table), split into learning vs learned.
router.get('/', (req, res) => {
  const rows = db
    .prepare('SELECT * FROM vocab_progress WHERE user_id = ? ORDER BY last_seen_at DESC')
    .all(req.userId);
  const words = rows.map((r) => ({
    german: r.german,
    persian: r.persian,
    timesSeen: r.times_seen,
    timesCorrectTotal: r.times_correct_total,
    correctStreak: r.correct_streak,
    status: r.status,
    firstSeenAt: r.first_seen_at,
    lastSeenAt: r.last_seen_at,
    learnedAt: r.learned_at,
  }));
  res.json({ words, learnedStreakThreshold: LEARNED_STREAK_THRESHOLD });
});

// POST /api/vocab/record { words: [{german, persian}], correct } — called
// once per answer-check in LessonPlayer.js, for every word introduced in
// that step. Fire-and-forget from the client's point of view: this never
// blocks or affects whether the lesson step itself is marked correct.
router.post('/record', (req, res) => {
  const { words, correct } = req.body || {};
  if (!Array.isArray(words) || !words.length) {
    return res.status(400).json({ error: 'words (non-empty array) is required' });
  }
  if (typeof correct !== 'boolean') {
    return res.status(400).json({ error: 'correct (boolean) is required' });
  }

  const now = new Date().toISOString();
  const getExisting = db.prepare('SELECT * FROM vocab_progress WHERE user_id = ? AND german = ?');
  const insert = db.prepare(
    `INSERT INTO vocab_progress
       (user_id, german, persian, times_seen, times_correct_total, correct_streak, status, first_seen_at, last_seen_at, learned_at)
     VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?, ?)`
  );
  const update = db.prepare(
    `UPDATE vocab_progress
     SET times_seen = times_seen + 1, times_correct_total = times_correct_total + ?,
         correct_streak = ?, status = ?, last_seen_at = ?, learned_at = ?, persian = ?
     WHERE user_id = ? AND german = ?`
  );

  const tx = db.transaction(() => {
    for (const { german, persian } of words) {
      if (!german || !persian) continue;
      const existing = getExisting.get(req.userId, german);
      if (!existing) {
        const streak = correct ? 1 : 0;
        const status = streak >= LEARNED_STREAK_THRESHOLD ? 'learned' : 'learning';
        insert.run(req.userId, german, persian, correct ? 1 : 0, streak, status, now, now, status === 'learned' ? now : null);
        continue;
      }
      const streak = correct ? existing.correct_streak + 1 : 0;
      const alreadyLearned = existing.status === 'learned';
      const nowLearned = alreadyLearned || streak >= LEARNED_STREAK_THRESHOLD;
      update.run(
        correct ? 1 : 0,
        streak,
        nowLearned ? 'learned' : 'learning',
        now,
        nowLearned && !existing.learned_at ? now : existing.learned_at,
        persian,
        req.userId,
        german
      );
    }
  });
  tx();

  res.json({ ok: true });
});

export default router;
