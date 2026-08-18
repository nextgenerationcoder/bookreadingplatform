import './style.css';
import { renderLibrary } from './views/library.js';
import { renderReader } from './views/reader.js';
import { renderAddBook } from './views/addBook.js';
import { renderAddPages } from './views/addPages.js';
import { renderMyWords } from './views/myWords.js';

const app = document.getElementById('app');

function parseRoute() {
  const hash = window.location.hash.replace(/^#/, '') || '/';
  const addPagesMatch = hash.match(/^\/book\/([^/]+)\/add-pages$/);
  if (addPagesMatch) return { view: 'addPages', bookId: decodeURIComponent(addPagesMatch[1]) };
  const bookMatch = hash.match(/^\/book\/([^/]+)$/);
  if (bookMatch) return { view: 'reader', bookId: decodeURIComponent(bookMatch[1]) };
  if (hash === '/add') return { view: 'add' };
  if (hash === '/words') return { view: 'words' };
  return { view: 'library' };
}

function buildShell() {
  app.innerHTML = `
    <nav class="topNav" dir="rtl">
      <a href="#/" class="brand">کتابخوان دوزبانه</a>
      <div class="navLinks">
        <a href="#/">کتابخانه</a>
        <a href="#/words">واژه‌های من</a>
        <a href="#/add">+ افزودن کتاب</a>
      </div>
    </nav>
    <div id="viewHost"></div>
  `;
}

function setActiveNav(view) {
  const links = app.querySelectorAll('.navLinks a');
  links.forEach((a) => a.classList.remove('active'));
  const map = { library: 0, words: 1, add: 2 };
  const idx = map[view === 'reader' || view === 'addPages' ? 'library' : view];
  if (idx != null) links[idx]?.classList.add('active');
}

async function route() {
  const { view, bookId } = parseRoute();
  setActiveNav(view);
  const host = document.getElementById('viewHost');
  if (view === 'reader') {
    await renderReader(host, bookId);
  } else if (view === 'addPages') {
    await renderAddPages(host, bookId);
  } else if (view === 'add') {
    renderAddBook(host);
  } else if (view === 'words') {
    await renderMyWords(host);
  } else {
    await renderLibrary(host);
  }
}

buildShell();
window.addEventListener('hashchange', route);
route();
