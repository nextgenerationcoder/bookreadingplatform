import './style.css';
import { api } from './api.js';
import { renderAuth } from './views/auth.js';
import { renderLibrary } from './views/library.js';
import { renderReader } from './views/reader.js';
import { renderAddBook } from './views/addBook.js';
import { renderAddPages } from './views/addPages.js';
import { renderEditPage } from './views/editPage.js';
import { renderAddWords } from './views/addWords.js';
import { renderMyWords } from './views/myWords.js';
import { renderSettings } from './views/settings.js';

const app = document.getElementById('app');
let currentUser = null;

function parseRoute() {
  const hash = window.location.hash.replace(/^#/, '') || '/';
  const addPagesMatch = hash.match(/^\/book\/([^/]+)\/add-pages$/);
  if (addPagesMatch) return { view: 'addPages', bookId: decodeURIComponent(addPagesMatch[1]) };
  const editPageMatch = hash.match(/^\/book\/([^/]+)\/page\/(\d+)\/edit$/);
  if (editPageMatch) {
    return { view: 'editPage', bookId: decodeURIComponent(editPageMatch[1]), pageNumber: Number(editPageMatch[2]) };
  }
  const bookMatch = hash.match(/^\/book\/([^/]+)$/);
  if (bookMatch) return { view: 'reader', bookId: decodeURIComponent(bookMatch[1]) };
  if (hash === '/add') return { view: 'add' };
  if (hash === '/add-words') return { view: 'addWords' };
  if (hash === '/words') return { view: 'words' };
  if (hash === '/settings') return { view: 'settings' };
  return { view: 'library' };
}

function buildShell() {
  const initial = currentUser.email.trim().charAt(0).toUpperCase();
  app.innerHTML = `
    <nav class="topNav">
      <a href="#/" class="brand">Bilingual Reader</a>
      <div class="navLinks">
        <a href="#/">Library</a>
        <a href="#/words">My Words</a>
        <a href="#/add-words">+ Add Words</a>
        <a href="#/add">+ Add Book</a>
      </div>
      <button id="menuBtn" class="menuBtn" type="button" aria-label="Open menu">
        <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
      </button>
    </nav>
    <div id="drawerOverlay" class="drawerOverlay"></div>
    <aside id="drawer" class="drawer">
      <div class="drawerProfile">
        <div class="avatar">${initial}</div>
        <div class="drawerEmail">${currentUser.email}</div>
      </div>
      <a href="#/settings" id="settingsLink" class="drawerItem">Settings</a>
      <div class="drawerSpacer"></div>
      <button id="logoutBtn" class="drawerItem drawerLogout" type="button">Log out</button>
    </aside>
    <div id="viewHost"></div>
  `;

  const drawer = document.getElementById('drawer');
  const overlay = document.getElementById('drawerOverlay');
  const menuBtn = document.getElementById('menuBtn');

  function openDrawer() {
    drawer.classList.add('open');
    overlay.classList.add('open');
  }
  function closeDrawer() {
    drawer.classList.remove('open');
    overlay.classList.remove('open');
  }

  menuBtn.onclick = openDrawer;
  overlay.onclick = closeDrawer;
  document.getElementById('settingsLink').onclick = closeDrawer;

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
  const idx = map[view === 'reader' || view === 'addPages' || view === 'editPage' ? 'library' : view];
  if (idx != null) links[idx]?.classList.add('active');
}

async function route() {
  const { view, bookId, pageNumber } = parseRoute();
  setActiveNav(view);
  const host = document.getElementById('viewHost');
  if (view === 'reader') {
    await renderReader(host, bookId);
  } else if (view === 'addPages') {
    await renderAddPages(host, bookId);
  } else if (view === 'editPage') {
    await renderEditPage(host, bookId, pageNumber);
  } else if (view === 'add') {
    renderAddBook(host);
  } else if (view === 'addWords') {
    renderAddWords(host);
  } else if (view === 'words') {
    await renderMyWords(host);
  } else if (view === 'settings') {
    await renderSettings(host);
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
