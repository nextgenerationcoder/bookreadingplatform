import { api } from '../api.js';

export async function renderLibrary(host) {
  host.innerHTML = '<div class="loading">Loading books…</div>';

  let books;
  try {
    books = await api.listBooks();
  } catch (err) {
    host.innerHTML = `<div class="error">Failed to load the book list.<br><small>${err.message}</small></div>`;
    return;
  }

  if (!books.length) {
    host.innerHTML = `
      <div class="loading">
        No books added yet.
        <br><br>
        <a class="button" href="#/add">Add a book</a>
      </div>
    `;
    return;
  }

  host.innerHTML = `
    <div class="libraryHeader">
      <h1>Library</h1>
      <a class="button" href="#/add">+ Add Book</a>
    </div>
    <div class="bookGrid"></div>
  `;

  const grid = host.querySelector('.bookGrid');
  for (const book of books) {
    grid.appendChild(renderBookCard(book));
  }
}

function renderBookCard(book) {
  const card = document.createElement('div');
  card.className = 'bookCard';
  card.innerHTML = `
    <a class="bookCardTitle" href="#/book/${encodeURIComponent(book.id)}">${escapeHtml(book.title)}</a>
    <div class="bookCardMeta">
      ${book.language.source.toUpperCase()} → ${book.language.target.toUpperCase()}
      · ${book.pageCount} pages (${book.firstPage}–${book.lastPage})
    </div>
    <div class="bookCardActions">
      <button class="linkButton" data-action="rename">✏️ Edit name</button>
      <a class="linkButton" href="#/book/${encodeURIComponent(book.id)}/add-pages">+ Add Pages</a>
      <button class="linkButton" data-action="delete" style="color:#b3261e">🗑️ Delete</button>
    </div>
    <div class="renameBox" hidden>
      <input type="text" class="renameInput" value="${escapeAttr(book.title)}">
      <div class="renameActions">
        <button data-action="save">Save</button>
        <button data-action="cancel">Cancel</button>
      </div>
      <div class="renameStatus"></div>
    </div>
    <div class="renameBox" data-role="deleteBox" hidden>
      <p class="renameStatus" style="margin:0 0 8px">Delete "${escapeHtml(book.title)}" and all its pages? This can't be undone.</p>
      <div class="renameActions">
        <button class="dangerButton" data-action="confirmDelete">Delete permanently</button>
        <button data-action="cancelDelete">Cancel</button>
      </div>
      <div class="renameStatus" data-role="deleteStatus"></div>
    </div>
  `;

  const titleEl = card.querySelector('.bookCardTitle');
  const renameBtn = card.querySelector('[data-action="rename"]');
  const renameBox = card.querySelector('.renameBox');
  const renameInput = card.querySelector('.renameInput');
  const saveBtn = card.querySelector('[data-action="save"]');
  const cancelBtn = card.querySelector('[data-action="cancel"]');
  const status = card.querySelector('.renameStatus');
  const deleteBtn = card.querySelector('[data-action="delete"]');
  const deleteBox = card.querySelector('[data-role="deleteBox"]');
  const confirmDeleteBtn = card.querySelector('[data-action="confirmDelete"]');
  const cancelDeleteBtn = card.querySelector('[data-action="cancelDelete"]');
  const deleteStatus = card.querySelector('[data-role="deleteStatus"]');

  deleteBtn.onclick = () => {
    deleteBox.hidden = false;
    deleteBtn.parentElement.hidden = true;
  };

  cancelDeleteBtn.onclick = () => {
    deleteBox.hidden = true;
    deleteBtn.parentElement.hidden = false;
    deleteStatus.textContent = '';
  };

  confirmDeleteBtn.onclick = async () => {
    confirmDeleteBtn.disabled = true;
    try {
      await api.deleteBook(book.id);
      card.remove();
    } catch (err) {
      deleteStatus.textContent = `Error: ${err.message}`;
      deleteStatus.className = 'renameStatus error';
      confirmDeleteBtn.disabled = false;
    }
  };

  renameBtn.onclick = () => {
    renameBox.hidden = false;
    renameBtn.parentElement.hidden = true;
    renameInput.value = book.title;
    renameInput.focus();
    renameInput.select();
  };

  cancelBtn.onclick = () => {
    renameBox.hidden = true;
    renameBtn.parentElement.hidden = false;
    status.textContent = '';
  };

  saveBtn.onclick = async () => {
    const newTitle = renameInput.value.trim();
    if (!newTitle) {
      status.textContent = 'Name cannot be empty.';
      status.className = 'renameStatus error';
      return;
    }
    saveBtn.disabled = true;
    try {
      const meta = await api.renameBook(book.id, newTitle);
      book.title = meta.title;
      titleEl.textContent = meta.title;
      renameBox.hidden = true;
      renameBtn.parentElement.hidden = false;
      status.textContent = '';
    } catch (err) {
      status.textContent = `Error: ${err.message}`;
      status.className = 'renameStatus error';
    } finally {
      saveBtn.disabled = false;
    }
  };

  return card;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function escapeAttr(str) {
  return str.replace(/"/g, '&quot;');
}
