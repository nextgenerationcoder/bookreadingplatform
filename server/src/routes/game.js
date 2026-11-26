// Office roleplay game (see docs/office-game.md) - Step 2's minimal loop,
// the game-rules layer (XP, chef_meinung, NPC sympathie/flirt, firing)
// from game/engine.js, and skill checks (game/skillCheck.js). Mounted
// behind requireAuth in index.js, like every other route in this app -
// no separate login for the game.
//
// Hardening for real users: every AI-calling route below goes through
// game/rateLimit.js's per-user quota, and runGameTurnOrFallback (see
// game/ai.js) absorbs a 2nd consecutive AI failure per session into a
// handwritten fallback scene instead of surfacing a hard error.

import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { db } from '../db.js';
import { runGameTurnOrFallback, runAskAi } from '../game/ai.js';
import { createInitialState, applyChoice, isFired } from '../game/engine.js';
import { describeEffects } from '../game/prompt.js';
import { pickTargetWords, pickLearnedSample, verifyWordsUsed } from '../game/vocab.js';
import { recordWordsSeenAgain } from './vocab.js';
import { generateExercisesForCheck } from '../game/skillCheck.js';
import { checkAllExercises } from '../game/answerCheck.js';
import { gameAiRateLimit } from '../game/rateLimit.js';

const router = Router();

// "Current" game for an account is just the most recently created
// session, regardless of status - "Neu anfangen" starts a fresh row
// rather than deleting/resetting the old one, so the newest row is
// always the right one to resume (including a 'fired' one, so refreshing
// after being fired still shows the game-over screen, not a 404).
function getCurrentSession(userId) {
  return db.prepare('SELECT * FROM game_sessions WHERE user_id = ? ORDER BY created_at DESC LIMIT 1').get(userId);
}

// Strips `tags` out of each choice - tags are the AI's own judgment of
// what a choice entails (how cheeky, who it involves, ...) and must never
// reach the client, or a learner could read them to game the mechanics
// (e.g. always picking whichever choice's tags are most XP-favorable, or
// knowing in advance which one triggers a skill check) instead of just
// picking what their character would actually do.
function stripTagsForClient(choices) {
  return choices.map((c) => ({ text: c.text }));
}

// `pending.type` discriminates between the two shapes pending_json can
// hold: 'scene' (the normal case - the current scene+choices waiting for
// a pick) and 'check' (a skill check is in progress for the choice the
// player already picked - see startSkillCheck/resolveChoice below).
// Older rows have no `type` at all and are implicitly 'scene'.
function clientView(session, extra = {}) {
  const pending = JSON.parse(session.pending_json);
  const state = JSON.parse(session.state_json);
  const base = {
    sessionId: session.id,
    turn: session.turn,
    status: session.status,
    xp: state.engine.xp,
    chefMeinung: state.engine.chef_meinung,
    npcs: state.engine.npcs,
  };
  if (pending.type === 'check') {
    return { ...base, type: 'check', difficulty: pending.difficulty, exercises: pending.client, ...extra };
  }
  return {
    ...base,
    type: 'scene',
    outcome: pending.outcome,
    scene: pending.scene,
    choices: stripTagsForClient(pending.choices),
    targetWords: pending.targetWords || [],
    ...extra,
  };
}

// Builds the plain-text context the "Notiz hinzufügen" AI question (see
// POST /ask-ai below) is given: whatever scene/outcome/choices are
// CURRENTLY ON SCREEN for this turn - never tags, engine state, or any
// other number not shown in the UI. Read from game_turns rather than
// session.pending_json because pending_json is replaced with a different
// shape while a skill check is in progress (see clientView's 'check'
// branch) and no longer holds the scene text at all - but the game_turns
// row for the CURRENT turn is written once (at /start or by the previous
// resolveChoice) and only ever gets its choice_index/effects_json touched
// after that, so it reliably still holds the scene the player is actually
// looking at (or just finished looking at, if a check is now in progress).
function buildSceneContext(session) {
  const row = db.prepare('SELECT scene_json FROM game_turns WHERE session_id = ? AND turn = ?').get(session.id, session.turn);
  if (!row) return null;
  const scene = JSON.parse(row.scene_json);
  const lines = ['Current scene (a German-learning office roleplay game):'];
  if (scene.outcome) lines.push(`What just happened: ${scene.outcome}`);
  lines.push(`Scene: ${scene.scene}`);
  (scene.choices || []).forEach((c, i) => lines.push(`Choice ${i + 1}: ${c.text}`));
  return lines.join('\n');
}

