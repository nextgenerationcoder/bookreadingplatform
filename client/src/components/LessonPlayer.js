import { api } from '../api.js';
import { answersMatch } from '../lessonEngine/normalizeAnswer.js';
import { loadLessonProgress, saveLessonProgress } from '../lessonEngine/lessonProgress.js';
import { blobToWav } from '../lessonEngine/audioToWav.js';

// Reusable step-by-step active-recall lesson player. Shows exactly one
// step at a time - never the whole lesson at once, and never the
// expectedAnswer before the learner produces it themselves.
//
// lesson: { id, title, backHref, backLabel, storageKey, steps }
// steps[i]: { id, software: [{german, persian}], promptFa, expectedAnswer }
//   - software.length && promptFa && expectedAnswer  -> teach + practice
//   - !software.length && promptFa && expectedAnswer  -> practice only (recall)
//   - promptFa === null && expectedAnswer === null    -> teach only (no input)
export async function renderLessonPlayer(host, lesson) {
  const { steps, storageKey, title, backHref, backLabel } = lesson;
  const { currentStepIndex: startIndex } = loadLessonProgress(storageKey, steps.length);
  let currentStepIndex = startIndex;

  // The mic button (spoken answers, via Z.AI speech-to-text) only shows up
  // if the account has that key configured - same gating pattern as the
  // Translation/Vision keys elsewhere in this app.
  let asrConfigured = false;
  try {
    asrConfigured = (await api.getAsrSettings()).configured;
  } catch {
    asrConfigured = false;
  }

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
                   ${asrConfigured ? `<button type="button" id="micBtn">🎙️ گفتن پاسخ</button>` : ''}
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
    const micBtn = body.querySelector('#micBtn');

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

    if (micBtn) {
      // Every German word/phrase taught up to and including this step -
      // never the expectedAnswer itself - passed as ASR hotwords so
      // recognition is biased toward this lesson's known vocabulary
      // without being biased toward the literal correct sentence.
      const knownVocabulary = [...new Set(steps.slice(0, currentStepIndex + 1).flatMap((s) => s.software.map((w) => w.german)))];
      wireMicButton(micBtn, input, feedback, () => correct, knownVocabulary);
    }

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
        if (micBtn) micBtn.hidden = true;
        primaryBtn.textContent = 'ادامه';
        input.setAttribute('readonly', 'readonly');
      } else {
        feedback.textContent = 'دوباره تلاش کن';
        feedback.className = 'lessonFeedback lessonFeedback-wrong';
        // Don't clear the input - the learner edits their existing attempt.
      }
    };
  }

  // Record → convert to WAV (Z.AI only accepts wav/mp3, browsers record
  // webm/mp4 - see audioToWav.js) → transcribe → fill the answer input.
  // The learner still reviews/edits before submitting; this never
  // auto-submits on their behalf. Falls back silently to typing if the mic
  // is unavailable or denied.
  function wireMicButton(micBtn, input, feedback, isAlreadyCorrect, hotwords) {
    let mediaRecorder = null;
    let chunks = [];

    micBtn.onclick = async () => {
      if (isAlreadyCorrect()) return;

      if (mediaRecorder && mediaRecorder.state === 'recording') {
        mediaRecorder.stop();
        return;
      }

      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        chunks = [];
        mediaRecorder = new MediaRecorder(stream);
        mediaRecorder.ondataavailable = (e) => {
          if (e.data.size > 0) chunks.push(e.data);
        };
        mediaRecorder.onstop = async () => {
          stream.getTracks().forEach((t) => t.stop());
          micBtn.textContent = '🎙️ گفتن پاسخ';
          micBtn.disabled = true;
          feedback.textContent = 'در حال تبدیل صدا به متن…';
          feedback.className = 'lessonFeedback';
          try {
            const rawBlob = new Blob(chunks, { type: mediaRecorder.mimeType || 'audio/webm' });
            const wavBlob = await blobToWav(rawBlob);
            const { text } = await api.transcribeAudio(wavBlob, { hotwords });
            input.value = text;
            feedback.textContent = '';
            input.focus();
          } catch (err) {
            feedback.textContent = `خطا در تبدیل صدا: ${err.message}`;
            feedback.className = 'lessonFeedback lessonFeedback-wrong';
          } finally {
            micBtn.disabled = false;
          }
        };
        mediaRecorder.start();
        micBtn.textContent = '⏹ توقف';
      } catch {
        feedback.textContent = 'دسترسی به میکروفون ممکن نیست — لطفاً تایپ کنید.';
        feedback.className = 'lessonFeedback lessonFeedback-wrong';
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
