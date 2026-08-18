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

export async function renderAddPages(host, bookId) {
  host.innerHTML = '<div class="loading">در حال بارگذاری کتاب…</div>';

  let book;
  try {
    book = await api.getBook(bookId);
  } catch (err) {
    host.innerHTML = `<div class="error">کتاب پیدا نشد.<br><small>${err.message}</small></div>`;
    return;
  }

  const lastPage = book.pages[book.pages.length - 1]?.page ?? 0;

  host.innerHTML = `
    <div class="formPage" dir="rtl">
      <a href="#/">← کتابخانه</a>
      <h1>افزودن صفحه به «${escapeHtml(book.title)}»</h1>
      <p class="hint">
        این کتاب تا صفحهٔ ${lastPage} را دارد. متن صفحه‌های جدید را به همان فرمت هر کتاب وارد کن —
        فقط <code>PAGE</code>، <code>CHAPTER</code> و جمله‌ها، نیازی به تکرار <code>BOOK</code>/<code>TITLE</code> نیست.
        اگر شمارهٔ صفحه‌ای که قبلاً وجود داشته را دوباره وارد کنی، همان صفحه جایگزین می‌شود (برای تصحیح).
      </p>
      <details class="exampleBox">
        <summary>نمونهٔ فرمت</summary>
        <pre>${EXAMPLE}</pre>
      </details>
      <textarea id="pagesText" dir="ltr" placeholder="${EXAMPLE.replace(/"/g, '&quot;')}"></textarea>
      <div class="formActions">
        <button id="appendBtn">افزودن صفحه‌ها</button>
        <a href="#/book/${encodeURIComponent(bookId)}">انصراف</a>
      </div>
      <div id="appendStatus" class="importStatus"></div>
    </div>
  `;

  const textarea = host.querySelector('#pagesText');
  const status = host.querySelector('#appendStatus');
  const btn = host.querySelector('#appendBtn');

  btn.onclick = async () => {
    const text = textarea.value.trim();
    if (!text) {
      status.textContent = 'ابتدا متن صفحه‌های جدید را وارد کن.';
      status.className = 'importStatus error';
      return;
    }
    btn.disabled = true;
    status.textContent = 'در حال افزودن…';
    status.className = 'importStatus';
    try {
      const meta = await api.appendToBook(bookId, text);
      status.textContent = `اضافه شد — «${meta.title}» حالا ${meta.pageCount} صفحه دارد (تا صفحهٔ ${meta.lastPage}).`;
      status.className = 'importStatus success';
      setTimeout(() => {
        window.location.hash = `#/book/${encodeURIComponent(bookId)}`;
      }, 900);
    } catch (err) {
      status.textContent = `خطا: ${err.message}`;
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
