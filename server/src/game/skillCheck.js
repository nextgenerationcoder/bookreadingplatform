// "Skill checks" - the D&D-inspired part of the office game (see
// docs/office-game.md): instead of rolling a die to see whether a risky
// action succeeds, the player solves a short language exercise. Reuses
// the app's EXISTING practice-exercise machinery end to end - the raw AI
// output shape and practiceCourseGenerator.js's own convertStep for
// turning it into the app's established {type, promptFa, expectedAnswer,
// pairs} step shape - rather than inventing a second exercise format.

import { pickTargetWords } from './vocab.js';
import { convertStep } from '../practiceCourseGenerator.js';
import { runSkillCheckGeneration } from './ai.js';

function shuffleArray(arr) {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

const VALID_EXERCISE_TYPES = new Set(['translate', 'scramble', 'matching']);

// Generates exercises for a skill check, returning
// { full, client } - `full` (server-stored only, in pending_json) keeps
// the real expectedAnswer/pairs for routes/game.js's
// answerCheck.checkAllExercises to verify a submission against; `client`
// is what the learner actually sees - the correct answer text itself is
// never sent for translate/scramble (just the prompt, or the
// already-shuffled word tiles for scramble); matching sends its pairs as-
// is since, same as the existing Practice matching exercises, there's no
// separate "hidden answer" beyond the pairing data itself.
//
// Returns { full: [], client: [] } (not a throw) if the AI call fails or
// returns nothing usable - routes/game.js treats that as "skip the check
// this time" rather than ever blocking the game on an AI hiccup.
export async function generateExercisesForCheck(userId, { sceneText, choiceText, difficulty }) {
  const count = difficulty === 'hard' ? 2 : 1;
  const targetWords = pickTargetWords(userId, 3);

  let rawExercises;
  try {
    rawExercises = await runSkillCheckGeneration(userId, { sceneText, choiceText, targetWords, count });
  } catch (err) {
    console.error('game/skillCheck: exercise generation failed, skipping this check:', err);
    return { full: [], client: [] };
  }

  const converted = rawExercises.map(convertStep).filter((ex) => ex && VALID_EXERCISE_TYPES.has(ex.type)).slice(0, count);
  if (!converted.length) return { full: [], client: [] };

  const full = converted.map((ex) =>
    ex.type === 'matching' ? { type: 'matching', pairs: ex.pairs } : { type: ex.type, promptFa: ex.promptFa, expectedAnswer: ex.expectedAnswer }
  );

  const client = full.map((ex) => {
    if (ex.type === 'matching') return { type: 'matching', pairs: ex.pairs };
    if (ex.type === 'scramble') return { type: 'scramble', promptFa: ex.promptFa, words: shuffleArray(ex.expectedAnswer.split(' ')) };
    return { type: 'translate', promptFa: ex.promptFa };
  });

  return { full, client };
}
