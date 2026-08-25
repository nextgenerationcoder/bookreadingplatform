import { api } from '../api.js';

const EXAMPLE = `PAGE 16
CHAPTER: Kapitel 2
1: Der nächste deutsche Satz.
جملهٔ بعدی به آلمانی.
2: Noch ein Satz.
یک جملهٔ دیگر.

PAGE 17
CHAPTER: Kapitel 2
1: Und so weiter.
و به همین ترتیب.`;

const MAX_PHOTOS = 10;

export async function renderAddPages(host, bookId, kind = 'book') {
  const isCourse = kind === 'course';
  const getContent = isCourse ? api.getCourse : api.getBook;
  const appendContent = isCourse ? api.appendToCourse : api.appendToBook;
  const backHref = isCourse ? '#/courses' : '#/';
  const backLabel = isCourse ? '← Courses' : '← Library';
  const contentHref = isCourse ? `#/course/${encodeURIComponent(bookId)}` : `#/book/${encodeURIComponent(bookId)}`;

  host.innerHTML = '<div class="loading">Loading…</div>';

  let book, visionSettings;
  try {
    [book, visionSettings] = await Promise.all([
      getContent(bookId),
      api.getVisionSettings().catch(() => ({ configured: false })),
    ]);
  } catch (err) {
    host.innerHTML = `<div class="error">Not found.<br><small>${err.message}</small></div>`;
    return;
  }

  const lastPage = book.pages[book.pages.length - 1]?.page ?? 0;

  host.innerHTML = `
    <div class="formPage">
      <a href="${backHref}">${backLabel}</a>
      <h1>Add pages to "${escapeHtml(book.title)}"</h1>

      <div class="ocrBox">
        <p class="hint" style="padding-top:0">
          Upload up to ${MAX_PHOTOS} page photos at once — an AI reads each one directly and writes
          out the German text and Persian translation in the format below, which you can then review
          and fix before adding.
        </p>
        ${
          visionSettings.configured
            ? `<div class="ocrControls">
                 <input type="file" id="batchFiles" accept="image/*" capture="environment" multiple>
                 <input type="number" id="batchStartPage" value="${lastPage + 1}" min="1" style="width:90px">
                 <input type="text" id="batchChapter" placeholder="Chapter (optional)">
                 <button id="batchBtn" type="button">Analyze &amp; Fill In</button>
               </div>`
            : `<p class="hint" style="padding:0">
                 You need a Vision API key configured first — <a href="#/settings">add one in Settings</a>.
               </p>`
        }
        <div id="batchStatus" class="importStatus"></div>
      </div>

      <details class="exampleBox">
        <summary>Example format</summary>
        <pre>${EXAMPLE}</pre>
      </details>
      <textarea id="pagesText" dir="ltr" placeholder="${EXAMPLE.replace(/"/g, '&quot;')}"></textarea>
      <div class="formActions">
        <button id="appendBtn">Add Pages</button>
        <a href="${contentHref}">Cancel</a>
      </div>
      <div id="appendStatus" class="importStatus"></div>
    </div>
  `;

  const textarea = host.querySelector('#pagesText');
  const status = host.querySelector('#appendStatus');
  const btn = host.querySelector('#appendBtn');
  const batchBtn = host.querySelector('#batchBtn');
  const batchStatus = host.querySelector('#batchStatus');

  if (batchBtn) {
    batchBtn.onclick = async () => {
      const files = [...host.querySelector('#batchFiles').files];
      if (!files.length) {
        batchStatus.textContent = 'Choose at least one photo first.';
        batchStatus.className = 'importStatus error';
        return;
      }
      if (files.length > MAX_PHOTOS) {
        batchStatus.textContent = `Choose at most ${MAX_PHOTOS} photos at a time.`;
        batchStatus.className = 'importStatus error';
        return;
      }
      const startPage = Number(host.querySelector('#batchStartPage').value) || lastPage + 1;
      const chapter = host.querySelector('#batchChapter').value.trim();

      batchBtn.disabled = true;
      batchStatus.textContent = `Analyzing ${files.length} photo${files.length > 1 ? 's' : ''}… this can take a minute or two.`;
      batchStatus.className = 'importStatus';
      try {
        const result = await api.analyzePages(files, startPage, chapter);
        textarea.value = textarea.value.trim() ? `${textarea.value.trim()}\n\n${result.text}` : result.text;
        const failCount = result.errors?.length || 0;
        batchStatus.textContent = failCount
          ? `Got ${result.pagesFound} of ${files.length} pages (${failCount} photo${failCount > 1 ? 's' : ''} couldn't be read). Review the text below before adding.`
          : `Got all ${result.pagesFound} pages. Review the text below before adding (AI can still make mistakes).`;
        batchStatus.className = failCount ? 'importStatus error' : 'importStatus success';
      } catch (err) {
        batchStatus.textContent = `Error: ${err.message}`;
        batchStatus.className = 'importStatus error';
      } finally {
        batchBtn.disabled = false;
      }
    };
  }

  btn.onclick = async () => {
    const text = textarea.value.trim();
    if (!text) {
      status.textContent = 'Enter the new page text first.';
      status.className = 'importStatus error';
      return;
    }
    btn.disabled = true;
    status.textContent = 'Adding…';
    status.className = 'importStatus';
    try {
      const meta = await appendContent(bookId, text);
      status.textContent = `Added — "${meta.title}" now has ${meta.pageCount} pages (up to page ${meta.lastPage}).`;
      status.className = 'importStatus success';
      setTimeout(() => {
        window.location.hash = contentHref;
      }, 900);
    } catch (err) {
      status.textContent = `Error: ${err.message}`;
      status.className = 'importStatus error';
    } finally {
      btn.disabled = false;
    }
  };
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
