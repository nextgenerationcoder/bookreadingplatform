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

// POST /api/vocab/reading-page { toLearn: [{german, persian}], passive: [{german, persian}] }
// — called once when finishing a book/course page (reader.js's "Finish
// Page" button). toLearn is every word on the page the student clicked for
// a gloss (they don't know it); passive is every other word on the page
// (never clicked, so assumed passively understood - "read it without
// needing help").
//
// Reuses vocab_progress rather than a separate table so a word's status is
// one thing regardless of whether it came from a lesson or from reading -
// but the two lists behave asymmetrically on conflict:
//   - toLearn always pushes status toward 'learning' (a click is a clear
//     "I don't know this" signal, even if reading had it filed as passive
//     before) - unless it's already 'learned', which a page skim shouldn't
//     undo.
//   - passive only sets status on a brand-new word. An existing 'learning'
//     or 'learned' row is never downgraded just because this particular
//     page didn't need a click for it - that'd erase real progress on a
//     word the student happens to recognize today but is still practicing.
router.post('/reading-page', (req, res) => {
  const { toLearn, passive } = req.body || {};
  if (!Array.isArray(toLearn) || !Array.isArray(passive)) {
    return res.status(400).json({ error: 'toLearn and passive (arrays) are required' });
  }

  const now = new Date().toISOString();
  const insertLearning = db.prepare(
    `INSERT INTO vocab_progress (user_id, german, persian, times_seen, times_correct_total, correct_streak, status, first_seen_at, last_seen_at, learned_at)
     VALUES (?, ?, ?, 1, 0, 0, 'learning', ?, ?, NULL)
     ON CONFLICT(user_id, german) DO UPDATE SET
       times_seen = times_seen + 1,
       last_seen_at = excluded.last_seen_at,
       persian = CASE WHEN vocab_progress.persian = '' THEN excluded.persian ELSE vocab_progress.persian END,
       status = CASE WHEN vocab_progress.status = 'learned' THEN 'learned' ELSE 'learning' END`
  );
  const insertPassive = db.prepare(
    `INSERT INTO vocab_progress (user_id, german, persian, times_seen, times_correct_total, correct_streak, status, first_seen_at, last_seen_at, learned_at)
     VALUES (?, ?, ?, 1, 0, 0, 'passive', ?, ?, NULL)
     ON CONFLICT(user_id, german) DO UPDATE SET
       times_seen = times_seen + 1,
       last_seen_at = excluded.last_seen_at`
  );

  const tx = db.transaction(() => {
    for (const { german, persian } of toLearn) {
      if (!german) continue;
      insertLearning.run(req.userId, german, persian || '', now, now);
    }
    for (const { german, persian } of passive) {
      if (!german) continue;
      insertPassive.run(req.userId, german, persian || '', now, now);
    }
  });
  tx();

  res.json({ ok: true, toLearnCount: toLearn.length, passiveCount: passive.length });
});

export default router;
