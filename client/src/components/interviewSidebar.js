import { api } from '../api.js';

const COLLAPSE_KEY = 'interviewSidebarCollapsed';
const EXPANDED_WIDTH = '220px';
const COLLAPSED_WIDTH = '46px';

// Undoes what renderInterviewShell sets up on <body>/<html> - called by
// main.js's route() before rendering any non-Interview view, since a
// position:fixed rail (see below) outlives whatever DOM it was drawn into
// unless something explicitly removes the body class that makes room for it.
export function teardownInterviewShell() {
  document.body.classList.remove('has-interview-sidebar');
}

// Builds the Interview layout: a lesson sidebar pinned to the true left edge
// of the browser window (position: fixed, full height) - like a persistent
// app rail (e.g. Claude Code's own left sidebar), not just indented within
// the centered #app column - plus a content area for the caller's own view.
// Shared by all three Interview views (list, add lesson, lesson player), so
// you can jump to a different lesson without leaving the section. Combines
// static lessons (bundled at build time) with DB-backed ones (see
// server/src/interviewLessonImporter.js). Returns the empty content host for
// the caller to render its own view into.
export async function renderInterviewShell(host, staticLessons, activeCourseId) {
  document.body.classList.add('has-interview-sidebar');

  host.innerHTML = `
    <aside class="interviewSidebar" id="interviewSidebar">
      <div class="interviewSidebarHeader">
        <span class="interviewSidebarTitle">Lessons</span>
        <button type="button" id="interviewSidebarToggle" class="interviewSidebarToggle" aria-label="Toggle lessons sidebar"></button>
      </div>
      <div class="interviewSidebarList" id="interviewSidebarList">
        <div class="loading">Loading…</div>
      </div>
      <a href="#/add-interview-lesson" class="interviewSidebarAdd">+ Add Lesson</a>
    </aside>
    <div class="interviewContent" id="interviewContent"></div>
  `;

  const sidebar = host.querySelector('#interviewSidebar');
  const toggle = host.querySelector('#interviewSidebarToggle');
  const list = host.querySelector('#interviewSidebarList');
  const contentHost = host.querySelector('#interviewContent');

  const applyCollapsed = (collapsed) => {
    sidebar.classList.toggle('collapsed', collapsed);
    toggle.textContent = collapsed ? '▸' : '◂';
    // #app is pushed right by exactly this much (see body.has-interview-sidebar
    // in style.css) so the push shrinks/grows along with the rail itself.
    document.documentElement.style.setProperty('--interview-sidebar-w', collapsed ? COLLAPSED_WIDTH : EXPANDED_WIDTH);
  };
  // First-time mobile visitors get a collapsed rail by default (220px fixed
  // would eat most of a phone screen) - anyone who's explicitly toggled it
  // keeps that choice regardless of screen size.
  const storedCollapsed = localStorage.getItem(COLLAPSE_KEY);
  applyCollapsed(storedCollapsed === null ? window.innerWidth < 640 : storedCollapsed === '1');

  toggle.onclick = () => {
    const collapsed = !sidebar.classList.contains('collapsed');
    applyCollapsed(collapsed);
    localStorage.setItem(COLLAPSE_KEY, collapsed ? '1' : '0');
  };

  let dbLessons = [];
  try {
    dbLessons = await api.listInterviewLessons();
  } catch {
    // The sidebar still shows the static lessons if this fails - not worth
    // blocking the whole Interview section over a list refresh.
  }
  const dbIds = new Set(dbLessons.map((l) => l.courseId));
  const staticCards = staticLessons.filter((l) => !dbIds.has(l.courseId)).map((l) => ({ courseId: l.courseId, title: l.title }));
  const allLessons = [...staticCards, ...dbLessons];

  list.innerHTML = allLessons.length
    ? allLessons
        .map(
          (l) =>
            `<a href="#/interview/${encodeURIComponent(l.courseId)}" class="interviewSidebarLink${l.courseId === activeCourseId ? ' active' : ''}" title="${escapeAttr(l.title)}">${escapeHtml(l.title)}</a>`
        )
        .join('')
    : '<div class="interviewSidebarEmpty">No lessons yet.</div>';

  return contentHost;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function escapeAttr(str) {
  return str.replace(/"/g, '&quot;');
}
