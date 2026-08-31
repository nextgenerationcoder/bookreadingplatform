import { renderSpeakingTask } from '../../components/SpeakingTask.js';

const RATINGS = ['Geschafft', 'Mit Hilfe geschafft', 'Noch schwierig'];

// Renders the exit-check UI: three prompts, no models, spoken response +
// a self-assessment per prompt (there's no automatic linguistic grading -
// see lesson content's stateUpdateRules comment). Calls onSubmit(responses)
// once every prompt has an attempt (a recording, typed text, or an
// explicit "said it" confirmation) and a self-rating.
export function renderExitCheck(host, lesson, { onSubmit }) {
  host.innerHTML = `
    <div class="formPage lessonPlayer">
      <h1>Exit Check</h1>
      <p class="hint" style="padding:0">${escapeHtml(lesson.exitCheck.instructions)}</p>
      <div class="exitCheckList"></div>
      <div class="formActions">
        <button id="exitSubmitBtn" disabled>Submit Exit Check</button>
      </div>
    </div>
  `;

  const list = host.querySelector('.exitCheckList');
  const submitBtn = host.querySelector('#exitSubmitBtn');
  const attempts = new Map(); // promptId -> { done, recordingId, text }
  const ratings = new Map(); // promptId -> string

  function refreshSubmit() {
    const allReady = lesson.exitCheck.prompts.every((p) => attempts.get(p.id)?.done && ratings.get(p.id));
    submitBtn.disabled = !allReady;
  }

  for (const prompt of lesson.exitCheck.prompts) {
    const card = document.createElement('div');
    card.className = 'exitCheckCard';
    card.innerHTML = `<div class="speakingPrompt">${escapeHtml(prompt.question)}</div>`;
    list.appendChild(card);

    renderSpeakingTask(card, {
      prompt: 'Your spoken answer',
      requireRecording: false,
      onChange: (result) => {
        attempts.set(prompt.id, result);
        refreshSubmit();
      },
    });

    const ratingWrap = document.createElement('div');
    ratingWrap.className = 'ratingWrap';
    ratingWrap.innerHTML = `
      <div class="hint" style="padding:8px 0 4px">How did that feel?</div>
      <div class="ratingButtons">
        ${RATINGS.map((r) => `<button type="button" data-rating="${escapeHtml(r)}">${escapeHtml(r)}</button>`).join('')}
      </div>
    `;
    card.appendChild(ratingWrap);

    ratingWrap.querySelectorAll('[data-rating]').forEach((btn) => {
      btn.onclick = () => {
        ratings.set(prompt.id, btn.dataset.rating);
        ratingWrap.querySelectorAll('[data-rating]').forEach((b) => b.classList.remove('ratingActive'));
        btn.classList.add('ratingActive');
        refreshSubmit();
      };
    });
  }

  submitBtn.onclick = () => {
    submitBtn.disabled = true;
    const responses = lesson.exitCheck.prompts.map((p) => {
      const attempt = attempts.get(p.id);
      return {
        promptId: p.id,
        selfRating: ratings.get(p.id),
        hasRecording: !!attempt.recordingId,
        text: attempt.text,
      };
    });
    onSubmit(responses);
  };
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
