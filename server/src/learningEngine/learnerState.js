// LEARNER_STATE shape and defaults, per lesson-generator-spec.md §1 and
// tuv-nord-course-state.md §3. This is the schema the state-transition
// service (stateTransition.js) reads and writes; UI code should never
// construct or mutate this object directly.

export function defaultLearnerState() {
  return {
    stableFrames: [],
    knownForms: {},
    knownChunks: [],
    knownMoves: [],
    seededButUnanalyzed: [],
    register: [],
    anchorExamples: [],
    knownFailureModes: [],
    phase: 1,
  };
}

export function loadLearnerState(row) {
  if (!row) return defaultLearnerState();
  try {
    const parsed = JSON.parse(row.state_json);
    return { ...defaultLearnerState(), ...parsed, phase: row.phase };
  } catch {
    return defaultLearnerState();
  }
}
