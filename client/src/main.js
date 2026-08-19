import './style.css';
import { api } from './api.js';
import { renderAuth } from './views/auth.js';
import { renderLibrary } from './views/library.js';
import { renderReader } from './views/reader.js';
import { renderAddBook } from './views/addBook.js';
import { renderAddPages } from './views/addPages.js';
import { renderAddWords } from './views/addWords.js';
import { renderMyWords } from './views/myWords.js';

const app = document.getElementById('app');
let currentUser = null;

function parseRoute() {
  const hash = window.location.hash.replace(/^#/, '') || '/';
  const addPagesMatch = hash.match(/^\/book\/([^/]+)\/add-pages$/);
  if (addPagesMatch) return { view: 'addPages', bookId: decodeURIComponent(addPagesMatch[1]) };
  const bookMatch = hash.match(/^\/book\/([^/]+)$/);
  if (bookMatch) return { view: 'reader', bookId: decodeURIComponent(bookMatch[1]) };
  if (hash === '/add') return { view: 'add' };
  if (hash === '/add-words') return { view: 'addWords' };
  if (hash === '/words') return { view: 'words' };
  return { view: 'library' };
}

function buildShell() {
  app.innerHTML = `
    <nav class="topNav">
      <a href="#/" class="brand">Bilingual Reader</a>
      <div class="navLinks">
        <a href="#/">Library</a>
        <a href="#/words">My Words</a>
        <a href="#/add-words">+ Add Words</a>
        <a href="#/add">+ Add Book</a>
      </div>
      <div class="navUser">
        <span class="navEmail">${currentUser.email}</span>
        <button id="logoutBtn" class="linkButton">Log out</button>
      </div>
    </nav>
    <div id="viewHost"></div>
  `;
  document.getElementById('logoutBtn').onclick = async () => {
    await api.logout().catch(() => {});
    currentUser = null;
    init();
  };
}

function setActiveNav(view) {
  const links = app.querySelectorAll('.navLinks a');
  links.forEach((a) => a.classList.remove('active'));
  const map = { library: 0, words: 1, addWords: 2, add: 3 };
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
  } else if (view === 'addWords') {
    renderAddWords(host);
  } else if (view === 'words') {
    await renderMyWords(host);
  } else {
    await renderLibrary(host);
  }
}

async function init() {
  if (!currentUser) {
    try {
      currentUser = await api.me();
    } catch {
      currentUser = null;
    }
  }

  if (!currentUser) {
    app.innerHTML = '';
    renderAuth(app, (user) => {
      currentUser = user;
      init();
    });
    return;
  }

  buildShell();
  window.addEventListener('hashchange', route);
  route();
}

init();
