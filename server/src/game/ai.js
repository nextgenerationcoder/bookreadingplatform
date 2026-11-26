// Thin adapter between the game routes and llm.js's AI calls - looks up
// and decrypts the account's own AI key, the exact same convention every
// other AI feature in this app uses (worksheets' /ai command, Practice
// course generation, Extract pattern, etc. - see routes/worksheets.js's
// /ask-ai for the closest twin of this function). No separate API key or
// env-var config for the game: it reuses whatever Translation API key the
// account already has set up in Settings.
import { db } from '../db.js';
import { decrypt } from '../crypto.js';
import { generateGameTurn, generateSkillCheckExercises, answerQuestion } from '../llm.js';
import { buildSystemPrompt, buildTurnPrompt } from './prompt.js';
import { pickFallbackScene, pickFallbackOpeningScene } from './fallbackScenes.js';

async function getAccountKey(userId) {
  const row = db.prepare('SELECT llm_provider, llm_api_key_enc FROM users WHERE id = ?').get(userId);
  if (!row?.llm_provider || !row?.llm_api_key_enc) {
    throw new Error('no Translation API key configured — add one in Settings first');
  }
  try {
    return { provider: row.llm_provider, apiKey: await decrypt(row.llm_api_key_enc) };
  } catch (err) {
    console.error('game/ai: failed to decrypt Translation API key:', err);
    throw new Error('Failed to read your Translation API key — try re-saving it in Settings.');
  }
}

export async function runGameTurn(userId, { summary, lastChoiceText, effectsDescription, fired, targetWords, learnedSample }) {
  const { provider, apiKey } = await getAccountKey(userId);
  const systemPrompt = buildSystemPrompt();
  const userText = buildTurnPrompt({ summary, lastChoiceText, effectsDescription, fired, targetWords, learnedSample });
  return generateGameTurn({ provider, apiKey, systemPrompt, userText });
}

const MAX_CONSECUTIVE_AI_FAILURES = 2;

function bumpFailureCount(sessionId) {
  db.prepare('UPDATE game_sessions SET ai_failure_count = ai_failure_count + 1 WHERE id = ?').run(sessionId);
  return db.prepare('SELECT ai_failure_count AS c FROM game_sessions WHERE id = ?').get(sessionId).c;
}

function resetFailureCount(sessionId) {
  db.prepare('UPDATE game_sessions SET ai_failure_count = 0 WHERE id = ?').run(sessionId);
}

// Wraps runGameTurn with the "handwritten fallback if the AI fails twice
// in a row" safety net (see docs/office-game.md): a lone AI failure still
// propagates normally (the route returns its usual 502, and the player
// can just try again) - only a SECOND consecutive failure for the same
// game session is caught here and silently replaced with a canned scene
// from fallbackScenes.js, so a short AI outage degrades the game instead
// of breaking it outright. Returns { result, usedFallback } - `result` is
// always in the same {outcome, scene, choices, summary, wordsUsed} shape
// runGameTurn itself returns, so every caller can treat it identically.
//
// `sessionId` is omitted for the very first turn of a brand new game
// (POST /start, before a game_sessions row exists to persist a counter
// against) - there, "twice in a row" is just tried twice within this one
// request instead of across two separate ones.
export async function runGameTurnOrFallback(userId, params, { sessionId, fired = false } = {}) {
  try {
    const result = await runGameTurn(userId, params);
    if (sessionId) resetFailureCount(sessionId);
    return { result, usedFallback: false };
  } catch (err) {
    if (!sessionId) {
      try {
        const result = await runGameTurn(userId, params);
        return { result, usedFallback: false };
      } catch (err2) {
        console.error('game/ai: AI failed twice in a row starting a new game, using a fallback opening scene:', err2);
        return { result: pickFallbackOpeningScene(), usedFallback: true };
      }
    }
    const failureCount = bumpFailureCount(sessionId);
    if (failureCount >= MAX_CONSECUTIVE_AI_FAILURES) {
      console.error(`game/ai: AI failed ${failureCount} times in a row for session ${sessionId}, using a fallback scene:`, err);
      resetFailureCount(sessionId);
      return { result: pickFallbackScene(fired), usedFallback: true };
    }
    throw err;
  }
}

// Generates the 1-2 exercises for a skill check (see game/skillCheck.js).
export async function runSkillCheckGeneration(userId, { sceneText, choiceText, targetWords, count }) {
  const { provider, apiKey } = await getAccountKey(userId);
  return generateSkillCheckExercises({ provider, apiKey, sceneText, choiceText, targetWords, count });
}

// Backs the game page's "Notiz hinzufügen" -> "/ai ... ---" note (see
// routes/game.js's /ask-ai) - the exact same answerQuestion() worksheets'
// notes already use, just given the current scene as context so the
// learner can ask things like "why is it dem Chef here?".
export async function runAskAi(userId, { question, context }) {
  const { provider, apiKey } = await getAccountKey(userId);
  return answerQuestion({ provider, apiKey, question, context });
}
