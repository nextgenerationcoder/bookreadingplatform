// Generic state-transition service (lesson-generator-spec.md §1, §7's
// STATE PATCH). Domain logic only, no UI/DB coupling - routes/learning.js
// calls this with plain data and persists whatever it returns.
//
// A lesson's own content module declares what it's ALLOWED to promote via
// lessonDefinition.stateUpdateRules - this function's job is to enforce
// WHEN that's allowed to apply, not to invent the pedagogical judgment
// itself (that judgment was made when the lesson was authored, following
// the spec's 12-step loop). The one rule this function enforces globally,
// because it's the spec's own explicit caution repeated in lesson_1.txt's
// worked STATE_UPDATE: nothing is promoted just because the learner
// clicked through the steps. Moves/forms/chunks only promote once the
// exit check has actually been attempted (real production), and moves
// promote only as far as "supported" - never "installed" - from a single
// lesson's exit check.

function dedupe(list) {
  return [...new Set(list)];
}

// Applies lessonDefinition's declared promotions to learnerState, gated on
// learnerPerformance.exitCheckAttempted. Returns a new state object; does
// not mutate the input.
export function applyLessonStateUpdate(learnerState, lessonDefinition, learnerPerformance) {
  const rules = lessonDefinition.stateUpdateRules || {};
  const next = {
    ...learnerState,
    knownForms: { ...learnerState.knownForms },
    knownMoves: [...learnerState.knownMoves],
    stableFrames: [...learnerState.stableFrames],
    knownChunks: [...learnerState.knownChunks],
    seededButUnanalyzed: [...learnerState.seededButUnanalyzed],
    register: [...learnerState.register],
    anchorExamples: [...learnerState.anchorExamples],
    knownFailureModes: [...learnerState.knownFailureModes],
  };

  // Seeding an unanalyzed fragment is allowed on exposure alone - it's
  // explicitly not being taught as a rule yet, so there's no production
  // claim being made about it.
  for (const chunk of rules.seededChunksToAdd || []) {
    if (!next.seededButUnanalyzed.includes(chunk)) next.seededButUnanalyzed.push(chunk);
  }

  if (!learnerPerformance?.exitCheckAttempted) {
    // Nothing else promotes without real production evidence.
    return next;
  }

  for (const chunk of rules.chunksToAdd || []) {
    if (!next.knownChunks.includes(chunk)) next.knownChunks.push(chunk);
  }

  for (const { slot, pattern } of rules.knownFormsToAdd || []) {
    const existing = next.knownForms[slot] || [];
    next.knownForms[slot] = dedupe([...existing, pattern]);
  }

  // Moves promote to "supported" here, never "installed" - installed is a
  // later-lesson judgment (spec §3 step 12 / phase exit criteria, §7),
  // not something a single exit check can establish.
  for (const moveId of rules.movesToSupported || []) {
    const existing = next.knownMoves.find((m) => m.id === moveId);
    if (!existing) {
      next.knownMoves.push({ id: moveId, status: 'supported' });
    } else if (existing.status !== 'installed') {
      existing.status = 'supported';
    }
  }

  // Frame stability is never granted by this function on its own - only
  // if the lesson explicitly declares it earned that (a lesson wouldn't
  // for L01, per the spec's 2nd-anchor-plus-transformation requirement).
  for (const frame of rules.stableFramesToAdd || []) {
    if (!next.stableFrames.includes(frame)) next.stableFrames.push(frame);
  }

  for (const item of rules.registerToAdd || []) {
    if (!next.register.includes(item)) next.register.push(item);
  }

  for (const item of rules.failureModesToAdd || []) {
    if (!next.knownFailureModes.includes(item)) next.knownFailureModes.push(item);
  }

  if (learnerPerformance.anchorExamplesToAdd) {
    for (const anchor of learnerPerformance.anchorExamplesToAdd) {
      if (!next.anchorExamples.includes(anchor)) next.anchorExamples.push(anchor);
    }
  }

  return next;
}
