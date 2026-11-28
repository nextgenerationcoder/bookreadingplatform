// Connects the office roleplay game to the learner's own vocabulary (see
// docs/office-game.md). Read-only selection queries + a loose text-match
// verifier live here; recording a word as seen again reuses
// routes/vocab.js's own recordWordsSeenAgain (routes/game.js imports it
// directly) rather than duplicating that logic.

import { db } from '../db.js';

// 2-3 words the learner is actively working on, least-recently-seen
// first, so the game naturally cycles through the whole learning list
// over time instead of hammering the same couple of words every turn.
export function pickTargetWords(userId, limit = 3) {
  return db
    .prepare(`SELECT german, persian FROM vocab_progress WHERE user_id = ? AND status = 'learning' ORDER BY last_seen_at ASC LIMIT ?`)
    .all(userId, limit);
}

// A random sample of words the learner already knows, given to the AI as
// the vocabulary it should actually build the scene out of (see
// prompt.js's Vocabulary section) - not just a vague "level hint".
//
// 'learned' alone is far too small a pool for this in practice - it only
// holds words that graduated through Practice's quiz streak, which is a
// high bar most learners rarely reach for many words. 'passive' - a word
// shown while reading that the learner did NOT click - is a much bigger
// and arguably just-as-reliable signal of "actually understood this
// without needing to look it up", so it's included here too. Deliberately
// excludes 'learning' (actively being studied, not yet known - those are
// pickTargetWords' job, 2-3 at a time, never this general pool).
export function pickLearnedSample(userId, limit = 40) {
  return db
    .prepare(`SELECT german FROM vocab_progress WHERE user_id = ? AND status IN ('learned', 'passive') ORDER BY RANDOM() LIMIT ?`)
    .all(userId, limit)
    .map((r) => r.german);
}

// A target word's inflected form in running text rarely matches its
// dictionary form exactly (der Termin / den Termin, ich gehe / er geht) -
// stripping a short trailing suffix before checking for it as a substring
// catches most regular inflection without a real morphological analyzer,
// which is more machinery than this needs.
function wordStem(word) {
  const w = word.toLowerCase();
  // "gehen" -> "geh" (matches "gehe", "gehst", "geht", "gingen" partially
  // via the shared root is a lost cause without real morphology, but the
  // common present-tense root is caught) - dropping only 2 chars isn't
  // enough for strong-verb infinitives ("gehen" -> "gehe" doesn't match
  // "geht"), so longer words drop more.
  if (w.length > 4) return w.slice(0, w.length - 2);
  return w;
}

// Cross-checks the AI's self-reported `words_used` against the words it
// was ACTUALLY offered (so it can't claim credit for an arbitrary word
// that was never a target) and against the real turn text (so it can't
// claim credit for a word it forgot to actually use) - returns only the
// {german, persian} target entries that pass both checks, ready to hand
// straight to recordWordsSeenAgain.
export function verifyWordsUsed(claimedWords, targetWords, turnText) {
  if (!Array.isArray(claimedWords) || !claimedWords.length) return [];
  const lowerText = turnText.toLowerCase();
  const verified = [];
  for (const claimed of claimedWords) {
    if (typeof claimed !== 'string') continue;
    const target = targetWords.find((t) => t.german.toLowerCase() === claimed.trim().toLowerCase());
    if (!target) continue;
    if (lowerText.includes(wordStem(target.german))) verified.push(target);
  }
  return verified;
}
