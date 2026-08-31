// Per-lesson progress persistence. This app's server-side progress table
// only tracks a coarse page number per book/course (see
// server/src/routes/progress.js) - not the step-level state an active-
// recall lesson needs (current step, how many completed). So this lives in
// localStorage instead, under a versioned key (e.g. "lesson-progress-1-v1")
// passed in by the caller, so a future content change to a lesson can bump
// the version without inheriting stale/incompatible saved state.

export function loadLessonProgress(storageKey, stepCount) {
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return { currentStepIndex: 0 };
    const parsed = JSON.parse(raw);
    const currentStepIndex = Number(parsed?.currentStepIndex);
    if (!Number.isInteger(currentStepIndex) || currentStepIndex < 0 || currentStepIndex > stepCount) {
      return { currentStepIndex: 0 };
    }
    return { currentStepIndex };
  } catch {
    return { currentStepIndex: 0 };
  }
}

export function saveLessonProgress(storageKey, { currentStepIndex }) {
  try {
    localStorage.setItem(storageKey, JSON.stringify({ currentStepIndex }));
  } catch {
    // Private browsing / storage full / disabled - progress just won't
    // persist across a reload, which is a reasonable degrade, not a crash.
  }
}
