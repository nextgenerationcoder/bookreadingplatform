import { api } from '../api.js';
import { scanPageToText } from '../ocrScan.js';

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

export async function renderAddPages(host, bookId) {
  host.innerHTML = '<div class="loading">Loading book…</div>';

  let book;
  try {
    book = await api.getBook(bookId);
  } catch (err) {
    host.innerHTML = `<div class="error">Book not found.<br><small>${err.message}</small></div>`;
    return;
  }

  const lastPage = book.pages[book.pages.length - 1]?.page ?? 0;

  host.innerHTML = `
    <div class="formPage">
      <a href="#/">← Library</a>
      <h1>Add pages to "${escapeHtml(book.title)}"</h1>
      <p class="hint">
        This book currently goes up to page ${lastPage}. Paste the new pages in the same format as
        any book — just <code>PAGE</code>, <code>CHAPTER</code>, and sentences; no need to repeat
        <code>BOOK</code>/<code>TITLE</code>. If you enter a page number that already exists, that
        page gets replaced (useful for corrections).
      </p>
      <details class="exampleBox">
        <summary>Example format</summary>
        <pre>${EXAMPLE}</pre>
      </details>

      <div class="ocrBox">
        <p class="hint" style="padding-top:0">
          Or scan a photo of the page: extracts the German text and auto-translates it into the
          format above, which you can then review and fix before adding.
        </p>
        <div class="ocrControls">
          <input type="file" id="ocrFile" accept="image/*" capture="environment">
          <input type="number" id="ocrPage" value="${lastPage + 1}" min="1" style="width:80px">
          <input type="text" id="ocrChapter" placeholder="Chapter (optional)">
          <button id="ocrBtn" type="button">Scan &amp; Translate</button>
        </div>
        <div id="ocrStatus" class="importStatus"></div>
      </div>

      <textarea id="pagesText" dir="ltr" placeholder="${EXAMPLE.replace(/"/g, '&quot;')}"></textarea>
      <div class="formActions">
        <button id="appendBtn">Add Pages</button>
        <a href="#/book/${encodeURIComponent(bookId)}">Cancel</a>
      </div>
      <div id="appendStatus" class="importStatus"></div>
    </div>
  `;

  const textarea = host.querySelector('#pagesText');
  const status = host.querySelector('#appendStatus');
  const btn = host.querySelector('#appendBtn');
  const ocrBtn = host.querySelector('#ocrBtn');
  const ocrStatus = host.querySelector('#ocrStatus');

  ocrBtn.onclick = async () => {
    const file = host.querySelector('#ocrFile').files[0];
    if (!file) {
      ocrStatus.textContent = 'Choose a photo first.';
      ocrStatus.className = 'importStatus error';
      return;
    }
    const pageNumber = Number(host.querySelector('#ocrPage').value) || lastPage + 1;
    const chapter = host.querySelector('#ocrChapter').value.trim();

    ocrBtn.disabled = true;
    ocrStatus.textContent = 'Scanning photo… (this can take a little while)';
    ocrStatus.className = 'importStatus';
    try {
      const scanned = await scanPageToText(file, pageNumber, chapter);
      textarea.value = textarea.value.trim() ? `${textarea.value.trim()}\n\n${scanned}` : scanned;
      ocrStatus.textContent = 'Scanned — review the text below before adding (OCR and translation can both make mistakes).';
      ocrStatus.className = 'importStatus success';
    } catch (err) {
      ocrStatus.textContent = `Error: ${err.message}`;
      ocrStatus.className = 'importStatus error';
    } finally {
      ocrBtn.disabled = false;
    }
  };

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
      const meta = await api.appendToBook(bookId, text);
      status.textContent = `Added — "${meta.title}" now has ${meta.pageCount} pages (up to page ${meta.lastPage}).`;
      status.className = 'importStatus success';
      setTimeout(() => {
        window.location.hash = `#/book/${encodeURIComponent(bookId)}`;
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
