import { api } from '../api.js';

const EXAMPLE = `BOOK: my-book-id
TITLE: My Book Title
LANG: de -> fa

PAGE 1
CHAPTER: Kapitel 1
1: Der erste deutsche Satz.
اولین جملهٔ آلمانی.
2: Der zweite Satz.
جملهٔ دوم.

PAGE 2
CHAPTER: Kapitel 1
1: Noch eine Seite.
یک صفحهٔ دیگر.`;

export async function renderAddBook(host) {
  let llmSettings = { configured: false };
  try {
    llmSettings = await api.getLlmSettings();
  } catch {
    // leave unconfigured - the PDF box will just show the Settings link
  }

  host.innerHTML = `
    <div class="formPage">
      <h1>Add Book</h1>

      <div class="ocrBox">
        <p class="hint" style="padding-top:0">
          Or upload a whole book as a PDF: it extracts the text page by page (for free, from the
          PDF itself) and translates + formats every page with your Translation API key, building
          the book in one go — no manual copy-pasting. Pages that turn out to be scanned images
          (no real text in the PDF) are OCR'd with your Vision API key if you've set one in
          Settings; otherwise they're just skipped and listed.
        </p>
        ${
          llmSettings.configured
            ? `<div class="ocrControls">
                 <input type="file" id="pdfFile" accept="application/pdf">
                 <input type="text" id="pdfBookId" placeholder="book-id (e.g. my-book)">
                 <input type="text" id="pdfTitle" placeholder="Title">
                 <input type="number" id="pdfStartPage" value="1" min="1" style="width:80px">
                 <button id="pdfBtn" type="button">Import Whole PDF</button>
               </div>`
            : `<p class="hint" style="padding:0">
                 You need a Translation API key configured first — <a href="#/settings">add one in Settings</a>.
               </p>`
        }
        <div id="pdfStatus" class="importStatus"></div>
      </div>

      <p class="hint">
        Or paste the book text in this format: one German line per sentence, with its Persian
        translation on the line below, pages marked with <code>PAGE &lt;number&gt;</code> and
        chapters with <code>CHAPTER: &lt;name&gt;</code>.
        You don't need to translate individual words — those come from the shared dictionary automatically.
      </p>
      <details class="exampleBox">
        <summary>Example format</summary>
        <pre>${EXAMPLE}</pre>
      </details>
      <textarea id="bookText" dir="ltr" placeholder="${EXAMPLE.replace(/"/g, '&quot;')}"></textarea>
      <div class="formActions">
        <button id="importBtn">Import Book</button>
        <a href="#/">Cancel</a>
      </div>
      <div id="importStatus" class="importStatus"></div>
    </div>
  `;

  const textarea = host.querySelector('#bookText');
  const status = host.querySelector('#importStatus');
  const btn = host.querySelector('#importBtn');
  const pdfBtn = host.querySelector('#pdfBtn');
  const pdfStatus = host.querySelector('#pdfStatus');

  if (pdfBtn) {
    pdfBtn.onclick = async () => {
      const file = host.querySelector('#pdfFile').files[0];
      const bookId = host.querySelector('#pdfBookId').value.trim();
      const title = host.querySelector('#pdfTitle').value.trim();
      const startPage = Number(host.querySelector('#pdfStartPage').value) || 1;
      if (!file) {
        pdfStatus.textContent = 'Choose a PDF first.';
        pdfStatus.className = 'importStatus error';
        return;
      }
      if (!bookId) {
        pdfStatus.textContent = 'Enter a book id.';
        pdfStatus.className = 'importStatus error';
        return;
      }
      pdfBtn.disabled = true;
      pdfStatus.textContent = 'Reading and translating the PDF… this can take a while for a whole book.';
      pdfStatus.className = 'importStatus';
      try {
        const result = await api.importBookFromPdf(file, bookId, title, startPage);
        const failCount = result.errors?.length || 0;
        pdfStatus.textContent = failCount
          ? `Added — got ${result.pagesFound} of ${result.totalPages} pages (${failCount} page${failCount > 1 ? 's' : ''} skipped, see below).`
          : `Added — "${result.meta.title}" now has ${result.meta.pageCount} pages.`;
        pdfStatus.className = failCount ? 'importStatus error' : 'importStatus success';
        if (failCount) {
          const list = document.createElement('ul');
          list.style.marginTop = '6px';
          for (const e of result.errors) {
            const li = document.createElement('li');
            li.textContent = `Page ${e.pageNumber}: ${e.error}`;
            list.appendChild(li);
          }
          pdfStatus.appendChild(list);
        }
        setTimeout(() => {
          window.location.hash = `#/book/${encodeURIComponent(result.meta.id)}`;
        }, failCount ? 3000 : 1200);
      } catch (err) {
        pdfStatus.textContent = `Error: ${err.message}`;
        pdfStatus.className = 'importStatus error';
      } finally {
        pdfBtn.disabled = false;
      }
    };
  }

  btn.onclick = async () => {
    const text = textarea.value.trim();
    if (!text) {
      status.textContent = 'Enter the book text first.';
      status.className = 'importStatus error';
      return;
    }
    btn.disabled = true;
    status.textContent = 'Importing…';
    status.className = 'importStatus';
    try {
      const meta = await api.importBook(text);
      status.textContent = `"${meta.title}" was added successfully (${meta.pageCount} pages).`;
      status.className = 'importStatus success';
      setTimeout(() => {
        window.location.hash = `#/book/${encodeURIComponent(meta.id)}`;
      }, 800);
    } catch (err) {
      status.textContent = `Error: ${err.message}`;
      status.className = 'importStatus error';
    } finally {
      btn.disabled = false;
    }
  };
}
