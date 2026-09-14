// NOT IMPLEMENTED YET.
//
// Planned third use of grammar_lessons (see db.js's comment on that table
// and routes/grammar.js's /by-tag endpoint): generate practice exercises
// targeted at what a specific learner actually needs, where "need" is a
// function of two things per grammar topic (identified by error_tag):
//   - importance: how central the topic is at the learner's level (e.g.
//     verb-second word order matters far more at A1 than a rare idiom)
//   - sufficiency: how well the learner already knows it, derived from
//     their vocab_progress / lesson_progress / word_click history for
//     that topic's error_tags
// The generator would pick low-sufficiency, high-importance topics first,
// pull the relevant grammar_lessons row(s) by error_tag, and produce
// exercises from its rules/examples the same way LessonPlayer steps are
// authored today (see client/src/lessons/lesson1.js for that step shape).
//
// Intentionally left unbuilt for now - just the place this will live.

export function generateExercisesForUser(_userId) {
  throw new Error('generateExercisesForUser is not implemented yet');
}
