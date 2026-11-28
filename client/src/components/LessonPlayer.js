import { api } from '../api.js';
import { answersMatch } from '../lessonEngine/normalizeAnswer.js';
import { loadLessonProgress, saveLessonProgress } from '../lessonEngine/lessonProgress.js';
import { blobToWav } from '../lessonEngine/audioToWav.js';

// Reusable step-by-step active-recall lesson player. Shows exactly one
// step at a time - never the whole lesson at once, and never the
// expectedAnswer before the learner produces it themselves.
//
// lesson: { id, title, backHref, backLabel, storageKey, steps, registerHotwords?, promptLang? }
// steps[i]: { id, software: [{german, persian}], promptFa, expectedAnswer, noteFa?, type?, pairs? }
//   - software.length && promptFa && expectedAnswer  -> teach + practice
//   - !software.length && promptFa && expectedAnswer  -> practice only (recall)
//   - promptFa === null && expectedAnswer === null    -> teach only (no input)
//   - noteFa (optional): a short grammar aside shown under the prompt -
//     not part of the input/answer, just context.
//   - type (optional, defaults to 'translate' if absent - every step from
//     before this field existed, or from a non-Practice lesson source, is
//     implicitly 'translate'): which exercise UI to use for a practice step.
//     'translate' - type the whole sentence (the original/default shape).
//     'scramble' - the SAME shape (promptFa + expectedAnswer), but shown as
//       shuffled word tiles the learner taps back into order instead of a
//       text box - see renderStep's scramble branch below.
//     'matching' - connect each of `pairs` (same shape as software) to its
//       translation; has no promptFa/expectedAnswer of its own (promptFa
//       and expectedAnswer are both null, like a teach-only step) - see
//       renderMatchingStep below, a separate render path from the rest of
//       this file since it shares none of the text-input/hint/mic/mistake-
//       explanation machinery a sentence-construction step needs.
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
    explaining: 'در حال بررسی چرا این جواب اشتباه است…',
    grammarLinkLabel: 'مرور درس گرامر:',
    transcribing: 'در حال تبدیل صدا به متن…',
    transcribeError: (msg) => `خطا در تبدیل صدا: ${msg}`,
    micDenied: 'دسترسی به میکروفون ممکن نیست — لطفاً تایپ کنید.',
    doneTitle: 'درس تمام شد',
    scrambleInstruction: 'کلمات را به ترتیب درست لمس کن:',
    matchingInstruction: 'هر کلمه را به معنی‌اش وصل کن:',
    matchingDone: '✓ همه‌ی جفت‌ها درست وصل شدند',
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
    explaining: 'Checking why this is wrong…',
    grammarLinkLabel: 'Review the grammar lesson:',
    transcribing: 'Transcribing…',
    transcribeError: (msg) => `Transcription error: ${msg}`,
    micDenied: 'Microphone unavailable — please type instead.',
    doneTitle: 'Lesson complete',
    scrambleInstruction: 'Tap the words in the right order:',
    matchingInstruction: 'Connect each word to its meaning:',
    matchingDone: '✓ All pairs matched',
  },
};

