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
import { renderImportUrl } from './views/importUrl.js';
import { renderLessonPlayer as renderInteractiveLessonPlayer } from './components/LessonPlayer.js';
import { renderInterviewHome } from './views/interviewHome.js';
import { renderAddInterviewLesson } from './views/addInterviewLesson.js';
import { renderInterviewShell, teardownInterviewShell } from './components/interviewSidebar.js';
import { lesson1 } from './lessons/lesson1.js';
import { tuvNordFoodGpt } from './lessons/tuvNordFoodGpt.js';

// Courses with an active-recall LessonPlayer instead of the plain reading
// view - keyed by course id, so more lessons can be added here later
// without touching the router again. lesson1 (A1 Lektion 1) stays under
// "Courses"; the Interview section (formerly "Learning") starts with just
// tuvNordFoodGpt bundled at build time, plus whatever's imported later via
// Add Lesson (server/src/interviewLessonImporter.js) - see
// STATIC_INTERVIEW_LESSONS below for the ones that belong to that section.
const INTERACTIVE_LESSONS = { [lesson1.courseId]: lesson1 };
const STATIC_INTERVIEW_LESSONS = [tuvNordFoodGpt];
const STATIC_INTERVIEW_LESSONS_BY_ID = { [tuvNordFoodGpt.courseId]: tuvNordFoodGpt };

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

  // "Interview" section (formerly "Learning") - a list of lessons instead
  // of the old single-lesson shortcut, now that more than one exists.
  // kind: 'learning' on the reader route (instead of 'course') only so the
  // nav bar highlights "Interview", not "Courses", while there.
  const interviewLessonMatch = hash.match(/^\/interview\/([^/]+)$/);
  if (interviewLessonMatch) return { view: 'reader', kind: 'learning', bookId: decodeURIComponent(interviewLessonMatch[1]) };
  if (hash === '/interview') return { view: 'interview' };
  if (hash === '/add-interview-lesson') return { view: 'addInterviewLesson' };

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
  if (hash === '/import-url') return { view: 'importUrl' };
  return { view: 'library' };
}

// Android's share sheet (see manifest.json's share_target) navigates to the
// real path /share-target?title=...&text=... - not a #/ hash route, since a
// Web Share Target action has to be an actual URL the browser can GET.
// Sharing selected text (not a whole page) sends it in the "text" field, so
// that's what lands directly in the paste box on #/import-url - handed off
// via sessionStorage rather than a hash query param, since a long shared
// passage (a whole job posting) could realistically exceed a practical URL
// length; importUrl.js reads and clears these two keys on load.
function redirectShareTargetToHash() {
  if (window.location.pathname !== '/share-target') return;
  const params = new URLSearchParams(window.location.search);
  const text = params.get('text') || '';
  const title = params.get('title') || '';
  if (text) sessionStorage.setItem('pendingShareText', text);
  if (title) sessionStorage.setItem('pendingShareTitle', title);

  window.history.replaceState(null, '', '/');
  window.location.hash = '#/import-url';
}
redirectShareTargetToHash();

if ('serviceWorker' in navigator) {
  // Required for the app to be a real installable PWA (not just a browser
  // bookmark) and for Web Share Target (manifest.json) to work at all -
  // Android only offers an installed PWA as a share-sheet destination, and
  // only counts it as "installed" once a service worker is registered.
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}

function buildShell() {
  const initial = currentUser.email.trim().charAt(0).toUpperCase();
  app.innerHTML = `
    <nav class="topNav">
      <a href="#/" class="brand">Bilingual Reader</a>
      <div class="navLinks">
        <a href="#/">Books</a>
        <a href="#/courses">Courses</a>
        <a href="#/interview">Interview</a>
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
      <a href="#/import-url" id="importUrlLink" class="drawerItem">Import Text</a>
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
  document.getElementById('importUrlLink').onclick = closeDrawer;
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
  const interviewViews = ['reader:learning', 'interview', 'addInterviewLesson'];
  const map = { books: 0, courses: 1, learning: 2, practice: 3, words: 4 };
  let group = null;
  if (bookViews.includes(view)) group = 'books';
  else if (courseViews.includes(view)) group = 'courses';
  else if (interviewViews.includes(view)) group = 'learning';
  else if (view === 'practice') group = 'practice';
  else if (view === 'words') group = 'words';
  if (group) links[map[group]]?.classList.add('active');
}

// Static lessons (bundled at build time) resolve instantly; anything else is
// looked up in the DB-backed interview_lessons table (see
// server/src/interviewLessonImporter.js and routes/interviewLessons.js).
async function renderInterviewLesson(host, courseId) {
  if (STATIC_INTERVIEW_LESSONS_BY_ID[courseId]) {
    renderInteractiveLessonPlayer(host, STATIC_INTERVIEW_LESSONS_BY_ID[courseId]);
    return;
  }
  host.innerHTML = '<div class="loading">Loading lesson…</div>';
  let lesson;
  try {
    lesson = await api.getInterviewLesson(courseId);
  } catch (err) {
    host.innerHTML = `<div class="error">Failed to load lesson.<br><small>${err.message}</small></div>`;
    return;
  }
  renderInteractiveLessonPlayer(host, {
    ...lesson,
    backHref: '#/interview',
    backLabel: '← Interview',
    storageKey: `interview-lesson-${lesson.courseId}`,
  });
}

async function route() {
  const { view, kind, bookId, pageNumber, level } = parseRoute();
  const navKey = kind ? `${view}:${kind}` : view;
  setActiveNav(navKey);
  const host = document.getElementById('viewHost');
  const isInterviewView = (view === 'reader' && kind === 'learning') || view === 'interview' || view === 'addInterviewLesson';
  if (!isInterviewView) teardownInterviewShell();
  if (view === 'reader' && kind === 'course' && INTERACTIVE_LESSONS[bookId]) {
    renderInteractiveLessonPlayer(host, INTERACTIVE_LESSONS[bookId]);
  } else if (view === 'reader' && kind === 'learning') {
    const contentHost = await renderInterviewShell(host, STATIC_INTERVIEW_LESSONS, bookId);
    await renderInterviewLesson(contentHost, bookId);
  } else if (view === 'reader') {
    await renderReader(host, bookId, kind);
  } else if (view === 'interview') {
    const contentHost = await renderInterviewShell(host, STATIC_INTERVIEW_LESSONS, null);
    await renderInterviewHome(contentHost, STATIC_INTERVIEW_LESSONS);
  } else if (view === 'addInterviewLesson') {
    const contentHost = await renderInterviewShell(host, STATIC_INTERVIEW_LESSONS, null);
    renderAddInterviewLesson(contentHost);
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
  } else if (view === 'importUrl') {
    renderImportUrl(host);
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
