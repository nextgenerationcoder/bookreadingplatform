// 60-second retrieval challenge: one cue at a time, no models. Each cue is
// timed from the moment it's shown; answering in >3s (or not answering
// before time runs out) flags it review_due unless the learner explicitly
// repeats it 5x now instead of deferring it.
export function renderRetrievalChallenge(host, lesson, { onSubmit }) {
  const { prompts, timeLimitSeconds, slowThresholdSeconds, repeatOfferLabel } = lesson.retrievalChallenge;
  let index = 0;
  let cueShownAt = 0;
  let timeLeft = timeLimitSeconds;
  const responses = [];
  let timerId = null;

  host.innerHTML = `
    <div class="formPage lessonPlayer">
      <h1>Retrieval Challenge</h1>
      <div class="retrievalTimer"><span id="rcTimeLeft">${timeLimitSeconds}</span>s left</div>
      <div class="retrievalCard">
        <div class="hint" style="padding:0" id="rcCounter"></div>
        <div class="speakingPrompt" id="rcCue"></div>
        <div class="formActions" id="rcActions"></div>
      </div>
    </div>
  `;

  const timeLeftEl = host.querySelector('#rcTimeLeft');
  const counterEl = host.querySelector('#rcCounter');
  const cueEl = host.querySelector('#rcCue');
  const actionsEl = host.querySelector('#rcActions');

  function startTimer() {
    timerId = setInterval(() => {
      timeLeft -= 1;
      timeLeftEl.textContent = Math.max(0, timeLeft);
      if (timeLeft <= 0) {
        clearInterval(timerId);
        finishRemaining();
      }
    }, 1000);
  }

  function finishRemaining() {
    while (index < prompts.length) {
      responses.push({ promptId: prompts[index].id, elapsedMs: null, repeated: false });
      index += 1;
    }
    submit();
  }

  function showCue() {
    if (index >= prompts.length) {
      clearInterval(timerId);
      submit();
      return;
    }
    const prompt = prompts[index];
    counterEl.textContent = `Cue ${index + 1} of ${prompts.length}`;
    cueEl.textContent = prompt.cue;
    cueShownAt = Date.now();
    actionsEl.innerHTML = `<button type="button" id="rcAnswered">I answered</button>`;
    host.querySelector('#rcAnswered').onclick = onAnswered;
  }

  function onAnswered() {
    const elapsedMs = Date.now() - cueShownAt;
    const slow = elapsedMs > slowThresholdSeconds * 1000;
    if (slow) {
      actionsEl.innerHTML = `
        <div class="hint" style="padding:0 0 6px">That took a bit — repeat it now, or move on and revisit it later.</div>
        <button type="button" id="rcRepeat">${repeatOfferLabel}</button>
        <button type="button" id="rcNext">Next (add to review)</button>
      `;
      host.querySelector('#rcRepeat').onclick = () => {
        responses.push({ promptId: prompts[index].id, elapsedMs, repeated: true });
        index += 1;
        showCue();
      };
      host.querySelector('#rcNext').onclick = () => {
        responses.push({ promptId: prompts[index].id, elapsedMs, repeated: false });
        index += 1;
        showCue();
      };
    } else {
      responses.push({ promptId: prompts[index].id, elapsedMs, repeated: false });
      index += 1;
      showCue();
    }
  }

  function submit() {
    onSubmit(responses);
  }

  startTimer();
  showCue();
}
