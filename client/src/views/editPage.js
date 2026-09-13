import { api } from '../api.js';

function pageToText(page) {
  const lines = [`PAGE ${page.page}`];
  if (page.chapter) lines.push(`CHAPTER: ${page.chapter}`);
  for (const s of page.sentences) {
    lines.push(`${s.num}: ${s.de}`);
    lines.push(s.fa);
  }
  return lines.join('\n');
}

export async function renderEditPage(host, bookId, pageNumber, kind = 'book') {
  const isCourse = kind === 'course';
  const getContent = isCourse ? api.getCourse : api.getBook;
  const appendContent = isCourse ? api.appendToCourse : api.appendToBook;
  const deleteContentPage = isCourse ? api.deleteCoursePage : api.deletePage;
  const contentHref = isCourse ? `#/course/${encodeURIComponent(bookId)}` : `#/book/${encodeURIComponent(bookId)}`;

  host.innerHTML = '<div class="loading">Loading page…</div>';

  let book, page;
  try {
    book = await getContent(bookId);
    page = book.pages.find((p) => p.page === pageNumber);
  } catch (err) {
    host.innerHTML = `<div class="error">Failed to load the page.<br><small>${err.message}</small></div>`;
    return;
  }
  if (!page) {
    host.innerHTML = `<div class="error">Page ${pageNumber} not found in "${escapeHtml(book.title)}".</div>`;
    return;
  }

  host.innerHTML = `
    <div class="formPage">
      <a href="${contentHref}">← Back to "${escapeHtml(book.title)}"</a>
      <h1>Edit page ${pageNumber}</h1>
      <p class="hint">
        Edit the text below and save to replace this page, or delete it entirely. Deleting cannot
        be undone.
      </p>
      <textarea id="pageText" dir="ltr">${escapeHtml(pageToText(page))}</textarea>
      <div class="formActions">
        <button id="saveBtn">Save Changes</button>
        <button id="deleteBtn" class="dangerButton" type="button">Delete Page</button>
        <a href="${contentHref}">Cancel</a>
      </div>
      <div id="editStatus" class="importStatus"></div>
    </div>
  `;

  const textarea = host.querySelector('#pageText');
  const status = host.querySelector('#editStatus');
  const saveBtn = host.querySelector('#saveBtn');
  const deleteBtn = host.querySelector('#deleteBtn');

  saveBtn.onclick = async () => {
    const text = textarea.value.trim();
    if (!text) {
      status.textContent = 'Page text cannot be empty — use Delete Page instead if you want to remove it.';
      status.className = 'importStatus error';
      return;
    }
    saveBtn.disabled = true;
    deleteBtn.disabled = true;
    status.textContent = 'Saving…';
    status.className = 'importStatus';
    try {
      await appendContent(bookId, text);
      status.textContent = 'Saved.';
      status.className = 'importStatus success';
      setTimeout(() => {
        window.location.hash = contentHref;
      }, 700);
    } catch (err) {
      status.textContent = `Error: ${err.message}`;
      status.className = 'importStatus error';
      saveBtn.disabled = false;
      deleteBtn.disabled = false;
    }
  };

  deleteBtn.onclick = async () => {
    if (!window.confirm(`Delete page ${pageNumber} from "${book.title}"? This cannot be undone.`)) {
      return;
    }
    saveBtn.disabled = true;
    deleteBtn.disabled = true;
    status.textContent = 'Deleting…';
    status.className = 'importStatus';
    try {
      await deleteContentPage(bookId, pageNumber);
      window.location.hash = contentHref;
    } catch (err) {
      status.textContent = `Error: ${err.message}`;
      status.className = 'importStatus error';
      saveBtn.disabled = false;
      deleteBtn.disabled = false;
    }
  };
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
