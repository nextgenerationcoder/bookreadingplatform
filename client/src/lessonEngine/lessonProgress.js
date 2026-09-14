// Per-lesson progress persistence. This app's server-side progress table
// only tracks a coarse page number per book/course (see
// server/src/routes/progress.js) - not the step-level state an active-
// recall lesson needs (current step, how many completed). So this lives in
// localStorage instead, under a versioned key (e.g. "lesson-progress-1-v1")
// passed in by the caller, so a future content change to a lesson can bump
// the version without inheriting stale/incompatible saved state.
//
// Also persists the current step's in-progress draft answer and, if the
// last submission was wrong, the mistake explanation/grammar-lesson links
// already fetched for it (see LessonPlayer.js) - otherwise navigating away
// to actually read a recommended grammar lesson (the whole point of
// showing that link) would come back to a blank input and a vanished
// explanation, as if the attempt never happened.

const EMPTY = { currentStepIndex: 0, draftAnswer: '', wrongState: null };

export function loadLessonProgress(storageKey, stepCount) {
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return EMPTY;
    const parsed = JSON.parse(raw);
    const currentStepIndex = Number(parsed?.currentStepIndex);
    if (!Number.isInteger(currentStepIndex) || currentStepIndex < 0 || currentStepIndex > stepCount) {
      return EMPTY;
    }
    const wrongState =
      parsed?.wrongState && typeof parsed.wrongState.explanation === 'string'
        ? { explanation: parsed.wrongState.explanation, lessons: Array.isArray(parsed.wrongState.lessons) ? parsed.wrongState.lessons : [] }
        : null;
    return {
      currentStepIndex,
      draftAnswer: typeof parsed?.draftAnswer === 'string' ? parsed.draftAnswer : '',
      wrongState,
    };
  } catch {
    return EMPTY;
  }
}

export function saveLessonProgress(storageKey, { currentStepIndex, draftAnswer = '', wrongState = null }) {
  try {
    localStorage.setItem(storageKey, JSON.stringify({ currentStepIndex, draftAnswer, wrongState }));
  } catch {
    // Private browsing / storage full / disabled - progress just won't
    // persist across a reload, which is a reasonable degrade, not a crash.
  }
}
