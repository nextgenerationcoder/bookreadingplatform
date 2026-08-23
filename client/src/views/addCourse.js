import { api } from '../api.js';

const EXAMPLE = `COURSE: my-course-id
TITLE: My Course Title
LEVEL: A1
LANG: de -> fa

PAGE 1
CHAPTER: Lektion 1
1: Der erste deutsche Satz.
اولین جملهٔ آلمانی.
2: Der zweite Satz.
جملهٔ دوم.

PAGE 2
CHAPTER: Lektion 1
1: Noch eine Seite.
یک صفحهٔ دیگر.`;

export function renderAddCourse(host, defaultLevel) {
  host.innerHTML = `
    <div class="formPage">
      <a href="#/courses">← Courses</a>
      <h1>Add Course</h1>
      <p class="hint">
        Same format as a book, plus a <code>LEVEL:</code> line (A1–C2). One German line per
        sentence, with its Persian translation on the line below, pages marked with
        <code>PAGE &lt;number&gt;</code> and chapters with <code>CHAPTER: &lt;name&gt;</code>.
        You don't need to translate individual words — those come from the shared dictionary automatically.
      </p>
      <details class="exampleBox">
        <summary>Example format</summary>
        <pre>${EXAMPLE}</pre>
      </details>
      <textarea id="courseText" dir="ltr" placeholder="${EXAMPLE.replace(/"/g, '&quot;')}"></textarea>
      <div class="formActions">
        <button id="importBtn">Import Course</button>
        <a href="#/courses">Cancel</a>
      </div>
      <div id="importStatus" class="importStatus"></div>
    </div>
  `;

  const textarea = host.querySelector('#courseText');
  const status = host.querySelector('#importStatus');
  const btn = host.querySelector('#importBtn');

  if (defaultLevel) {
    textarea.value = `COURSE: \nTITLE: \nLEVEL: ${defaultLevel}\nLANG: de -> fa\n\nPAGE 1\nCHAPTER: \n1: \n`;
  }

  btn.onclick = async () => {
    const text = textarea.value.trim();
    if (!text) {
      status.textContent = 'Enter the course text first.';
      status.className = 'importStatus error';
      return;
    }
    btn.disabled = true;
    status.textContent = 'Importing…';
    status.className = 'importStatus';
    try {
      const meta = await api.importCourse(text);
      status.textContent = `"${meta.title}" was added successfully (${meta.pageCount} pages).`;
      status.className = 'importStatus success';
      setTimeout(() => {
        window.location.hash = `#/course/${encodeURIComponent(meta.id)}`;
      }, 800);
    } catch (err) {
      status.textContent = `Error: ${err.message}`;
      status.className = 'importStatus error';
    } finally {
      btn.disabled = false;
    }
  };
}
