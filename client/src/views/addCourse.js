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

const CEFR_LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];

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

      <h2>Or create from an HTML page</h2>
      <p class="hint" style="padding-top:0">
        Upload a self-contained HTML page (e.g. one an AI assistant made for you) as the course's
        first page - shown exactly as uploaded, with the same clickable-word/"Notiz"/"Extract pattern"
        interactivity as a worksheet. More HTML (or text) pages can be added afterwards.
      </p>
      <div class="ocrBox">
        <div class="ocrControls">
          <input type="text" id="htmlCourseId" placeholder="course-id">
          <input type="text" id="htmlCourseTitle" placeholder="Title">
          <select id="htmlCourseLevel">
            ${CEFR_LEVELS.map((lvl) => `<option value="${lvl}" ${lvl === defaultLevel ? 'selected' : ''}>${lvl}</option>`).join('')}
          </select>
          <input type="text" id="htmlCourseChapter" placeholder="Chapter (optional)">
        </div>
        <div class="ocrControls">
          <input type="file" id="htmlCourseFile" accept="text/html,.html">
          <button id="htmlCourseBtn" type="button">Create from HTML</button>
        </div>
        <div id="htmlCourseStatus" class="importStatus"></div>
      </div>
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

  const htmlCourseBtn = host.querySelector('#htmlCourseBtn');
  const htmlCourseStatus = host.querySelector('#htmlCourseStatus');
  htmlCourseBtn.onclick = async () => {
    const courseId = host.querySelector('#htmlCourseId').value.trim();
    const title = host.querySelector('#htmlCourseTitle').value.trim();
    const level = host.querySelector('#htmlCourseLevel').value;
    const chapter = host.querySelector('#htmlCourseChapter').value.trim();
    const file = host.querySelector('#htmlCourseFile').files[0];

    if (!courseId || !title) {
      htmlCourseStatus.textContent = 'Course id and title are required.';
      htmlCourseStatus.className = 'importStatus error';
      return;
    }
    if (!file) {
      htmlCourseStatus.textContent = 'Choose an HTML file first.';
      htmlCourseStatus.className = 'importStatus error';
      return;
    }

    htmlCourseBtn.disabled = true;
    htmlCourseStatus.textContent = 'Creating…';
    htmlCourseStatus.className = 'importStatus';
    try {
      const meta = await api.createCourseFromHtml(file, { courseId, title, level, pageNumber: 1, chapter });
      htmlCourseStatus.textContent = `"${meta.title}" was added successfully.`;
      htmlCourseStatus.className = 'importStatus success';
      setTimeout(() => {
        window.location.hash = `#/course/${encodeURIComponent(meta.id)}`;
      }, 800);
    } catch (err) {
      htmlCourseStatus.textContent = `Error: ${err.message}`;
      htmlCourseStatus.className = 'importStatus error';
    } finally {
      htmlCourseBtn.disabled = false;
    }
  };
}
