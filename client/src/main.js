import './style.css';
import { api } from './api.js';
import { renderAuth } from './views/auth.js';
import { renderLibrary } from './views/library.js';
import { renderCourseLevels, renderCourseList } from './views/courses.js';
import { renderPractice } from './views/practice.js';
import { renderReader } from './views/reader.js';
import { renderAddBook } from './views/addBook.js';
import { renderAddCourse } from './views/addCourse.js';
import { renderAddPages } from './views/addPages.js';
import { renderEditPage } from './views/editPage.js';
import { renderAddWords } from './views/addWords.js';
import { renderMyWords } from './views/myWords.js';
import { renderSettings } from './views/settings.js';
import { renderImportHistory } from './views/importHistory.js';

const app = document.getElementById('app');
let currentUser = null;

function parseRoute() {
  const raw = window.location.hash.replace(/^#/, '') || '/';
  const [hash, query] = raw.split('?');

  const bookAddPagesMatch = hash.match(/^\/book\/([^/]+)\/add-pages$/);
  if (bookAddPagesMatch) return { view: 'addPages', kind: 'book', bookId: decodeURIComponent(bookAddPagesMatch[1]) };
  const bookEditPageMatch = hash.match(/^\/book\/([^/]+)\/page\/(\d+)\/edit$/);
  if (bookEditPageMatch) {
    return { view: 'editPage', kind: 'book', bookId: decodeURIComponent(bookEditPageMatch[1]), pageNumber: Number(bookEditPageMatch[2]) };
  }
  const bookMatch = hash.match(/^\/book\/([^/]+)$/);
  if (bookMatch) return { view: 'reader', kind: 'book', bookId: decodeURIComponent(bookMatch[1]) };

  const courseAddPagesMatch = hash.match(/^\/course\/([^/]+)\/add-pages$/);
  if (courseAddPagesMatch) return { view: 'addPages', kind: 'course', bookId: decodeURIComponent(courseAddPagesMatch[1]) };
  const courseEditPageMatch = hash.match(/^\/course\/([^/]+)\/page\/(\d+)\/edit$/);
  if (courseEditPageMatch) {
    return { view: 'editPage', kind: 'course', bookId: decodeURIComponent(courseEditPageMatch[1]), pageNumber: Number(courseEditPageMatch[2]) };
  }
  const courseMatch = hash.match(/^\/course\/([^/]+)$/);
  if (courseMatch) return { view: 'reader', kind: 'course', bookId: decodeURIComponent(courseMatch[1]) };

  const courseLevelMatch = hash.match(/^\/courses\/(A1|A2|B1|B2|C1|C2)$/);
  if (courseLevelMatch) return { view: 'courseLevel', level: courseLevelMatch[1] };
  if (hash === '/courses') return { view: 'courses' };
  if (hash === '/add-course') {
    const params = new URLSearchParams(query || '');
    return { view: 'addCourse', level: params.get('level') };
  }
  if (hash === '/practice') return { view: 'practice' };

  if (hash === '/add') return { view: 'add' };
  if (hash === '/add-words') return { view: 'addWords' };
  if (hash === '/words') return { view: 'words' };
  if (hash === '/settings') return { view: 'settings' };
  if (hash === '/import-history') return { view: 'importHistory' };
  return { view: 'library' };
}

function buildShell() {
  const initial = currentUser.email.trim().charAt(0).toUpperCase();
  app.innerHTML = `
    <nav class="topNav">
      <a href="#/" class="brand">Bilingual Reader</a>
      <div class="navLinks">
        <a href="#/">Books</a>
        <a href="#/courses">Courses</a>
        <a href="#/practice">Practice</a>
        <a href="#/words">My Words</a>
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
      <a href="#/import-history" id="importHistoryLink" class="drawerItem">Import History</a>
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
  document.getElementById('importHistoryLink').onclick = closeDrawer;

  document.getElementById('logoutBtn').onclick = async () => {
    await api.logout().catch(() => {});
    currentUser = null;
    init();
  };
}

function setActiveNav(view) {
  const links = app.querySelectorAll('.navLinks a');
  links.forEach((a) => a.classList.remove('active'));
  const bookViews = ['library', 'reader:book', 'addPages:book', 'editPage:book', 'add'];
  const courseViews = ['courses', 'courseLevel', 'reader:course', 'addPages:course', 'editPage:course', 'addCourse'];
  const map = { books: 0, courses: 1, practice: 2, words: 3 };
  let group = null;
  if (bookViews.includes(view)) group = 'books';
  else if (courseViews.includes(view)) group = 'courses';
  else if (view === 'practice') group = 'practice';
  else if (view === 'words') group = 'words';
  if (group) links[map[group]]?.classList.add('active');
}

async function route() {
  const { view, kind, bookId, pageNumber, level } = parseRoute();
  const navKey = kind ? `${view}:${kind}` : view;
  setActiveNav(navKey);
  const host = document.getElementById('viewHost');
  if (view === 'reader') {
    await renderReader(host, bookId, kind);
  } else if (view === 'addPages') {
    await renderAddPages(host, bookId, kind);
  } else if (view === 'editPage') {
    await renderEditPage(host, bookId, pageNumber, kind);
  } else if (view === 'add') {
    renderAddBook(host);
  } else if (view === 'courses') {
    await renderCourseLevels(host);
  } else if (view === 'courseLevel') {
    await renderCourseList(host, level);
  } else if (view === 'addCourse') {
    renderAddCourse(host, level);
  } else if (view === 'practice') {
    renderPractice(host);
  } else if (view === 'addWords') {
    renderAddWords(host);
  } else if (view === 'words') {
    await renderMyWords(host);
  } else if (view === 'settings') {
    await renderSettings(host);
  } else if (view === 'importHistory') {
    await renderImportHistory(host);
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
