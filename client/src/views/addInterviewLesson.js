import { api } from '../api.js';

const EXAMPLE = `LESSON: tuv-nord-lektion-2
TITLE: TÜV NORD Interview – Teil 2
PROMPT_LANG: en

### STEP
WORD: aufmerksam werden auf = متوجه چیزی شدن
SAY: I became aware of TÜV NORD.
ANSWER: Ich bin auf TÜV NORD aufmerksam geworden.

### STEP
NOTE: "sich weiterentwickeln" فعل بازتابی است - با "sich" می‌آید.
WORD: sich weiterentwickeln = پیشرفت کردن، توسعه یافتن
SAY: I wanted to develop myself further.
ANSWER: Ich wollte mich weiterentwickeln.

### STEP
WORD: die Masterarbeit = پایان‌نامه‌ی کارشناسی ارشد
WORD: das Praxisprojekt = پروژه‌ی عملی
SAY: I wanted to combine my master's thesis with a practical project.
ANSWER: Ich wollte meine Masterarbeit mit einem Praxisprojekt kombinieren.`;

export function renderAddInterviewLesson(host) {
  host.innerHTML = `
    <div class="formPage">
      <a href="#/interview">← Interview</a>
      <h1>Add Lesson</h1>
      <p class="hint">
        Write the lesson as <code>### STEP</code> blocks. Each step can teach new words
        (<code>WORD: german = persian</code>, repeatable), an optional grammar aside
        (<code>NOTE:</code>), and a prompt/answer pair (<code>SAY:</code> / <code>ANSWER:</code>) -
        or omit <code>SAY:</code>/<code>ANSWER:</code> entirely for a teach-only step.
        <code>PROMPT_LANG:</code> is optional (<code>en</code> or <code>fa</code>, default <code>fa</code>) and
        controls whether <code>SAY:</code> is shown left-to-right (English) or right-to-left (Persian).
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