export function renderLessonPlayer(host, lesson) {
  const { steps, storageKey, title, backHref, backLabel, registerHotwords = [], promptLang = 'fa' } = lesson;
  const promptDir = promptLang === 'en' ? 'ltr' : 'rtl';
  const t = UI_STRINGS[promptLang] || UI_STRINGS.fa;
  const {
    currentStepIndex: startIndex,
    draftAnswer: startDraft,
    isWrong: startIsWrong,
    explanation: startExplanation,
    lessons: startLessons,
  } = loadLessonProgress(storageKey, steps.length);
  let currentStepIndex = startIndex;
  // Only relevant for the very first render (i.e. right after loading saved
  // progress) - once the learner advances to a new step within this same
  // session, there's nothing saved for it yet, so a fresh step is correctly
  // blank rather than re-showing the previous step's leftover draft.
  let pendingDraft = startDraft;
  let pendingIsWrong = startIsWrong;
  let pendingExplanation = startExplanation;
  let pendingLessons = startLessons;

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

    if (step.type === 'matching') {
      renderMatchingStep(body, step);
      return;
    }

    const isTeachOnly = step.promptFa === null && step.expectedAnswer === null;
    const hasWords = step.software.length > 0;
    const isScramble = step.type === 'scramble';

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
               <p class="stepInstruction" dir="${t.dir}">${isScramble ? t.scrambleInstruction : t.instruction}</p>
               <form id="answerForm" autocomplete="off">
                 ${
                   isScramble
                     ? `<div class="scrambleBuilt" id="scrambleBuilt" dir="ltr"></div>
                        <div class="scrambleTiles" id="scrambleTiles" dir="ltr"></div>
                        <input type="hidden" id="answerInput">`
                     : `<input type="text" id="answerInput" class="answerInput" dir="ltr" autocomplete="off" autocapitalize="off" spellcheck="false">`
                 }
                 <div class="lessonFeedback" id="lessonFeedback" dir="${t.dir}"></div>
                 <div class="mistakeExplanation" id="mistakeExplanation" dir="${t.dir}" hidden></div>
                 <div class="lessonHint" id="lessonHint" dir="ltr" hidden></div>
                 <div class="formActions">
                   <button type="button" id="micBtn"${isScramble ? ' hidden' : ''}>${t.micStart}</button>
                   <button type="button" id="hintBtn"${isScramble ? ' hidden' : ''}>${t.hint}</button>
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
    const explanationEl = body.querySelector('#mistakeExplanation');
    const hintEl = body.querySelector('#lessonHint');
    const hintBtn = body.querySelector('#hintBtn');
    const primaryBtn = body.querySelector('#primaryBtn');
    const micBtn = body.querySelector('#micBtn');

    let correct = false;
    const revealedWordIndexes = new Set();
    let explainRequestId = 0;
    // isWrong drives the red "try again" feedback; explanation/lessons are
    // the (optional, separately-arriving) AI mistake explanation for it -
    // kept apart so a failed/not-yet-fetched explanation never erases the
    // wrong-answer state itself (see lessonProgress.js's comment).
    let wrongInfo = { isWrong: false, explanation: null, lessons: [] };

    const expectedWords = step.expectedAnswer.split(' ');

    function persistState() {
      saveLessonProgress(storageKey, {
        currentStepIndex,
        draftAnswer: input.value,
        isWrong: wrongInfo.isWrong,
        explanation: wrongInfo.explanation,
        lessons: wrongInfo.lessons,
      });
    }

    function renderExplanationBox(explanation, lessons) {
      explanationEl.hidden = false;
      explanationEl.className = 'mistakeExplanation';
      explanationEl.innerHTML = '';
      const p = document.createElement('p');
      p.textContent = explanation;
      explanationEl.appendChild(p);
      for (const lesson of lessons) {
        const link = document.createElement('a');
        link.className = 'mistakeGrammarLink';
        link.href = `#/grammar/${encodeURIComponent(lesson.id)}`;
        link.textContent = `${t.grammarLinkLabel} ${lesson.topic}`;
        explanationEl.appendChild(link);
      }
    }

    // Restore whatever the learner had going on this step before they
    // navigated away (e.g. to actually read a recommended grammar lesson -
    // the whole point of that link - and came back) - their typed attempt,
    // and the wrong-answer explanation/grammar links already fetched for
    // it, so returning doesn't look like the attempt never happened.
    if (pendingDraft || pendingIsWrong) {
      input.value = pendingDraft;
      if (pendingIsWrong) {
        feedback.textContent = t.wrong;
        feedback.className = 'lessonFeedback lessonFeedback-wrong';
        wrongInfo = { isWrong: true, explanation: pendingExplanation, lessons: pendingLessons };
        if (pendingExplanation) renderExplanationBox(pendingExplanation, pendingLessons);
      }
    }
    pendingDraft = '';
    pendingIsWrong = false;
    pendingExplanation = null;
    pendingLessons = [];

    if (!isScramble) input.focus();
    input.addEventListener('input', () => {
      if (!correct) persistState();
    });

    // Scramble: tap `expectedAnswer`'s own words, shown shuffled, back into
    // order - tapping a tile moves it between the "remaining" row and the
    // "built" row; the hidden #answerInput is kept in sync with the built
    // order so everything below (check/hint/explain-mistake/persistState)
    // works unchanged, exactly as if the learner had typed that text. Not
    // restored across a reload (see the draft-restore block above) - the
    // tiles just reset, a minor gap worth accepting for now.
    let refreshScrambleTiles = () => {};
    if (isScramble) {
      const builtEl = body.querySelector('#scrambleBuilt');
      const tilesEl = body.querySelector('#scrambleTiles');
      const words = step.expectedAnswer.split(' ');
      const order = shuffleIndexes(words.length);
      let builtIndexes = [];

      function renderTiles() {
        builtEl.innerHTML = '';
        for (const idx of builtIndexes) {
          const tile = document.createElement('button');
          tile.type = 'button';
          tile.className = 'scrambleTile scrambleTileBuilt';
          tile.textContent = words[idx];
          tile.disabled = correct;
          tile.onclick = () => {
            builtIndexes = builtIndexes.filter((i) => i !== idx);
            syncAndRender();
          };
          builtEl.appendChild(tile);
        }
        tilesEl.innerHTML = '';
        for (const idx of order) {
          if (builtIndexes.includes(idx)) continue;
          const tile = document.createElement('button');
          tile.type = 'button';
          tile.className = 'scrambleTile';
          tile.textContent = words[idx];
          tile.disabled = correct;
          tile.onclick = () => {
            builtIndexes.push(idx);
            syncAndRender();
          };
          tilesEl.appendChild(tile);
        }
      }

      function syncAndRender() {
        input.value = builtIndexes.map((idx) => words[idx]).join(' ');
        input.dispatchEvent(new Event('input'));
        renderTiles();
      }

      renderTiles();
      refreshScrambleTiles = renderTiles;
    }

    // Per-word hint: a row of slot buttons, one per expected word, each
    // revealing only ITS OWN word when clicked - not "the first N words in
    // order" the way a single progressive reveal would. The word the
    // learner is actually stuck on is rarely the first one, and a lesson's
    // Persian prompt already tells them the meaning - what they're missing
    // is the German form of one specific word, not a prefix of the whole
    // sentence that would give away every word before it too.
    function renderHintSlots() {
      hintEl.hidden = false;
      hintEl.className = 'lessonHint';
      hintEl.innerHTML = '';
      expectedWords.forEach((word, i) => {
        const slotBtn = document.createElement('button');
        slotBtn.type = 'button';
        slotBtn.className = 'hintSlotBtn';
        const revealed = revealedWordIndexes.has(i);
        slotBtn.textContent = revealed ? word : String(i + 1);
        slotBtn.classList.toggle('hintSlotRevealed', revealed);
        slotBtn.disabled = revealed;
        slotBtn.onclick = () => {
          revealedWordIndexes.add(i);
          renderHintSlots();
        };
        hintEl.appendChild(slotBtn);
      });
    }

    hintBtn.onclick = () => {
      if (correct) return;
      renderHintSlots();
    };

    // Only this step's newly-taught words plus the lesson-wide register
    // hints - never the expectedAnswer itself, and not the whole lesson's
    // vocabulary either, which would dilute the "hot" signal a short,
    // specific hotword list is meant to give the recognizer.
    const hotwords = [...registerHotwords, ...step.software.map((w) => w.german)];
    wireMicButton(micBtn, input, feedback, () => correct, hotwords);

    // Fire-and-forget: uses the account's own Translation API key to explain
    // *why* the wrong answer is wrong (never the correct answer itself, see
    // llm.js's explainMistake) and, if it's a grammar mistake, link to the
    // matching grammar lesson(s) so the learner can look it up themselves -
    // see routes/grammar.js's /explain-mistake. Purely additive: if it fails
    // (no Translation key configured, API error, etc.) the "try again"
    // feedback above is unaffected, this box just stays hidden.
    async function requestMistakeExplanation(userAnswer) {
      const requestId = ++explainRequestId;
      explanationEl.hidden = false;
      explanationEl.className = 'mistakeExplanation';
      explanationEl.textContent = t.explaining;
      try {
        const { explanation, lessons } = await api.explainMistake({
          promptText: step.promptFa,
          expectedAnswer: step.expectedAnswer,
          userAnswer,
          promptLang,
        });
        if (requestId !== explainRequestId) return; // a newer attempt superseded this one
        renderExplanationBox(explanation, lessons);
        wrongInfo = { isWrong: true, explanation, lessons };
        persistState();
      } catch {
        if (requestId !== explainRequestId) return;
        explanationEl.hidden = true;
        // isWrong stays true - only the explanation itself failed/is
        // unavailable (e.g. no Translation key configured), the wrong-
        // answer state must still be restored if the learner navigates
        // away and back.
        wrongInfo = { isWrong: true, explanation: null, lessons: [] };
        persistState();
      }
    }

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
        explanationEl.hidden = true;
        wrongInfo = { isWrong: false, explanation: null, lessons: [] };
        hintBtn.hidden = true;
        micBtn.hidden = true;
        primaryBtn.textContent = t.continueBtn;
        input.setAttribute('readonly', 'readonly');
        refreshScrambleTiles();
        recordVocabForStep(step, true);
        persistState();
      } else {
        feedback.textContent = t.wrong;
        feedback.className = 'lessonFeedback lessonFeedback-wrong';
        // Don't clear the input - the learner edits their existing attempt.
        recordVocabForStep(step, false);
        wrongInfo = { isWrong: true, explanation: null, lessons: [] };
        persistState();
        requestMistakeExplanation(input.value);
      }
    };
  }

  // Connect each of step.pairs' German words to its translation - two
  // shuffled columns, tap one from each side to try a pair. A correct tap
  // locks both in green and removes them from play; a wrong tap flashes
  // red briefly and un-selects, no penalty beyond having to look again -
  // there's no "wrong answer" state worth persisting/explaining the way a
  // sentence-construction mistake is, so this step type skips
  // persistState/explain-mistake/hint/mic entirely, unlike every other
  // step type in this file.
  function renderMatchingStep(body, step) {
    const pairs = step.pairs;
    const germanOrder = shuffleIndexes(pairs.length);
    const persianOrder = shuffleIndexes(pairs.length);
    const matched = new Set();
    let selectedGerman = null;
    let selectedPersian = null;

    body.innerHTML = `
      <div class="microStep">
        <p class="stepInstruction" dir="${t.dir}">${t.matchingInstruction}</p>
        ${step.noteFa ? `<p class="lessonNoteFa" dir="${promptDir}">${escapeHtml(step.noteFa)}</p>` : ''}
        <div class="matchingBoard">
          <div class="matchingCol" id="matchingGerman" dir="ltr"></div>
          <div class="matchingCol" id="matchingPersian" dir="${promptDir}"></div>
        </div>
        <div class="formActions" id="matchingDoneRow" hidden>
          <button type="button" id="continueBtn">${t.continueBtn}</button>
        </div>
      </div>
    `;

    const germanCol = body.querySelector('#matchingGerman');
    const persianCol = body.querySelector('#matchingPersian');
    const doneRow = body.querySelector('#matchingDoneRow');

    function renderCols() {
      germanCol.innerHTML = '';
      for (const idx of germanOrder) {
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'matchingChip';
        chip.textContent = pairs[idx].german;
        if (matched.has(idx)) chip.classList.add('matchingChipMatched');
        if (selectedGerman === idx) chip.classList.add('matchingChipSelected');
        chip.disabled = matched.has(idx);
        chip.onclick = () => {
          selectedGerman = idx;
          tryMatch();
          renderCols();
        };
        germanCol.appendChild(chip);
      }
      persianCol.innerHTML = '';
      for (const idx of persianOrder) {
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'matchingChip';
        chip.textContent = pairs[idx].persian;
        if (matched.has(idx)) chip.classList.add('matchingChipMatched');
        if (selectedPersian === idx) chip.classList.add('matchingChipSelected');
        chip.disabled = matched.has(idx);
        chip.onclick = () => {
          selectedPersian = idx;
          tryMatch();
          renderCols();
        };
        persianCol.appendChild(chip);
      }
    }

    function tryMatch() {
      if (selectedGerman === null || selectedPersian === null) return;
      if (selectedGerman === selectedPersian) {
        matched.add(selectedGerman);
        selectedGerman = null;
        selectedPersian = null;
        if (matched.size === pairs.length) {
          recordVocabForStep(step, true);
          doneRow.hidden = false;
        }
      } else {
        // Brief wrong flash, then clear both - handled via a short timeout
        // so the learner sees which two chips they tried before they reset.
        const wrongGerman = selectedGerman;
        const wrongPersian = selectedPersian;
        setTimeout(() => {
          if (selectedGerman === wrongGerman) selectedGerman = null;
          if (selectedPersian === wrongPersian) selectedPersian = null;
          renderCols();
        }, 500);
      }
    }

    renderCols();
    doneRow.querySelector('#continueBtn').onclick = () => advance();
  }

  // Fire-and-forget mastery tracking for this step's newly-taught words - see
  // routes/vocab.js. Never awaited/blocking: a failed request here shouldn't
  // interrupt the lesson, it just means this one rep isn't counted.
  function recordVocabForStep(step, correct) {
    if (!step.software.length) return;
    api.recordVocab(step.software, correct).catch(() => {});
  }

  // Record → convert to WAV (Groq's transcription API accepts most formats,
  // but WAV sidesteps codec surprises - see audioToWav.js) → transcribe →
  // fill the answer input. The learner still reviews/edits before
  // submitting; this never auto-submits on their behalf. Falls back
  // silently to typing if the mic is unavailable or denied.
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

// Fisher-Yates shuffle of [0, 1, ..., n-1] - used by both the scramble
// (word order) and matching (column order) step types so neither ever
// just shows items in their original, already-correct order.
function shuffleIndexes(n) {
  const arr = Array.from({ length: n }, (_, i) => i);
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