// Verifies the AI's self-reported words_used against what it was actually
// offered and against the real turn text (game/vocab.js's
// verifyWordsUsed), records each verified one as "seen again" via
// routes/vocab.js's EXISTING recordWordsSeenAgain (no new learning logic
// here), and returns just the german forms - for the client to highlight,
// and to stash in pending_json so a later GET /current still knows which
// words in THIS scene are worth highlighting.
function verifyAndRecordWords(userId, turnResult, targetWords) {
  const turnText = [turnResult.scene, ...turnResult.choices.map((c) => c.text)].join(' ');
  const verified = verifyWordsUsed(turnResult.wordsUsed, targetWords, turnText);
  if (verified.length) recordWordsSeenAgain(userId, verified);
  return verified.map((w) => w.german);
}

// Shared tail of both POST /choose (when no skill check applies) and
// POST /skill-check-answer (once one has been resolved) - computes the
// mechanical effect from engine.js FIRST (optionally informed by
// checkResult), tells the AI exactly what happened, and persists the
// resulting next turn. Returns the data clientView() needs.
async function resolveChoice(userId, session, state, chosenText, chosenTags, checkResult) {
  const { state: nextEngineState, effects } = applyChoice(state.engine, chosenTags, Math.random, checkResult);
  const fired = isFired(nextEngineState);
  const effectsDescription = describeEffects(effects);

  const targetWordsOffered = fired ? [] : pickTargetWords(userId);
  const learnedSample = fired ? [] : pickLearnedSample(userId);

  const { result: turnResult } = await runGameTurnOrFallback(
    userId,
    { summary: state.summary, lastChoiceText: chosenText, effectsDescription, fired, targetWords: targetWordsOffered, learnedSample },
    { sessionId: session.id, fired }
  );

  const verifiedTargetWords = verifyAndRecordWords(userId, turnResult, targetWordsOffered);

  const now = new Date().toISOString();
  const nextTurn = session.turn + 1;
  const nextPending = {
    type: 'scene',
    outcome: turnResult.outcome,
    scene: turnResult.scene,
    choices: turnResult.choices,
    targetWords: verifiedTargetWords,
  };
  // turnResult.summary is `null` when runGameTurnOrFallback had to use a
  // canned fallback scene (see fallbackScenes.js) - it has nothing
  // meaningful to add to the running recap, so continuity is left alone
  // rather than overwritten with something generic.
  const nextState = { summary: turnResult.summary ?? state.summary, engine: nextEngineState };
  const nextStatus = fired ? 'fired' : 'active';

  const tx = db.transaction(() => {
    db.prepare('UPDATE game_turns SET choice_index = ?, effects_json = ? WHERE session_id = ? AND turn = ?').run(
      session.lastChoiceIndex ?? null,
      JSON.stringify(effects),
      session.id,
      session.turn
    );
    db.prepare(
      `INSERT INTO game_turns (session_id, turn, scene_json, choice_index, effects_json, created_at)
       VALUES (?, ?, ?, NULL, NULL, ?)`
    ).run(session.id, nextTurn, JSON.stringify(nextPending), now);
    db.prepare('UPDATE game_sessions SET state_json = ?, pending_json = ?, turn = ?, status = ?, updated_at = ? WHERE id = ?').run(
      JSON.stringify(nextState),
      JSON.stringify(nextPending),
      nextTurn,
      nextStatus,
      now,
      session.id
    );
  });
  tx();

  return clientView(
    { id: session.id, turn: nextTurn, status: nextStatus, state_json: JSON.stringify(nextState), pending_json: JSON.stringify(nextPending) },
    { effects: effects.map((e) => ({ target: e.target, delta: e.delta })), checkResult: checkResult || undefined }
  );
}

