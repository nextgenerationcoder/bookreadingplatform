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
    const card = document.createElement('a');
    card.className = 'bookCard';
    card.href = `#/book/${encodeURIComponent(book.id)}`;
    card.innerHTML = `
      <div class="bookCardTitle">${escapeHtml(book.title)}</div>
      <div class="bookCardMeta" dir="rtl">
        ${book.language.source.toUpperCase()} → ${book.language.target.toUpperCase()}
        · ${book.pageCount} صفحه (${book.firstPage}–${book.lastPage})
      </div>
    `;
    grid.appendChild(card);
  }
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
