import { api } from '../api.js';

export async function renderLibrary(host) {
  host.innerHTML = '<div class="loading">در حال بارگذاری کتاب‌ها…</div>';

  let books;
  try {
    books = await api.listBooks();
  } catch (err) {
    host.innerHTML = `<div class="error">دریافت فهرست کتاب‌ها با خطا مواجه شد.<br><small>${err.message}</small></div>`;
    return;
  }

  if (!books.length) {
    host.innerHTML = `
      <div class="loading" dir="rtl">
        هنوز کتابی اضافه نشده است.
        <br><br>
        <a class="button" href="#/add">افزودن کتاب</a>
      </div>
    `;
    return;
  }

  host.innerHTML = `
    <div class="libraryHeader" dir="rtl">
      <h1>کتابخانه</h1>
      <a class="button" href="#/add">+ افزودن کتاب</a>
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
  card.dir = 'rtl';
  card.innerHTML = `
    <a class="bookCardTitle" href="#/book/${encodeURIComponent(book.id)}">${escapeHtml(book.title)}</a>
    <div class="bookCardMeta">
      ${book.language.source.toUpperCase()} → ${book.language.target.toUpperCase()}
      · ${book.pageCount} صفحه (${book.firstPage}–${book.lastPage})
    </div>
    <div class="bookCardActions">
      <button class="linkButton" data-action="rename">✏️ ویرایش نام</button>
      <a class="linkButton" href="#/book/${encodeURIComponent(book.id)}/add-pages">+ افزودن صفحه</a>
    </div>
    <div class="renameBox" hidden>
      <input type="text" class="renameInput" value="${escapeAttr(book.title)}">
      <div class="renameActions">
        <button data-action="save">ذخیره</button>
        <button data-action="cancel">لغو</button>
      </div>
      <div class="renameStatus"></div>
    </div>
  `;

  const titleEl = card.querySelector('.bookCardTitle');
  const renameBtn = card.querySelector('[data-action="rename"]');
  const renameBox = card.querySelector('.renameBox');
  const renameInput = card.querySelector('.renameInput');
  const saveBtn = card.querySelector('[data-action="save"]');
  const cancelBtn = card.querySelector('[data-action="cancel"]');
  const status = card.querySelector('.renameStatus');

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
      status.textContent = 'نام نمی‌تواند خالی باشد.';
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
      status.textContent = `خطا: ${err.message}`;
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
