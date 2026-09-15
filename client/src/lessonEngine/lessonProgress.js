// Per-lesson progress persistence. This app's server-side progress table
// only tracks a coarse page number per book/course (see
// server/src/routes/progress.js) - not the step-level state an active-
// recall lesson needs (current step, how many completed). So this lives in
// localStorage instead, under a versioned key (e.g. "lesson-progress-1-v1")
// passed in by the caller, so a future content change to a lesson can bump
// the version without inheriting stale/incompatible saved state.
//
// Also persists the current step's in-progress draft answer and whether
// the last submission was wrong (see LessonPlayer.js) - otherwise
// navigating away to actually read a recommended grammar lesson (the whole
// point of showing that link) would come back to a blank input and no
// "wrong answer" feedback, as if the attempt never happened.
//
// isWrong and explanation/lessons are deliberately separate: isWrong just
// means "show the red try-again feedback", independent of whether the AI
// mistake-explanation call (which needs the learner's own Translation API
// key) succeeded - explanation is null/lessons is empty whenever that call
// hasn't completed yet or failed, but the wrong-answer state itself must
// still be restored either way.

const EMPTY = { currentStepIndex: 0, draftAnswer: '', isWrong: false, explanation: null, lessons: [] };

export function loadLessonProgress(storageKey, stepCount) {
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return EMPTY;
    const parsed = JSON.parse(raw);
    const currentStepIndex = Number(parsed?.currentStepIndex);
    if (!Number.isInteger(currentStepIndex) || currentStepIndex < 0 || currentStepIndex > stepCount) {
      return EMPTY;
    }
    return {
      currentStepIndex,
      draftAnswer: typeof parsed?.draftAnswer === 'string' ? parsed.draftAnswer : '',
      isWrong: !!parsed?.isWrong,
      explanation: typeof parsed?.explanation === 'string' ? parsed.explanation : null,
      lessons: Array.isArray(parsed?.lessons) ? parsed.lessons : [],
    };
  } catch {
    return EMPTY;
  }
}

export function saveLessonProgress(storageKey, { currentStepIndex, draftAnswer = '', isWrong = false, explanation = null, lessons = [] }) {
  try {
    localStorage.setItem(storageKey, JSON.stringify({ currentStepIndex, draftAnswer, isWrong, explanation, lessons }));
  } catch {
    // Private browsing / storage full / disabled - progress just won't
    // persist across a reload, which is a reasonable degrade, not a crash.
  }
}
