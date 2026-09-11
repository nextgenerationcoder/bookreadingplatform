import { api } from '../api.js';
import { answersMatch } from '../lessonEngine/normalizeAnswer.js';
import { loadLessonProgress, saveLessonProgress } from '../lessonEngine/lessonProgress.js';
import { blobToWav } from '../lessonEngine/audioToWav.js';

// Reusable step-by-step active-recall lesson player. Shows exactly one
// step at a time - never the whole lesson at once, and never the
// expectedAnswer before the learner produces it themselves.
//
// lesson: { id, title, backHref, backLabel, storageKey, steps, registerHotwords?, promptLang? }
// steps[i]: { id, software: [{german, persian}], promptFa, expectedAnswer, noteFa? }
//   - software.length && promptFa && expectedAnswer  -> teach + practice
//   - !software.length && promptFa && expectedAnswer  -> practice only (recall)
//   - promptFa === null && expectedAnswer === null    -> teach only (no input)
//   - noteFa (optional): a short grammar aside shown under the prompt -
//     not part of the input/answer, just context.
//
// Field names (promptFa/noteFa/w.persian) are legacy from when every lesson
// was German-Persian - they now just hold "the gloss/prompt/note text",
// in whatever language the lesson's promptLang says. promptLang also
// switches all the player's own UI text (buttons, feedback, instructions)
// between Persian and English - see UI_STRINGS below - so an
// English-authored lesson (PROMPT_LANG: en in interviewLessonImporter.js)
// never shows Persian chrome around English content.
//
// registerHotwords (optional): words/forms fixed across the WHOLE lesson
// (e.g. this lesson only ever uses formal "Sie", never "ihr") - unlike a
// step's own new words, these aren't specific to any one exercise's
// answer, so including them as ASR hotwords doesn't leak anything; they
// just tell the recognizer which register/forms this speaker will use.
const UI_STRINGS = {
  fa: {
    dir: 'rtl',
    stepOf: (i, n) => `مرحله ${i} از ${n}`,
    newWord: 'کلمه‌ی جدید',
    instruction: 'جمله‌ی آلمانی را بساز:',
    micStart: '🎙️ گفتن پاسخ',
    micStop: '⏹ توقف',
    hint: 'راهنمایی',
    check: 'بررسی جواب',
    continueBtn: 'ادامه',
    correct: '✓ درست است',
    wrong: 'دوباره تلاش کن',
    transcribing: 'در حال تبدیل صدا به متن…',
    transcribeError: (msg) => `خطا در تبدیل صدا: ${msg}`,
    micDenied: 'دسترسی به میکروفون ممکن نیست — لطفاً تایپ کنید.',
    doneTitle: 'درس تمام شد',
  },
  en: {
    dir: 'ltr',
    stepOf: (i, n) => `Step ${i} of ${n}`,
    newWord: 'New word',
    instruction: 'Build the German sentence:',
    micStart: '🎙️ Say your answer',
    micStop: '⏹ Stop',
    hint: 'Hint',
    check: 'Check answer',
    continueBtn: 'Continue',
    correct: '✓ Correct',
    wrong: 'Try again',
    transcribing: 'Transcribing…',
    transcribeError: (msg) => `Transcription error: ${msg}`,
    micDenied: 'Microphone unavailable — please type instead.',
    doneTitle: 'Lesson complete',
  },
};

