// Server-side answer checking for skill-check exercises (see
// docs/office-game.md / game/skillCheck.js) - deliberately checked here,
// not trusted from the client, unlike the existing Practice course's
// matching/scramble exercises (LessonPlayer.js), which are purely
// client-side self-checking since nothing server-side depends on their
// outcome. A skill check's outcome changes real game state (XP, boss
// opinion), so it must be verified independently of whatever the client
// claims.

// Mirrors client/src/lessonEngine/normalizeAnswer.js exactly (trim,
// collapse whitespace, drop a trailing "."/"?", lowercase) - duplicated
// rather than imported across the client/server workspace boundary
// (fragile to rely on in a Docker build), but kept in sync by hand since
// it's a tiny, stable, pure function.
function normalizeAnswer(str) {
  return (str || '')
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/[.?]+$/, '')
    .toLowerCase();
}

function answersMatch(given, expected) {
  return normalizeAnswer(given) === normalizeAnswer(expected);
}

// Checks one exercise's submitted answer against its stored expected
// value. `exercise` is the FULL (server-stored) version - {type,
// expectedAnswer} for translate/scramble, {type, pairs} for matching.
// `submittedAnswer` is whatever the client sent: a string for translate/
// scramble, or an array of {german, persian} for matching (the pairs the
// learner formed - checked as a set, not by position, since the client's
// own display order is shuffled and carries no meaning).
export function checkExerciseAnswer(exercise, submittedAnswer) {
  if (exercise.type === 'matching') {
    if (!Array.isArray(submittedAnswer) || submittedAnswer.length !== exercise.pairs.length) return false;
    return exercise.pairs.every((pair) =>
      submittedAnswer.some((s) => s && normalizeAnswer(s.german) === normalizeAnswer(pair.german) && normalizeAnswer(s.persian) === normalizeAnswer(pair.persian))
    );
  }
  // translate / scramble
  return typeof submittedAnswer === 'string' && answersMatch(submittedAnswer, exercise.expectedAnswer);
}

// Overall pass/fail for a skill check: ALL of its exercises must be
// correct - "hard" (2 exercises) is genuinely harder than "easy" (1),
// not just "more questions for the same odds".
export function checkAllExercises(exercises, submittedAnswers) {
  if (!Array.isArray(submittedAnswers) || submittedAnswers.length !== exercises.length) return false;
  return exercises.every((exercise, i) => checkExerciseAnswer(exercise, submittedAnswers[i]));
}
