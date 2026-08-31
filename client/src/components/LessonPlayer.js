import { answersMatch } from '../lessonEngine/normalizeAnswer.js';
import { loadLessonProgress, saveLessonProgress } from '../lessonEngine/lessonProgress.js';

// Reusable step-by-step active-recall lesson player. Shows exactly one
// step at a time - never the whole lesson at once, and never the
// expectedAnswer before the learner produces it themselves.
//
// lesson: { id, title, backHref, backLabel, storageKey, steps }
// steps[i]: { id, software: [{german, persian}], promptFa, expectedAnswer }
//   - software.length && promptFa && expectedAnswer  -> teach + practice
//   - !software.length && promptFa && expectedAnswer  -> practice only (recall)
//   - promptFa === null && expectedAnswer === null    -> teach only (no input)
export function renderLessonPlayer(host, lesson) {
  const { steps, storageKey, title, backHref, backLabel } = lesson;
  const { currentStepIndex: startIndex } = loadLessonProgress(storageKey, steps.length);
  let currentStepIndex = startIndex;

  render();

  function render() {
    if (currentStepIndex >= steps.length) {
      renderCompletion();
      return;
    }
    renderShell();
    renderStep(steps[currentStepIndex]);
  }

  function renderShell() {
    host.innerHTML = `
      <div class="lessonPlayer">
        <div class="lessonTopBar">
          <a href="${backHref}" class="backLink">${backLabel}</a>
          <div class="lessonTopMeta">${escapeHtml(title)} · مرحله ${currentStepIndex + 1} از ${steps.length}</div>
          <div class="progressBar"><div class="progressFill" id="lessonProgressFill"></div></div>
        </div>
        <div id="lessonBody"></div>
      </div>
    `;
    host.querySelector('#lessonProgressFill').style.width = `${Math.round((currentStepIndex / steps.length) * 100)}%`;
  }

  function renderStep(step) {
    const body = host.querySelector('#lessonBody');
    const isTeachOnly = step.promptFa === null && step.expectedAnswer === null;
    const hasWords = step.software.length > 0;

    body.innerHTML = `
      <div class="microStep">
        ${
          hasWords
            ? `<div class="newElementBox">
                 <div class="newElementLabel">کلمه‌ی جدید</div>
                 <div class="wordPairList">
                   ${step.software
                     .map(
                       (w) => `<div class="wordPair"><span class="de">${escapeHtml(w.german)}</span><span class="fa" dir="rtl">${escapeHtml(w.persian)}</span></div>`
                     )
                     .join('')}
                 </div>
               </div>`
            : ''
        }
        ${
          isTeachOnly
            ? ''
            : `<p class="lessonPromptFa" dir="rtl">${escapeHtml(step.promptFa)}</p>
               <p class="stepInstruction" dir="rtl">جمله‌ی آلمانی را بساز:</p>
               <form id="answerForm" autocomplete="off">
                 <input type="text" id="answerInput" class="answerInput" dir="ltr" autocomplete="off" autocapitalize="off" spellcheck="false">
                 <div class="lessonFeedback" id="lessonFeedback" dir="rtl"></div>
                 <div class="lessonHint" id="lessonHint" dir="ltr" hidden></div>
                 <div class="formActions">
                   <button type="button" id="hintBtn">راهنمایی</button>
                   <button type="submit" id="primaryBtn">بررسی جواب</button>
                 </div>
               </form>`
        }
        ${isTeachOnly ? `<div class="formActions"><button type="button" id="continueBtn">ادامه</button></div>` : ''}
      </div>
    `;

    if (isTeachOnly) {
      body.querySelector('#continueBtn').onclick = () => advance();
      return;
    }

    const form = body.querySelector('#answerForm');
    const input = body.querySelector('#answerInput');
    const feedback = body.querySelector('#lessonFeedback');
    const hintEl = body.querySelector('#lessonHint');
    const hintBtn = body.querySelector('#hintBtn');
    const primaryBtn = body.querySelector('#primaryBtn');

    let correct = false;
    let hintLevel = 0;
    const expectedWords = step.expectedAnswer.split(' ');

    input.focus();

    hintBtn.onclick = () => {
      if (correct) return;
      hintLevel = Math.min(hintLevel + 1, expectedWords.length);
      hintEl.hidden = false;
      const shown = expectedWords.slice(0, hintLevel).join(' ');
      hintEl.textContent = hintLevel >= expectedWords.length ? shown : `${shown} …`;
    };

    form.onsubmit = (e) => {
      e.preventDefault();
      if (correct) {
        advance();
        return;
      }
      if (answersMatch(input.value, step.expectedAnswer)) {
        correct = true;
        feedback.textContent = '✓ درست است';
        feedback.className = 'lessonFeedback lessonFeedback-correct';
        hintBtn.hidden = true;
        primaryBtn.textContent = 'ادامه';
        input.setAttribute('readonly', 'readonly');
      } else {
        feedback.textContent = 'دوباره تلاش کن';
        feedback.className = 'lessonFeedback lessonFeedback-wrong';
        // Don't clear the input - the learner edits their existing attempt.
      }
    };
  }

  function advance() {
    currentStepIndex += 1;
    saveLessonProgress(storageKey, { currentStepIndex });
    render();
  }

  function renderCompletion() {
    host.innerHTML = `
      <div class="lessonPlayer">
        <div class="lessonSummary">
          <h2>درس ۱ تمام شد</h2>
          <p class="hint" style="padding:0">${steps.length} / ${steps.length}</p>
          <a class="button" href="${backHref}">${backLabel}</a>
        </div>
      </div>
    `;
  }
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
