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
    <div class="formPage">
      <h1>Add Book</h1>
      <p class="hint">
        Paste the book text in this format: one German line per sentence, with its Persian
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
