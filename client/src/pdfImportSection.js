import { api } from './api.js';

// Shared "upload a whole PDF" background-import control block: progress
// bar, "Part X of Y" chunk label, cancel button, live error list. Used by
// both Add Book (creates a new book - bookId/title are typed in) and Add
// Pages (appends to the current book - bookId is fixed and hidden, since
// the backend's import-pdf endpoint already appends when the book exists
// and creates it otherwise).
//
// renderPdfImportHtml() returns markup for host.innerHTML; call
// wirePdfImportSection(host, opts) once those elements are in the DOM.

const MAX_POLL_FAILURES = 8;

export function renderPdfImportHtml({ fixedBookId, defaultStartPage = 1, hint }) {
  return `
    <div class="ocrBox">
      <p class="hint" style="padding-top:0">${hint}</p>
      <div class="ocrControls">
        <input type="file" id="pdfFile" accept="application/pdf">
        ${fixedBookId ? '' : '<input type="text" id="pdfBookId" placeholder="book-id (e.g. my-book)">'}
        ${fixedBookId ? '' : '<input type="text" id="pdfTitle" placeholder="Title">'}
        <input type="number" id="pdfStartPage" value="${defaultStartPage}" min="1" style="width:90px">
        <button id="pdfBtn" type="button">Import Whole PDF</button>
      </div>
      <div id="pdfProgressWrap" hidden>
        <div class="progressBar"><div id="pdfProgressFill" class="progressFill"></div></div>
        <div id="pdfProgressLabel" class="hint" style="padding:6px 0 0"></div>
        <button id="pdfCancelBtn" type="button" class="dangerButton" style="margin-top:8px">Cancel import</button>
      </div>
      <div id="pdfStatus" class="importStatus"></div>
    </div>
  `;
}

export function wirePdfImportSection(host, { fixedBookId, defaultTitle = '' } = {}) {
  const pdfBtn = host.querySelector('#pdfBtn');
  if (!pdfBtn) return;
  const pdfStatus = host.querySelector('#pdfStatus');
  const progressWrap = host.querySelector('#pdfProgressWrap');
  const progressFill = host.querySelector('#pdfProgressFill');
  const progressLabel = host.querySelector('#pdfProgressLabel');
  const cancelBtn = host.querySelector('#pdfCancelBtn');
  let currentJobId = null;

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

  pdfBtn.onclick = async () => {
    const file = host.querySelector('#pdfFile').files[0];
    const bookId = fixedBookId || host.querySelector('#pdfBookId')?.value.trim();
    const title = fixedBookId ? defaultTitle : (host.querySelector('#pdfTitle')?.value.trim() || '');
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
    const chunkLabel = job.totalChunks ? `Part ${job.currentChunk} of ${job.totalChunks} — ` : '';
    progressLabel.innerHTML = total
      ? `${chunkLabel}Page ${job.currentPage} of ${total} — ${job.pagesFound} added so far. ${readLink}`
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

  // The import itself keeps running on the server regardless of what the
  // browser does - navigating away, closing the tab, even a server restart
  // (see resumePendingPdfJobs on the backend). But without this, leaving
  // this page and coming back showed no progress bar at all, since nothing
  // here knew a job was still going - it looked like the import had
  // stopped even though it hadn't. Check for one on load and reattach.
  (async () => {
    let active;
    try {
      active = await api.getActivePdfImports();
    } catch {
      return;
    }
    const match = fixedBookId ? active.find((j) => j.bookId === fixedBookId) : active[0];
    if (!match) return;
    currentJobId = match.jobId;
    pdfBtn.disabled = true;
    progressWrap.hidden = false;
    cancelBtn.hidden = false;
    cancelBtn.disabled = false;
    cancelBtn.textContent = 'Cancel import';
    pdfStatus.textContent = 'Reattached to an import already running in the background…';
    pdfStatus.className = 'importStatus';
    pollPdfJob(match.jobId, match.bookId);
  })();
}
