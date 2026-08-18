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

export function renderAddBook(host) {
  host.innerHTML = `
    <div class="formPage" dir="rtl">
      <h1>افزودن کتاب</h1>
      <p class="hint">
        متن کتاب را به این فرمت وارد کن: هر جمله یک خط آلمانی و زیرش یک خط ترجمهٔ فارسی،
        صفحه‌ها با <code>PAGE &lt;شماره&gt;</code> و فصل‌ها با <code>CHAPTER: &lt;نام&gt;</code> مشخص می‌شوند.
        ترجمهٔ تک‌تک کلمات لازم نیست — از واژه‌نامهٔ مشترک به‌صورت خودکار خوانده می‌شود.
      </p>
      <details class="exampleBox">
        <summary>نمونهٔ فرمت</summary>
        <pre>${EXAMPLE}</pre>
      </details>
      <textarea id="bookText" dir="ltr" placeholder="${EXAMPLE.replace(/"/g, '&quot;')}"></textarea>
      <div class="formActions">
        <button id="importBtn">وارد کردن کتاب</button>
        <a href="#/">انصراف</a>
      </div>
      <div id="importStatus" class="importStatus"></div>
    </div>
  `;

  const textarea = host.querySelector('#bookText');
  const status = host.querySelector('#importStatus');
  const btn = host.querySelector('#importBtn');

  btn.onclick = async () => {
    const text = textarea.value.trim();
    if (!text) {
      status.textContent = 'ابتدا متن کتاب را وارد کن.';
      status.className = 'importStatus error';
      return;
    }
    btn.disabled = true;
    status.textContent = 'در حال وارد کردن…';
    status.className = 'importStatus';
    try {
      const meta = await api.importBook(text);
      status.textContent = `«${meta.title}» با موفقیت اضافه شد (${meta.pageCount} صفحه).`;
      status.className = 'importStatus success';
      setTimeout(() => {
        window.location.hash = `#/book/${encodeURIComponent(meta.id)}`;
      }, 800);
    } catch (err) {
      status.textContent = `خطا: ${err.message}`;
      status.className = 'importStatus error';
    } finally {
      btn.disabled = false;
    }
  };
}