// POST /api/game/start - always creates a brand new session (used both for
// a learner's very first game and for "Neu anfangen" on an existing one).
router.post('/start', gameAiRateLimit, async (req, res) => {
  const targetWordsOffered = pickTargetWords(req.userId);
  const learnedSample = pickLearnedSample(req.userId);

  let turnResult;
  try {
    // No sessionId yet (there's no game_sessions row until after this AI
    // call succeeds) - runGameTurnOrFallback handles "fails twice in a
    // row" by trying twice within this one request instead of persisting
    // a counter across requests (see its own comment).
    ({ result: turnResult } = await runGameTurnOrFallback(req.userId, {
      summary: null,
      lastChoiceText: null,
      targetWords: targetWordsOffered,
      learnedSample,
    }));
  } catch (err) {
    console.error('game/start: AI call failed:', err);
    return res.status(502).json({ error: err.message });
  }

  const verifiedTargetWords = verifyAndRecordWords(req.userId, turnResult, targetWordsOffered);

  const id = randomUUID();
  const now = new Date().toISOString();
  const pending = { type: 'scene', outcome: turnResult.outcome, scene: turnResult.scene, choices: turnResult.choices, targetWords: verifiedTargetWords };
  const state = { summary: turnResult.summary, engine: createInitialState() };

  const tx = db.transaction(() => {
    db.prepare(
      `INSERT INTO game_sessions (id, user_id, state_json, pending_json, turn, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, 1, 'active', ?, ?)`
    ).run(id, req.userId, JSON.stringify(state), JSON.stringify(pending), now, now);

    db.prepare(
      `INSERT INTO game_turns (session_id, turn, scene_json, choice_index, effects_json, created_at)
       VALUES (?, 1, ?, NULL, NULL, ?)`
    ).run(id, JSON.stringify(pending), now);
  });
  tx();

  res.status(201).json(clientView({ id, turn: 1, status: 'active', state_json: JSON.stringify(state), pending_json: JSON.stringify(pending) }));
});

// GET /api/game/current - the current scene+choices (and stats), or the
// in-progress skill check, for whatever game the account last started -
// so refreshing the page (or coming back later) resumes exactly where
// they left off.
router.get('/current', (req, res) => {
  const session = getCurrentSession(req.userId);
  if (!session || !session.pending_json) return res.status(404).json({ error: 'no game in progress' });
  res.json(clientView(session));
});

// POST /api/game/ask-ai { question } - backs the game page's "Notiz
// hinzufügen" note (see docs/office-game.md's "Notes with AI" mechanic),
// reusing worksheets' exact "/ai ... ---" note UI and its answerQuestion()
// AI call (routes/worksheets.js's twin of this route) - the only
// difference is the context: the current scene/choices (never tags/
// numbers - see buildSceneContext) so the learner can ask things like
// "why is it dem Chef here?" and get an answer that actually knows the
// scene. Purely a side read - never touches game state, so asking or
// answering never interrupts the game in progress.
router.post('/ask-ai', gameAiRateLimit, async (req, res) => {
  const question = (req.body?.question || '').trim();
  if (!question) return res.status(400).json({ error: 'question is required' });

  const session = getCurrentSession(req.userId);
  if (!session || !session.pending_json) return res.status(404).json({ error: 'no game in progress' });

  try {
    const answer = await runAskAi(req.userId, { question, context: buildSceneContext(session) });
    res.json({ answer });
  } catch (err) {
    console.error('game/ask-ai: AI call failed:', err);
    res.status(502).json({ error: err.message });
  }
});

