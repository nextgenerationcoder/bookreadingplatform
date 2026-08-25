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
          (no real text in the PDF) are OCR'd for free with local OCR. Runs in the background page
          by page — pages are added to the book as they finish, so you can go start reading while
          the rest keeps processing.
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
        <div id="pdfProgressWrap" hidden>
          <div class="progressBar"><div id="pdfProgressFill" class="progressFill"></div></div>
          <div id="pdfProgressLabel" class="hint" style="padding:6px 0 0"></div>
          <button id="pdfCancelBtn" type="button" class="dangerButton" style="margin-top:8px">Cancel import</button>
        </div>
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
  const progressWrap = host.querySelector('#pdfProgressWrap');
  const progressFill = host.querySelector('#pdfProgressFill');
  const progressLabel = host.querySelector('#pdfProgressLabel');
  const cancelBtn = host.querySelector('#pdfCancelBtn');
  let currentJobId = null;

  if (cancelBtn) {
    cancelBtn.onclick = async () => {
      if (!currentJobId) return;
      cancelBtn.disabled = true;
      cancelBtn.textContent = 'Cancelling…';
      try {
        await api.cancelPdfImport(currentJobId);
      } catch {
        // The next poll will surface the real status either way.
      }
    };
  }

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
      pdfStatus.textContent = 'Starting…';
      pdfStatus.className = 'importStatus';
      try {
        const { jobId } = await api.importBookFromPdf(file, bookId, title, startPage);
        currentJobId = jobId;
        progressWrap.hidden = false;
        cancelBtn.hidden = false;
        cancelBtn.disabled = false;
        cancelBtn.textContent = 'Cancel import';
        pollPdfJob(jobId, bookId);
      } catch (err) {
        pdfStatus.textContent = `Error: ${err.message}`;
        pdfStatus.className = 'importStatus error';
        pdfBtn.disabled = false;
      }
    };
  }

  const MAX_POLL_FAILURES = 8;

  async function pollPdfJob(jobId, bookId, failStreak = 0) {
    const readLink = `<a href="#/book/${encodeURIComponent(bookId)}">→ Go read the book so far</a>`;
    let job;
    try {
      job = await api.getPdfImportStatus(jobId);
    } catch (err) {
      // A poll request can fail for a plain network reason (weak signal,
      // tab backgrounded, etc.) even though the import job keeps running
      // fine on the server. Retry a few times before giving up so a one-off
      // blip doesn't make a 300-page job look like it died.
      const nextStreak = failStreak + 1;
      if (nextStreak <= MAX_POLL_FAILURES) {
        progressLabel.innerHTML = `Connection hiccup, retrying… (${err.message}) ${readLink}`;
        setTimeout(() => pollPdfJob(jobId, bookId, nextStreak), 3000);
        return;
      }
      pdfStatus.innerHTML = `Lost connection to the server while checking progress: ${err.message}. The import may still be running in the background — ${readLink} or reload this page to check.`;
      pdfStatus.className = 'importStatus error';
      pdfBtn.disabled = false;
      return;
    }

    const total = job.totalPages || 0;
    const pct = total ? Math.round((job.currentPage / total) * 100) : 0;
    progressFill.style.width = `${pct}%`;
    progressLabel.innerHTML = total
      ? `Page ${job.currentPage} of ${total} — ${job.pagesFound} added so far. ${readLink}`
      : `Reading the PDF… ${readLink}`;

    if (job.status === 'running') {
      setTimeout(() => pollPdfJob(jobId, bookId, 0), 1500);
      return;
    }

    pdfBtn.disabled = false;
    cancelBtn.hidden = true;
    currentJobId = null;
    const failCount = job.errors?.length || 0;
    if (job.status === 'error') {
      pdfStatus.textContent = `Error: ${job.error}`;
      pdfStatus.className = 'importStatus error';
    } else if (job.status === 'cancelled') {
      pdfStatus.innerHTML = `Cancelled — ${job.pagesFound} page(s) were already added. ${readLink}`;
      pdfStatus.className = 'importStatus';
    } else {
      pdfStatus.innerHTML = failCount
        ? `Done — got ${job.pagesFound} of ${job.totalPages} pages (${failCount} page${failCount > 1 ? 's' : ''} skipped, see below). ${readLink}`
        : `Done — ${job.pagesFound} pages added. ${readLink}`;
      pdfStatus.className = failCount ? 'importStatus error' : 'importStatus success';
      if (failCount) {
        const list = document.createElement('ul');
        list.style.marginTop = '6px';
        for (const e of job.errors) {
          const li = document.createElement('li');
          li.textContent = `Page ${e.pageNumber}: ${e.error}`;
          list.appendChild(li);
        }
        pdfStatus.appendChild(list);
      }
    }
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
