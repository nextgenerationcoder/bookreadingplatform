import { api } from '../api.js';

// Reusable speaking-production control: Record / Stop / Replay, with an
// optional text field, and a "Mark said" completion action. There is no
// pronunciation/grammar evaluation anywhere in this app - this is
// recording + replay only, matching the MVP scope. If the microphone is
// unavailable or permission is denied, it falls back to a text/self-
// confirmation-only mode rather than blocking the learner.
//
// props:
//   prompt          - the German (or instruction) text shown for this item
//   note            - optional secondary instruction line
//   allowReplay     - default true
//   requireRecording - if true, "Mark said" stays disabled until a
//                      recording exists (still falls back to text/confirm
//                      if the mic isn't available)
//   onChange(result) - called whenever completion state changes; result is
//                      { done, recordingId, mimeType, text, method }
export function renderSpeakingTask(container, props) {
  const { prompt, note, allowReplay = true, requireRecording = false, onChange } = props;

  const el = document.createElement('div');
  el.className = 'speakingTask';
  el.innerHTML = `
    <div class="speakingPrompt">${escapeHtml(prompt)}</div>
    ${note ? `<div class="hint" style="padding:2px 0 0">${escapeHtml(note)}</div>` : ''}
    <div class="speakingControls">
      <button type="button" data-action="record">🎙️ Record</button>
      <button type="button" data-action="stop" hidden>⏹ Stop</button>
      <audio data-role="replay" hidden></audio>
      <button type="button" data-action="replay" hidden>▶️ Replay</button>
    </div>
    <div class="speakingMicStatus hint" hidden></div>
    <label class="speakingTextLabel">
      <span class="hint" style="padding:0">Optional text response</span>
      <input type="text" data-role="text" placeholder="(optional) type what you said">
    </label>
    <button type="button" class="speakingDone" data-action="done">Mark said ✓</button>
  `;
  container.appendChild(el);

  const recordBtn = el.querySelector('[data-action="record"]');
  const stopBtn = el.querySelector('[data-action="stop"]');
  const replayBtn = el.querySelector('[data-action="replay"]');
  const audioEl = el.querySelector('[data-role="replay"]');
  const micStatus = el.querySelector('.speakingMicStatus');
  const textInput = el.querySelector('[data-role="text"]');
  const doneBtn = el.querySelector('.speakingDone');

  let mediaRecorder = null;
  let chunks = [];
  let recordingId = null;
  let mimeType = null;
  let done = false;
  let micAvailable = true;

  function emit() {
    onChange?.({
      done,
      recordingId,
      mimeType,
      text: textInput.value.trim() || null,
      method: recordingId ? 'recording' : textInput.value.trim() ? 'text' : done ? 'confirmed' : null,
    });
  }

  function updateDoneButton() {
    const hasSomething = recordingId || textInput.value.trim() || !requireRecording;
    doneBtn.disabled = !hasSomething && requireRecording;
  }

  recordBtn.onclick = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      chunks = [];
      mediaRecorder = new MediaRecorder(stream);
      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data);
      };
      mediaRecorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunks, { type: mediaRecorder.mimeType || 'audio/webm' });
        audioEl.src = URL.createObjectURL(blob);
        audioEl.hidden = false;
        replayBtn.hidden = !allowReplay;
        micStatus.hidden = true;
        try {
          const result = await api.uploadRecording(blob);
          recordingId = result.recordingId;
          mimeType = result.mimeType;
        } catch (err) {
          micStatus.hidden = false;
          micStatus.textContent = `Recording saved locally but couldn't upload: ${err.message}`;
        }
        recordBtn.hidden = false;
        recordBtn.textContent = '🎙️ Record again';
        stopBtn.hidden = true;
        updateDoneButton();
        emit();
      };
      mediaRecorder.start();
      recordBtn.hidden = true;
      stopBtn.hidden = false;
      micStatus.hidden = true;
    } catch {
      micAvailable = false;
      recordBtn.hidden = true;
      stopBtn.hidden = true;
      micStatus.hidden = false;
      micStatus.textContent = 'Microphone unavailable — type what you said, or just mark it done.';
      updateDoneButton();
    }
  };

  stopBtn.onclick = () => {
    mediaRecorder?.stop();
  };

  replayBtn.onclick = () => {
    audioEl.play();
  };

  textInput.oninput = () => {
    updateDoneButton();
    if (done) emit();
  };

  doneBtn.onclick = () => {
    done = true;
    doneBtn.textContent = '✓ Said';
    doneBtn.classList.add('speakingDoneActive');
    emit();
  };

  updateDoneButton();

  return {
    el,
    isComplete: () => done,
    isMicAvailable: () => micAvailable,
    reset() {
      done = false;
      recordingId = null;
      mimeType = null;
      textInput.value = '';
      audioEl.hidden = true;
      replayBtn.hidden = true;
      recordBtn.hidden = false;
      recordBtn.textContent = '🎙️ Record';
      doneBtn.textContent = 'Mark said ✓';
      doneBtn.classList.remove('speakingDoneActive');
      updateDoneButton();
    },
  };
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