// POST /api/game/choose { choice: 0 | 1 } - the client only ever sends an
// index; the actual choice TEXT+TAGS (and the current scene) live
// entirely in pending_json server-side, so there's no way for a tampered
// request to feed the AI content the player never actually saw, or to
// smuggle in a different tag combination than what was actually offered.
//
// If the chosen option is tagged with a skill check, this does NOT yet
// apply any effect or advance the turn - it generates the check's
// exercises (game/skillCheck.js) and returns them for the player to
// solve; POST /skill-check-answer below does the actual resolving once
// they do. If generating exercises fails for any reason (AI hiccup, no
// Translation key, ...), this silently falls through to resolving the
// choice with no check at all - the game never gets stuck waiting on it.
router.post('/choose', gameAiRateLimit, async (req, res) => {
  const { choice } = req.body || {};
  if (choice !== 0 && choice !== 1) return res.status(400).json({ error: 'choice must be 0 or 1' });

  const session = getCurrentSession(req.userId);
  if (!session || !session.pending_json) return res.status(404).json({ error: 'no game in progress' });
  if (session.status !== 'active') return res.status(409).json({ error: 'this game has already ended' });

  const pending = JSON.parse(session.pending_json);
  if (pending.type === 'check') return res.status(409).json({ error: 'a skill check is already in progress' });
  const state = JSON.parse(session.state_json);
  const chosen = pending.choices[choice];
  if (!chosen) return res.status(400).json({ error: 'invalid choice index' });

  if (chosen.tags.check) {
    const { full, client } = await generateExercisesForCheck(req.userId, {
      sceneText: pending.scene,
      choiceText: chosen.text,
      difficulty: chosen.tags.check,
    });
    if (full.length) {
      const now = new Date().toISOString();
      const checkPending = {
        type: 'check',
        difficulty: chosen.tags.check,
        chosenText: chosen.text,
        chosenTags: chosen.tags,
        choiceIndex: choice,
        full,
        client,
      };
      db.prepare('UPDATE game_sessions SET pending_json = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(checkPending), now, session.id);
      return res.json(
        clientView({ ...session, pending_json: JSON.stringify(checkPending) })
      );
    }
    // No usable exercises generated - fall through to resolving the
    // choice as if it had no check at all, rather than blocking the game.
  }

  try {
    const result = await resolveChoice(req.userId, { ...session, lastChoiceIndex: choice }, state, chosen.text, chosen.tags, null);
    res.json(result);
  } catch (err) {
    console.error('game/choose: AI call failed:', err);
    res.status(502).json({ error: err.message });
  }
});

// POST /api/game/skill-check-answer { answers: [...] } - resolves an
// in-progress skill check: answers[i] is a string (translate/scramble) or
// an array of {german, persian} pairs (matching), checked server-side
// (answerCheck.js) against the REAL exercises stored in pending_json,
// never trusting a client-reported pass/fail. ALL exercises must be
// correct for the check to succeed (so "hard", with 2 exercises, really
// is harder than "easy"). Resolves the original choice exactly like
// POST /choose would have, just with the check's outcome now known.
router.post('/skill-check-answer', gameAiRateLimit, async (req, res) => {
  const { answers } = req.body || {};
  if (!Array.isArray(answers)) return res.status(400).json({ error: 'answers (array) is required' });

  const session = getCurrentSession(req.userId);
  if (!session || !session.pending_json) return res.status(404).json({ error: 'no game in progress' });
  if (session.status !== 'active') return res.status(409).json({ error: 'this game has already ended' });

  const pending = JSON.parse(session.pending_json);
  if (pending.type !== 'check') return res.status(409).json({ error: 'no skill check is in progress' });
  const state = JSON.parse(session.state_json);

  const success = checkAllExercises(pending.full, answers);
  const checkResult = success ? 'success' : 'failure';

  try {
    const result = await resolveChoice(
      req.userId,
      { ...session, lastChoiceIndex: pending.choiceIndex },
      state,
      pending.chosenText,
      pending.chosenTags,
      checkResult
    );
    res.json(result);
  } catch (err) {
    console.error('game/skill-check-answer: AI call failed:', err);
    res.status(502).json({ error: err.message });
  }
});

export default router;