export function renderLessonPlayer(host, lesson) {
  const { steps, storageKey, title, backHref, backLabel, registerHotwords = [], promptLang = 'fa' } = lesson;
  const promptDir = promptLang === 'en' ? 'ltr' : 'rtl';
  const t = UI_STRINGS[promptLang] || UI_STRINGS.fa;
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
          <div class="lessonTopMeta">${escapeHtml(title)} · ${t.stepOf(currentStepIndex + 1, steps.length)}</div>
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
                 <div class="newElementLabel">${t.newWord}</div>
                 <div class="wordPairList">
                   ${step.software
                     .map(
                       (w) => `<div class="wordPair"><span class="de">${escapeHtml(w.german)}</span><span class="fa" dir="${promptDir}">${escapeHtml(w.persian)}</span></div>`
                     )
                     .join('')}
                 </div>
               </div>`
            : ''
        }
        ${
          isTeachOnly
            ? ''
            : `<p class="lessonPromptFa" dir="${promptDir}">${escapeHtml(step.promptFa)}</p>
               ${step.noteFa ? `<p class="lessonNoteFa" dir="${promptDir}">${escapeHtml(step.noteFa)}</p>` : ''}
               <p class="stepInstruction" dir="${t.dir}">${t.instruction}</p>
               <form id="answerForm" autocomplete="off">
                 <input type="text" id="answerInput" class="answerInput" dir="ltr" autocomplete="off" autocapitalize="off" spellcheck="false">
                 <div class="lessonFeedback" id="lessonFeedback" dir="${t.dir}"></div>
                 <div class="lessonHint" id="lessonHint" dir="ltr" hidden></div>
                 <div class="formActions">
                   <button type="button" id="micBtn">${t.micStart}</button>
                   <button type="button" id="hintBtn">${t.hint}</button>
                   <button type="submit" id="primaryBtn">${t.check}</button>
                 </div>
               </form>`
        }
        ${isTeachOnly && step.noteFa ? `<p class="lessonNoteFa" dir="${promptDir}">${escapeHtml(step.noteFa)}</p>` : ''}
        ${isTeachOnly ? `<div class="formActions"><button type="button" id="continueBtn">${t.continueBtn}</button></div>` : ''}
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

    // Only this step's newly-taught words plus the lesson-wide register
    // hints - never the expectedAnswer itself, and not the whole lesson's
    // vocabulary either, which would dilute the "hot" signal a short,
    // specific hotword list is meant to give the recognizer.
    const hotwords = [...registerHotwords, ...step.software.map((w) => w.german)];
    wireMicButton(micBtn, input, feedback, () => correct, hotwords);

    form.onsubmit = (e) => {
      e.preventDefault();
      if (correct) {
        advance();
        return;
      }
      if (answersMatch(input.value, step.expectedAnswer)) {
        correct = true;
        feedback.textContent = t.correct;
        feedback.className = 'lessonFeedback lessonFeedback-correct';
        hintBtn.hidden = true;
        micBtn.hidden = true;
        primaryBtn.textContent = t.continueBtn;
        input.setAttribute('readonly', 'readonly');
        recordVocabForStep(step, true);
      } else {
        feedback.textContent = t.wrong;
        feedback.className = 'lessonFeedback lessonFeedback-wrong';
        // Don't clear the input - the learner edits their existing attempt.
        recordVocabForStep(step, false);
      }
    };
  }

  // Fire-and-forget mastery tracking for this step's newly-taught words - see
  // routes/vocab.js. Never awaited/blocking: a failed request here shouldn't
  // interrupt the lesson, it just means this one rep isn't counted.
  function recordVocabForStep(step, correct) {
    if (!step.software.length) return;
    api.recordVocab(step.software, correct).catch(() => {});
  }

  // Record → convert to WAV (the self-hosted Whisper container's ffmpeg
  // decode step accepts most formats, but WAV sidesteps codec surprises -
  // see audioToWav.js) → transcribe → fill the answer input. The learner
  // still reviews/edits before submitting; this never auto-submits on
  // their behalf. Falls back silently to typing if the mic is unavailable
  // or denied.
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
          stream.getTracks().forEach((track) => track.stop());
          micBtn.textContent = t.micStart;
          micBtn.disabled = true;
          feedback.textContent = t.transcribing;
          feedback.className = 'lessonFeedback';
          try {
            const rawBlob = new Blob(chunks, { type: mediaRecorder.mimeType || 'audio/webm' });
            const wavBlob = await blobToWav(rawBlob);
            const { text } = await api.transcribeAudio(wavBlob, { hotwords });
            input.value = text;
            feedback.textContent = '';
            input.focus();
          } catch (err) {
            feedback.textContent = t.transcribeError(err.message);
            feedback.className = 'lessonFeedback lessonFeedback-wrong';
          } finally {
            micBtn.disabled = false;
          }
        };
        mediaRecorder.start();
        micBtn.textContent = t.micStop;
      } catch {
        feedback.textContent = t.micDenied;
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
        <div class="lessonSummary" dir="${t.dir}">
          <h2>${t.doneTitle}</h2>
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
