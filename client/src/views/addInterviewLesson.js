import { api } from '../api.js';

const EXAMPLE = `LESSON: tuv-nord-lektion-2
TITLE: TÜV NORD Interview – Teil 2
PROMPT_LANG: en

### STEP
WORD: aufmerksam werden auf = to become aware of
SAY: I became aware of TÜV NORD.
ANSWER: Ich bin auf TÜV NORD aufmerksam geworden.

### STEP
NOTE: "sich weiterentwickeln" is reflexive - it always comes with "sich".
WORD: sich weiterentwickeln = to develop (oneself) further
SAY: I wanted to develop myself further.
ANSWER: Ich wollte mich weiterentwickeln.

### STEP
WORD: die Masterarbeit = master's thesis
WORD: das Praxisprojekt = practical project
SAY: I wanted to combine my master's thesis with a practical project.
ANSWER: Ich wollte meine Masterarbeit mit einem Praxisprojekt kombinieren.`;

export function renderAddInterviewLesson(host) {
  host.innerHTML = `
    <div class="formPage">
      <a href="#/interview">← Interview</a>
      <h1>Add Lesson</h1>
      <p class="hint">
        Write the lesson as <code>### STEP</code> blocks. Each step can teach new words
        (<code>WORD: german = translation</code>, repeatable), an optional grammar aside
        (<code>NOTE:</code>), and a prompt/answer pair (<code>SAY:</code> / <code>ANSWER:</code>) -
        or omit <code>SAY:</code>/<code>ANSWER:</code> entirely for a teach-only step.
        <code>PROMPT_LANG:</code> is optional (<code>en</code> or <code>fa</code>, default <code>fa</code>) and sets the
        language for this whole lesson - <code>SAY:</code>, <code>NOTE:</code>, each <code>WORD:</code>'s
        translation, and the lesson screen's own buttons/labels all switch together, so an
        English lesson (<code>PROMPT_LANG: en</code>) stays English throughout, not mixed with Persian.
      </p>
      <details class="exampleBox">
        <summary>Example format</summary>
        <pre>${EXAMPLE}</pre>
      </details>
      <textarea id="lessonText" dir="ltr" placeholder="${EXAMPLE.replace(/"/g, '&quot;')}"></textarea>
      <div class="formActions">
        <button id="importBtn">Import Lesson</button>
        <a href="#/interview">Cancel</a>
      </div>
      <div id="importStatus" class="importStatus"></div>
    </div>
  `;

  const textarea = host.querySelector('#lessonText');
  const status = host.querySelector('#importStatus');
  const btn = host.querySelector('#importBtn');

  btn.onclick = async () => {
    const text = textarea.value.trim();
    if (!text) {
      status.textContent = 'Enter the lesson text first.';
      status.className = 'importStatus error';
      return;
    }
    btn.disabled = true;
    status.textContent = 'Importing…';
    status.className = 'importStatus';
    try {
      const meta = await api.importInterviewLesson(text);
      status.textContent = `"${meta.title}" was added successfully (${meta.stepCount} steps).`;
      status.className = 'importStatus success';
      setTimeout(() => {
        window.location.hash = `#/interview/${encodeURIComponent(meta.courseId)}`;
      }, 800);
    } catch (err) {
      status.textContent = `Error: ${err.message}`;
      status.className = 'importStatus error';
    } finally {
      btn.disabled = false;
    }
  };
}
